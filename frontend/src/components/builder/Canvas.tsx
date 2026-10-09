"use client";
import { ArrowRight, Check, CornerDownLeft, Monitor, Plus, Smartphone, X, Star, Heart, ChevronDown, UploadCloud } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { newKey } from "@/lib/api";
import { useBuilder, useBuilderPick } from "@/lib/store";
import { themeStyle } from "@/lib/theme";
import type { Choice, Question } from "@/lib/types";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function AutoTextarea({ value, onChange, placeholder, className, label, onEnter, autoFocus }: {
  value: string; onChange: (v: string) => void; placeholder: string; className: string; label: string; onEnter?: () => void; autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = el.scrollHeight + "px";
  }, [value]);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={className}
      value={value}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onEnter?.();
        }
      }}
    />
  );
}

/** Choices are edited inline, right where the respondent will see them. */
function ChoiceEditor({ q }: { q: Question }) {
  const update = useBuilder((s) => s.updateQuestion);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const focusKey = useRef<string | null>(null);
  useEffect(() => {
    if (focusKey.current) {
      inputs.current[focusKey.current]?.focus();
      focusKey.current = null;
    }
  });
  const set = (choices: Choice[]) => update(q.id, { choices });
  const add = (afterIndex = q.choices.length - 1, label = "") => {
    const c: Choice = { id: null, key: newKey(), label };
    focusKey.current = c.key;
    const next = [...q.choices];
    next.splice(afterIndex + 1, 0, c);
    set(next);
  };
  const multi = q.type === "multiple_choice";
  return (
    <div className="tf-choices" style={{ maxWidth: "24em" }}>
      {q.choices.map((c, i) => (
        <div key={c.key} className={"tf-choice edit" + (c.label.trim() === "" ? " blank" : "")}>
          <span className="tf-key">{multi ? LETTERS[i] : <ChevronDown size={10} />}</span>
          <input
            ref={(el) => { inputs.current[c.key] = el; }}
            className="choice-input"
            value={c.label}
            placeholder={`Choice ${i + 1}`}
            aria-label={`Choice ${i + 1}`}
            maxLength={500}
            onChange={(e) => set(q.choices.map((x) => (x.key === c.key ? { ...x, label: e.target.value } : x)))}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); add(i); }
              if (e.key === "Backspace" && c.label === "" && q.choices.length > 1) {
                e.preventDefault();
                focusKey.current = q.choices[Math.max(0, i - 1)].key;
                set(q.choices.filter((x) => x.key !== c.key));
              }
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (!text.includes("\n")) return;
              e.preventDefault(); // bulk-paste a list: one choice per line
              const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
              const next = [...q.choices];
              next.splice(i, c.label ? 0 : 1, ...lines.map((label) => ({ id: null, key: newKey(), label })));
              set(next);
            }}
          />
          {q.choices.length > 1 && (
            <button className="choice-x" aria-label={`Remove choice ${i + 1}`} onClick={() => set(q.choices.filter((x) => x.key !== c.key))}><X size={14} /></button>
          )}
        </div>
      ))}
      <button className="add-choice" onClick={() => add()}><Plus size={14} /> Add choice</button>
    </div>
  );
}

function RatingPreview({ q }: { q: Question }) {
  const steps = Number(q.properties.steps) || 5;
  const shape = q.properties.shape || "star";
  const Icon = shape === "heart" ? Heart : Star;
  return (
    <div className="tf-rating-wrap">
      <div className={"tf-rating" + (shape === "number" ? " numbers" : "")}>
        {Array.from({ length: steps }, (_, i) => (
          <span key={i} className="tf-rate" style={{ cursor: "default" }}>
            {shape === "number" ? i + 1 : <Icon />}
            {shape !== "number" && <span className="n">{i + 1}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

function QuestionEditor({ q, index }: { q: Question; index: number }) {
  const update = useBuilder((s) => s.updateQuestion);
  const showNumbers = useBuilder((s) => s.form!.settings.show_question_numbers);
  const multi = q.type === "multiple_choice" && q.properties.allow_multiple;
  const offset = showNumbers ? { marginLeft: "1.9em" } : undefined;

  let body: React.ReactNode;
  switch (q.type) {
    case "multiple_choice":
    case "dropdown":
      body = <ChoiceEditor q={q} />;
      break;
    case "yes_no":
      body = (
        <div className="tf-choices compact">
          {["Yes", "No"].map((l, i) => (
            <div key={l} className="tf-choice"><span className="tf-key">{l[0]}</span><span className="lbl">{l}</span></div>
          ))}
        </div>
      );
      break;
    case "rating":
      body = <RatingPreview q={q} />;
      break;
    case "file_upload":
      body = (
        <div className="tf-file">
          <span className="tf-drop" style={{ cursor: "default" }}>
            <UploadCloud /><span><b>Choose file</b> or drag it here</span><small>Up to {q.properties.max_size_mb || 10} MB</small>
          </span>
        </div>
      );
      break;
    case "long_text":
      body = <span className="tf-fake" style={{ minHeight: "3.2em" }}>{q.properties.placeholder || "Type your answer here..."}</span>;
      break;
    case "email":
      body = <span className="tf-fake">name@example.com</span>;
      break;
    case "number":
      body = <span className="tf-fake">Type a number...</span>;
      break;
    default:
      body = <span className="tf-fake">{q.properties.placeholder || "Type your answer here..."}</span>;
  }
  return (
    <div className="tf-screen-inner" key={q.id}>
      <div className="tf-head">
        {showNumbers && <span className="tf-num">{index + 1}<ArrowRight strokeWidth={2.4} /></span>}
        <AutoTextarea className="tf-title edit" value={q.title} placeholder="Your question here" label="Question title" onChange={(title) => update(q.id, { title })} />
      </div>
      <div style={offset}>
        <AutoTextarea className="tf-desc edit" value={q.description} placeholder={multi ? "Choose as many as you like" : "Description (optional)"} label="Question description" onChange={(description) => update(q.id, { description })} />
      </div>
      <div className="tf-body" style={offset}>
        {body}
        <div className="tf-actions">
          <span className="tf-btn static">OK <Check strokeWidth={3} /></span>
          <span className="tf-hint">press <b>Enter</b> <CornerDownLeft size={13} /></span>
        </div>
      </div>
    </div>
  );
}

function WelcomeEditor() {
  const { form, setSettings } = useBuilderPick((s) => ({ form: s.form!, setSettings: s.setSettings }));
  const w = form.settings.welcome;
  const patch = (p: Partial<typeof w>) => setSettings({ ...form.settings, welcome: { ...w, ...p } });
  return (
    <div className="tf-screen-inner tf-welcome">
      <AutoTextarea className="tf-title edit" value={w.title} placeholder="Welcome title" label="Welcome title" onChange={(title) => patch({ title })} />
      <AutoTextarea className="tf-desc edit" value={w.description} placeholder="Description (optional)" label="Welcome description" onChange={(description) => patch({ description })} />
      <div className="tf-actions">
        <input className="tf-btn big btn-input" value={w.button_text} aria-label="Button text" maxLength={40} onChange={(e) => patch({ button_text: e.target.value })} size={Math.max(5, w.button_text.length + 1)} />
        <span className="tf-hint">press <b>Enter</b> <CornerDownLeft size={13} /></span>
      </div>
    </div>
  );
}

function EndingEditor() {
  const { form, setSettings } = useBuilderPick((s) => ({ form: s.form!, setSettings: s.setSettings }));
  const e = form.settings.ending;
  const patch = (p: Partial<typeof e>) => setSettings({ ...form.settings, ending: { ...e, ...p } });
  return (
    <div className="tf-screen-inner tf-ending">
      <AutoTextarea className="tf-title edit" value={e.title} placeholder="Thank-you title" label="Thank-you title" onChange={(title) => patch({ title })} />
      <AutoTextarea className="tf-desc edit" value={e.description} placeholder="Description (optional)" label="Thank-you description" onChange={(description) => patch({ description })} />
      {e.button_text && <div className="tf-actions"><span className="tf-btn big static">{e.button_text}</span></div>}
    </div>
  );
}

export default function Canvas() {
  const { form, selected } = useBuilderPick((s) => ({ form: s.form!, selected: s.selected }));
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const questions = useMemo(() => [...form.questions].sort((a, b) => a.position - b.position), [form.questions]);
  const idx = questions.findIndex((q) => q.id === selected);
  const q = idx >= 0 ? questions[idx] : null;
  const progress = selected === "ending" ? 100 : selected === "welcome" ? 0 : q ? Math.round((idx / questions.length) * 100) : 0;

  return (
    <section className="bd-canvas" aria-label="Form canvas">
      <div className="canvas-bar">
        <span className="muted">
          {selected === "welcome" ? "Welcome screen" : selected === "ending" ? "Thank-you screen" : q ? `Question ${idx + 1} of ${questions.length}` : ""}
        </span>
        <div className="seg" role="group" aria-label="Preview device">
          <button className={device === "desktop" ? "on" : ""} onClick={() => setDevice("desktop")} aria-label="Desktop"><Monitor size={15} /></button>
          <button className={device === "mobile" ? "on" : ""} onClick={() => setDevice("mobile")} aria-label="Mobile"><Smartphone size={15} /></button>
        </div>
      </div>
      <div className="canvas-scroll">
        <div className={"stage tf-root " + device} style={themeStyle(form.theme)}>
          {form.settings.show_progress_bar && selected !== "welcome" && (
            <div className="tf-progress"><i style={{ width: `${progress}%` }} /></div>
          )}
          <div className="stage-content">
            {selected === "welcome" ? <WelcomeEditor /> : selected === "ending" ? <EndingEditor /> : q ? <QuestionEditor q={q} index={idx} /> : (
              <div className="tf-screen-inner"><p className="tf-desc">Select a question on the left, or add one.</p></div>
            )}
          </div>
        </div>
        <p className="canvas-hint muted">What you see here is what respondents get. Click any text to edit it — changes save automatically.</p>
      </div>
    </section>
  );
}
