"use client";
/**
 * The respondent player — a small state machine, not a pile of inputs.
 *
 *   welcome? → q:0 → q:… (branching) → [submit] → end
 *
 *  • navigation state (current / history / answers) is separate from animation state (leaving[]):
 *    the logical screen changes immediately, the old one is kept around only until its exit
 *    animation fires `animationend` (with a safety timeout), so rapid key presses never deadlock.
 *  • forward-only branching via lib/logic.ts, same algorithm as the server.
 */
import { AlertTriangle, ArrowRight, Check, ChevronDown, ChevronUp, CornerDownLeft, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { nextIndex } from "@/lib/logic";
import { APP_NAME, themeStyle } from "@/lib/theme";
import type { AnswerValue, RuntimeForm, RuntimeQuestion } from "@/lib/types";
import { validateAnswer } from "@/lib/validation";
import { AnswerField, type FileApi } from "./AnswerInputs";

type ScreenKey = "welcome" | "end" | `q:${number}`;
type Dir = "forward" | "backward";
interface Leaving { id: number; key: ScreenKey; dir: Dir }

const normalize = (q: RuntimeQuestion, v: AnswerValue): AnswerValue => {
  if (typeof v === "string") {
    const t = v.trim();
    if (q.type === "number" && t !== "") return Number(t);
    return t;
  }
  return v;
};

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

interface Props {
  form: RuntimeForm;
  /** Preview never POSTs anything. */
  preview?: boolean;
  onClose?: () => void;
  /** Render inside a container instead of covering the viewport. */
  inline?: boolean;
}

export default function FormRuntime({ form, preview = false, onClose, inline = false }: Props) {
  const { questions, settings } = form;
  const reduced = usePrefersReducedMotion();
  const firstKey: ScreenKey = settings.welcome.enabled ? "welcome" : questions.length ? "q:0" : "end";

  const [current, setCurrent] = useState<ScreenKey>(firstKey);
  const [history, setHistory] = useState<ScreenKey[]>([]);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [shake, setShake] = useState<Record<string, number>>({});
  const [leaving, setLeaving] = useState<Leaving[]>([]);
  const [dir, setDir] = useState<Dir>("forward");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // refs mirror state so async callbacks (auto-advance timers, key handler) never read stale values
  const currentRef = useRef(current);
  const historyRef = useRef(history);
  const answersRef = useRef(answers);
  const rootRef = useRef<HTMLDivElement>(null);
  const startedAt = useRef<number | null>(null);
  const leaveSeq = useRef(0);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idemKey = useRef<string>("");
  const submittingRef = useRef(false);
  const doneRef = useRef(false); // the final submit succeeded → no more progress saves
  const uploadingRef = useRef<Set<string>>(new Set()); // refs of file questions with an upload in flight

  // how file questions reach the server: a real upload on a published form, a stand-in in the builder preview
  const fileApi = useMemo<FileApi>(
    () =>
      preview
        ? {
            upload: async (_q, file, onProgress) => {
              onProgress(1);
              return { file_id: "preview", name: file.name, size: file.size };
            },
            discard: () => {},
          }
        : {
            upload: (q, file, onProgress, signal) => api.uploadAnswerFile(form.public_id, q.ref, file, onProgress, signal),
            discard: (fileId) => void api.discardFile(form.public_id, fileId),
          },
    [preview, form.public_id],
  );

  useEffect(() => {
    idemKey.current = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
  }, []);

  // ── navigation ───────────────────────────────────────────────
  const navigate = useCallback(
    (to: ScreenKey, direction: Dir) => {
      const from = currentRef.current;
      if (from === to) return;
      if (!reduced) {
        const id = ++leaveSeq.current;
        setLeaving((l) => [...l, { id, key: from, dir: direction }]);
        // safety net only — normally removed by the exit animation's `animationend`
        setTimeout(() => setLeaving((l) => l.filter((x) => x.id !== id)), 900);
      }
      if (direction === "forward") {
        historyRef.current = [...historyRef.current, from];
        setHistory(historyRef.current);
      }
      setDir(direction);
      currentRef.current = to;
      setCurrent(to);
    },
    [reduced],
  );

  const setAnswer = useCallback((ref: string, value: AnswerValue) => {
    answersRef.current = { ...answersRef.current, [ref]: value };
    setAnswers(answersRef.current);
    setErrors((e) => (e[ref] ? { ...e, [ref]: "" } : e));
  }, []);

  const flagError = (ref: string, message: string) => {
    setErrors((e) => ({ ...e, [ref]: message }));
    setShake((s) => ({ ...s, [ref]: (s[ref] || 0) + 1 }));
  };

  // Partial responses: tell the server what has been answered so far, so abandoned forms still show up in
  // Results (and in the completion rate). Sent when moving to the next question and when the tab is hidden.
  const sendProgress = useCallback(
    (includeCurrent: boolean) => {
      if (preview || doneRef.current || submittingRef.current || !idemKey.current) return;
      const keys = [...historyRef.current, ...(includeCurrent ? [currentRef.current] : [])].filter((k) => k.startsWith("q:"));
      const answers = keys
        .map((k) => questions[Number(k.slice(2))])
        .filter(Boolean)
        .map((q) => ({ ref: q.ref, value: normalize(q, answersRef.current[q.ref]) ?? null }))
        .filter((a) => a.value !== null && a.value !== "" && !(Array.isArray(a.value) && a.value.length === 0));
      if (!answers.length) return;
      api
        .saveProgress(form.public_id, {
          idempotency_key: idemKey.current,
          answers,
          started_at: startedAt.current ? new Date(startedAt.current).toISOString() : undefined,
        })
        .catch(() => {}); // best effort: never bother the respondent
    },
    [form.public_id, preview, questions],
  );

  useEffect(() => {
    const hide = () => document.visibilityState === "hidden" && sendProgress(true);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", hide);
    };
  }, [sendProgress]);

  const submit = useCallback(
    async (lastIndex: number) => {
      if (submittingRef.current) return;
      if (preview) return navigate("end", "forward");
      submittingRef.current = true;
      setSubmitting(true);
      setSubmitError(null);
      // only the questions actually visited (the branch the respondent walked)
      const visited = [...historyRef.current.filter((k): k is `q:${number}` => k.startsWith("q:")), `q:${lastIndex}` as const];
      const payload = visited.map((k) => {
        const q = questions[Number(k.slice(2))];
        return { ref: q.ref, value: normalize(q, answersRef.current[q.ref]) ?? null };
      });
      try {
        await api.submit(form.public_id, {
          answers: payload,
          started_at: startedAt.current ? new Date(startedAt.current).toISOString() : undefined,
          idempotency_key: idemKey.current,
        });
        doneRef.current = true;
        navigate("end", "forward");
      } catch (e) {
        if (e instanceof ApiError && e.errors.length) {
          // the server is authoritative: take the respondent to the first question it rejected
          e.errors.forEach((er) => er.ref && flagError(er.ref, er.message));
          const idx = questions.findIndex((q) => q.ref === e.errors[0].ref);
          if (idx >= 0) {
            const target = `q:${idx}` as ScreenKey;
            const pos = historyRef.current.indexOf(target);
            historyRef.current = pos >= 0 ? historyRef.current.slice(0, pos) : historyRef.current;
            setHistory(historyRef.current);
            navigate(target, "backward");
          }
        } else {
          setSubmitError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
        }
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [form.public_id, navigate, preview, questions],
  );

  const advance = useCallback(() => {
    const key = currentRef.current;
    if (key === "end" || submittingRef.current) return;
    if (key === "welcome") {
      startedAt.current ??= Date.now();
      return navigate(questions.length ? "q:0" : "end", "forward");
    }
    startedAt.current ??= Date.now();
    const idx = Number(key.slice(2));
    const q = questions[idx];
    const value = normalize(q, answersRef.current[q.ref]);
    if (uploadingRef.current.has(q.ref)) return flagError(q.ref, "Hang on, your file is still uploading");
    const err = validateAnswer(q, value);
    if (err) return flagError(q.ref, err);
    const ni = nextIndex(questions, idx, value);
    if (ni === -1) void submit(idx);
    else {
      sendProgress(true);
      navigate(`q:${ni}`, "forward");
    }
  }, [navigate, questions, sendProgress, submit]);

  const back = useCallback(() => {
    const h = historyRef.current;
    if (!h.length || currentRef.current === "end" || submittingRef.current) return;
    const prev = h[h.length - 1];
    historyRef.current = h.slice(0, -1);
    setHistory(historyRef.current);
    navigate(prev, "backward");
  }, [navigate]);

  const onAnswer = useCallback(
    (q: RuntimeQuestion, value: AnswerValue, auto?: boolean) => {
      startedAt.current ??= Date.now();
      setAnswer(q.ref, value);
      if (auto) {
        if (autoTimer.current) clearTimeout(autoTimer.current);
        const keyAtPick = currentRef.current;
        autoTimer.current = setTimeout(() => {
          if (currentRef.current === keyAtPick) advance();
        }, 380);
      }
    },
    [advance, setAnswer],
  );

  useEffect(() => () => void (autoTimer.current && clearTimeout(autoTimer.current)), []);

  // ── keyboard ─────────────────────────────────────────────────
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement;
    const root = rootRef.current;
    if (!root || !(root.contains(t) || t === document.body)) return;
    const key = currentRef.current;
    if (key === "end") return;
    const tag = t.tagName;
    const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

    if (e.key === "Enter") {
      if (tag === "TEXTAREA" && e.shiftKey) return; // line break
      if (tag === "BUTTON" && !t.classList.contains("tf-choice")) return; // let the button click natively
      e.preventDefault();
      return advance();
    }
    if (e.key === "ArrowDown" && tag !== "TEXTAREA") {
      e.preventDefault();
      return advance();
    }
    if (e.key === "ArrowUp" && tag !== "TEXTAREA") {
      e.preventDefault();
      return back();
    }
    if (typing || key === "welcome" || e.shiftKey) return;

    const q = questions[Number(key.slice(2))];
    const k = e.key.toLowerCase();
    if (q.type === "multiple_choice" && /^[a-z]$/.test(k)) {
      const label = q.choices[k.charCodeAt(0) - 97]?.label;
      if (label === undefined) return;
      e.preventDefault();
      const multiple = !!q.properties.allow_multiple;
      const cur = answersRef.current[q.ref];
      if (multiple) {
        const set = new Set(Array.isArray(cur) ? cur : []);
        set.has(label) ? set.delete(label) : set.add(label);
        onAnswer(q, q.choices.map((c) => c.label).filter((l) => set.has(l)));
      } else onAnswer(q, label, true);
    } else if (q.type === "yes_no" && (k === "y" || k === "n")) {
      e.preventDefault();
      onAnswer(q, k === "y", true);
    } else if (q.type === "rating" && /^[0-9]$/.test(k)) {
      const n = k === "0" ? 10 : Number(k);
      if (n <= (Number(q.properties.steps) || 5)) {
        e.preventDefault();
        onAnswer(q, n, true);
      }
    }
  };
  useEffect(() => {
    const fn = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  // Escape closes a preview overlay
  useEffect(() => {
    if (!onClose) return;
    const fn = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && onClose();
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);

  // ── derived ──────────────────────────────────────────────────
  const answeredCount = history.filter((k) => k.startsWith("q:")).length;
  const progress = current === "end" ? 100 : questions.length ? Math.round((answeredCount / questions.length) * 100) : 0;
  const style = useMemo(() => themeStyle(form.theme), [form.theme]);
  const showNav = current !== "end" && current !== "welcome" && questions.length > 0;

  const renderScreen = (key: ScreenKey, mode: "current" | "leaving", leave?: Leaving) => {
    const interactive = mode === "current";
    const animation = interactive ? `enter-${dir}` : `exit-${leave!.dir}`;
    const common = {
      className: `tf-screen ${animation}` + (interactive ? "" : " leaving"),
      "aria-hidden": !interactive || undefined,
      inert: !interactive || undefined,
    };
    const onEnd = !interactive
      ? (e: React.AnimationEvent) => {
          if (e.target === e.currentTarget) setLeaving((l) => l.filter((x) => x.id !== leave!.id));
        }
      : undefined;

    if (key === "welcome") {
      return (
        <div key={interactive ? "cur-welcome" : `leave-${leave!.id}`} {...common} onAnimationEnd={onEnd}>
          <div className="tf-screen-inner tf-welcome">
            <h1 className="tf-title">{settings.welcome.title || form.title}</h1>
            {settings.welcome.description && <p className="tf-desc">{settings.welcome.description}</p>}
            <div className="tf-actions">
              <button className="tf-btn big" type="button" onClick={advance} tabIndex={interactive ? 0 : -1}>
                {settings.welcome.button_text || "Start"}
              </button>
              <span className="tf-hint">press <b>Enter</b> <CornerDownLeft size={13} /></span>
            </div>
          </div>
        </div>
      );
    }
    if (key === "end") {
      const e = settings.ending;
      return (
        <div key={interactive ? "cur-end" : `leave-${leave!.id}`} {...common} onAnimationEnd={onEnd}>
          <div className="tf-screen-inner tf-ending">
            <h1 className="tf-title">{e.title}</h1>
            {e.description && <p className="tf-desc">{e.description}</p>}
            {e.button_text && (
              <div className="tf-actions">
                <a className="tf-btn big" href={e.button_link || undefined} target="_blank" rel="noopener noreferrer">
                  {e.button_text}
                </a>
              </div>
            )}
          </div>
        </div>
      );
    }
    const idx = Number(key.slice(2));
    const q = questions[idx];
    return (
      <QuestionScreen
        key={interactive ? `cur-${key}` : `leave-${leave!.id}`}
        q={q}
        number={idx + 1}
        showNumber={settings.show_question_numbers}
        value={answers[q.ref]}
        error={errors[q.ref]}
        shake={shake[q.ref] || 0}
        interactive={interactive}
        buttonLabel={nextIndex(questions, idx, normalize(q, answers[q.ref])) === -1 ? "Submit" : "OK"}
        submitting={submitting}
        submitError={interactive ? submitError : null}
        className={common.className}
        onAnimationEnd={onEnd}
        onChange={(v, auto) => onAnswer(q, v, auto)}
        onAdvance={advance}
        files={fileApi}
        onBusy={(busy) => (busy ? uploadingRef.current.add(q.ref) : uploadingRef.current.delete(q.ref))}
      />
    );
  };

  return (
    <div
      ref={rootRef}
      className={"tf-root " + (inline ? "tf-player inline" : "tf-player")}
      style={style}
      role="form"
      aria-label={form.title}
    >
      {preview && !inline && (
        <div className="tf-previewbar">Preview mode — nothing you enter here is saved</div>
      )}
      {settings.show_progress_bar && current !== "welcome" && (
        <div className="tf-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Form progress">
          <i style={{ width: `${progress}%` }} />
        </div>
      )}

      {leaving.map((l) => renderScreen(l.key, "leaving", l))}
      {renderScreen(current, "current")}

      {questions.length === 0 && current === "end" && (
        <div className="tf-screen"><div className="tf-screen-inner"><p className="tf-desc">This form has no questions yet.</p></div></div>
      )}

      {showNav && (
        <div className="tf-nav" role="group" aria-label="Navigate questions">
          <button type="button" onClick={back} disabled={history.length === 0} aria-label="Previous question"><ChevronUp /></button>
          <button type="button" onClick={advance} aria-label="Next question"><ChevronDown /></button>
        </div>
      )}
      {!preview && <div className="tf-badge">Powered by <b>{APP_NAME}</b></div>}
      {onClose && (
        <button type="button" className="tf-close" onClick={onClose} aria-label="Close preview"><X size={18} /></button>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
interface QProps {
  q: RuntimeQuestion;
  number: number;
  showNumber: boolean;
  value: AnswerValue;
  error?: string;
  shake: number;
  interactive: boolean;
  buttonLabel: string;
  submitting: boolean;
  submitError: string | null;
  className: string;
  onAnimationEnd?: (e: React.AnimationEvent) => void;
  onChange: (v: AnswerValue, auto?: boolean) => void;
  onAdvance: () => void;
  files: FileApi;
  onBusy: (busy: boolean) => void;
}

function QuestionScreen(p: QProps) {
  const { q } = p;
  const fieldRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);

  // focus the first text-like input when this screen becomes the active one
  useEffect(() => {
    if (!p.interactive) return;
    const el = screenRef.current?.querySelector<HTMLElement>("input, textarea");
    el?.focus({ preventScroll: true });
  }, [p.interactive]);

  // validation shake (re-trigger the CSS animation) and keep the field focused
  useEffect(() => {
    const el = fieldRef.current;
    if (!p.shake || !el || !p.interactive) return;
    el.classList.remove("shake");
    void el.offsetWidth;
    el.classList.add("shake");
    screenRef.current?.querySelector<HTMLElement>("input, textarea")?.focus({ preventScroll: true });
  }, [p.shake, p.interactive]);

  const multi = q.type === "multiple_choice" && !!q.properties.allow_multiple;
  const needsOk = !["multiple_choice", "dropdown", "yes_no", "rating"].includes(q.type) || multi;
  const desc = q.description || (multi ? "Choose as many as you like" : "");

  return (
    <div ref={screenRef} className={p.className} onAnimationEnd={p.onAnimationEnd} aria-hidden={!p.interactive || undefined} {...(!p.interactive ? { inert: true } : {})}>
      <div className="tf-screen-inner">
        <div className="tf-head">
          {p.showNumber && (
            <span className="tf-num">
              {p.number}
              <ArrowRight strokeWidth={2.4} />
            </span>
          )}
          <h2 className="tf-title">
            {q.title || "Untitled question"}
            {q.required && <span className="req" aria-label="required">*</span>}
          </h2>
        </div>
        {desc && <p className="tf-desc" style={p.showNumber ? { marginLeft: "1.9em" } : undefined}>{desc}</p>}

        <div className="tf-body" style={p.showNumber ? { marginLeft: "1.9em" } : undefined}>
          <div ref={fieldRef} className="tf-field">
            <AnswerField q={q} value={p.value} onChange={p.onChange} disabled={!p.interactive || p.submitting} files={p.files} onBusy={p.onBusy} />
          </div>
          {p.error && (
            <div className="tf-error" role="alert">
              <AlertTriangle /> {p.error}
            </div>
          )}
          {p.submitError && (
            <div className="tf-error" role="alert">
              <AlertTriangle /> {p.submitError}
            </div>
          )}
          <div className="tf-actions">
            {(needsOk || p.buttonLabel === "Submit") && (
              <button type="button" className="tf-btn" onClick={p.onAdvance} disabled={p.submitting} tabIndex={p.interactive ? 0 : -1}>
                {p.submitting ? "Submitting…" : p.buttonLabel}
                {!p.submitting && <Check strokeWidth={3} />}
              </button>
            )}
            {needsOk && q.type !== "long_text" && (
              <span className="tf-hint">press <b>Enter</b> <CornerDownLeft size={13} /></span>
            )}
            {q.type === "long_text" && (
              <span className="tf-hint"><b>Shift ⇧ + Enter</b> to make a line break</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
