"use client";
import { ChevronDown, Copy, GitBranch, ImagePlus, Save, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Switch, TypeBadge, useOutside } from "@/components/ui";
import { api } from "@/lib/api";
import { QUESTION_TYPES, TYPE_BY_ID } from "@/lib/questionTypes";
import { useBuilder, useBuilderPick } from "@/lib/store";
import { bgUrl, FONT_STACK, THEME_PRESETS } from "@/lib/theme";
import { toast } from "@/lib/toast";
import type { CustomTheme, Question, QuestionType, Theme } from "@/lib/types";

const DEFAULT_PROPS: Record<string, Record<string, any>> = {
  rating: { steps: 5, shape: "star" },
  multiple_choice: { allow_multiple: false },
  file_upload: { max_size_mb: 10 },
};

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="prow">
      <div><div className="plabel">{label}</div>{hint && <div className="phint">{hint}</div>}</div>
      {children}
    </div>
  );
}

function TypePicker({ q }: { q: Question }) {
  const update = useBuilder((s) => s.updateQuestion);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useOutside(ref, close, open);
  const meta = TYPE_BY_ID[q.type];
  return (
    <div className="type-picker" ref={ref}>
      <button className="type-select" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <TypeBadge type={q.type} size={24} /> <span>{meta.label}</span> <ChevronDown size={16} className="chev" />
      </button>
      {open && (
        <ul className="type-menu" role="listbox">
          {QUESTION_TYPES.map((t) => (
            <li key={t.type}>
              <button role="option" aria-selected={t.type === q.type} className={t.type === q.type ? "on" : ""}
                onClick={() => {
                  setOpen(false);
                  if (t.type !== q.type) update(q.id, { type: t.type as QuestionType, properties: { ...(DEFAULT_PROPS[t.type] ?? {}) } });
                }}>
                <TypeBadge type={t.type} size={22} /> {t.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QuestionSettings({ q, index }: { q: Question; index: number }) {
  const { update, remove, duplicate } = useBuilderPick((s) => ({ update: s.updateQuestion, remove: s.deleteQuestion, duplicate: s.duplicateQuestion }));
  const setProp = (k: string, v: unknown) => {
    const next = { ...q.properties };
    if (v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v))) delete next[k];
    else next[k] = v;
    update(q.id, { properties: next });
  };
  const num = (v: string) => (v === "" ? undefined : Number(v));
  return (
    <>
      <div className="psec">
        <div className="psec-title">Question {index + 1}</div>
        <TypePicker q={q} />
      </div>

      <div className="psec">
        <div className="psec-title">Settings</div>
        <Row label="Required" hint="Respondents must answer to continue">
          <Switch checked={q.required} onChange={(required) => update(q.id, { required })} label="Required" />
        </Row>

        {q.type === "multiple_choice" && (
          <Row label="Multiple selection" hint="Allow more than one answer">
            <Switch checked={!!q.properties.allow_multiple} onChange={(v) => setProp("allow_multiple", v)} label="Multiple selection" />
          </Row>
        )}

        {q.type === "rating" && (
          <>
            <Row label="Steps">
              <select className="select sm" value={q.properties.steps ?? 5} onChange={(e) => setProp("steps", Number(e.target.value))} aria-label="Rating steps">
                {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Row>
            <Row label="Shape">
              <select className="select sm" value={q.properties.shape ?? "star"} onChange={(e) => setProp("shape", e.target.value)} aria-label="Rating shape">
                <option value="star">Stars</option>
                <option value="heart">Hearts</option>
                <option value="number">Numbers</option>
              </select>
            </Row>
          </>
        )}

        {q.type === "file_upload" && (
          <Row label="Max file size" hint="Larger files are rejected">
            <select className="select sm" value={q.properties.max_size_mb ?? 10} onChange={(e) => setProp("max_size_mb", Number(e.target.value))} aria-label="Maximum file size">
              {[1, 2, 5, 10, 25].map((n) => <option key={n} value={n}>{n} MB</option>)}
            </select>
          </Row>
        )}

        {q.type === "number" && (
          <>
            <Row label="Minimum"><input className="input sm" type="number" value={q.properties.min ?? ""} onChange={(e) => setProp("min", num(e.target.value))} placeholder="None" aria-label="Minimum" /></Row>
            <Row label="Maximum"><input className="input sm" type="number" value={q.properties.max ?? ""} onChange={(e) => setProp("max", num(e.target.value))} placeholder="None" aria-label="Maximum" /></Row>
          </>
        )}

        {(q.type === "short_text" || q.type === "long_text") && (
          <>
            <Row label="Max characters"><input className="input sm" type="number" min={1} value={q.properties.max_length ?? ""} onChange={(e) => setProp("max_length", num(e.target.value))} placeholder="No limit" aria-label="Maximum characters" /></Row>
            <div className="prow col">
              <div className="plabel">Placeholder</div>
              <input className="input sm" value={q.properties.placeholder ?? ""} maxLength={200} onChange={(e) => setProp("placeholder", e.target.value)} placeholder="Type your answer here..." aria-label="Placeholder text" />
            </div>
          </>
        )}
      </div>

      <div className="psec">
        <div className="psec-title">Logic</div>
        <Link href={`/forms/${useBuilder.getState().form?.id}/workflow`} className="plink"><GitBranch size={15} /> Add logic jumps for this question</Link>
      </div>

      <div className="psec actions">
        <button className="btn btn-sm" onClick={() => duplicate(q.id)}><Copy size={14} /> Duplicate</button>
        <button className="btn btn-sm btn-danger-ghost" onClick={() => remove(q.id)}><Trash2 size={14} /> Delete</button>
      </div>
    </>
  );
}

function ThemeSwatch({ t, active, onClick, onDelete }: { t: Theme; active: boolean; onClick: () => void; onDelete?: () => void }) {
  const img = bgUrl(t.background_image);
  return (
    <div className="theme-wrap">
      <button className={"theme-card" + (active ? " on" : "")} onClick={onClick} aria-pressed={active} aria-label={`${t.name} theme`}>
        <span className="theme-sw" style={{ background: t.background, backgroundImage: img ? `url("${img}")` : undefined, backgroundSize: "cover", fontFamily: FONT_STACK[t.font] }}>
          <b style={{ color: t.question_color }}>Aa</b>
          <i style={{ background: t.button_color }} />
        </span>
        <span className="theme-name">{t.name}</span>
      </button>
      {onDelete && <button className="theme-x" onClick={onDelete} aria-label={`Delete ${t.name} theme`}><X size={12} /></button>}
    </div>
  );
}

function DesignPanel() {
  const { form, setTheme, setSettings } = useBuilderPick((s) => ({ form: s.form!, setTheme: s.setTheme, setSettings: s.setSettings }));
  const t = form.theme;
  const patch = (p: Partial<Theme>) => setTheme({ ...t, ...p, name: "Custom" });
  const colors: [keyof Theme, string][] = [
    ["background", "Background color"], ["question_color", "Questions"], ["answer_color", "Answers"], ["button_color", "Buttons"], ["button_text_color", "Button text"],
  ];

  // ── saved ("my") themes ──
  const [saved, setSaved] = useState<CustomTheme[] | null>(null);
  const [naming, setNaming] = useState(false);
  const [themeName, setThemeName] = useState("");
  const [savingTheme, setSavingTheme] = useState(false);
  useEffect(() => {
    let live = true;
    api.listThemes().then((l) => live && setSaved(l)).catch(() => live && setSaved([]));
    return () => { live = false; };
  }, []);
  const saveCurrent = async () => {
    const name = themeName.trim();
    if (!name) return;
    setSavingTheme(true);
    try {
      const created = await api.saveTheme(name, { ...t, name });
      setSaved((l) => [created, ...(l ?? [])]);
      setTheme({ ...t, name });
      setNaming(false);
      setThemeName("");
      toast.success(`Saved “${name}” to My themes`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the theme");
    } finally {
      setSavingTheme(false);
    }
  };
  const removeSaved = async (c: CustomTheme) => {
    try {
      await api.deleteTheme(c.id);
      setSaved((l) => (l ?? []).filter((x) => x.id !== c.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete the theme");
    }
  };

  // ── background image ──
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [urlText, setUrlText] = useState(t.background_image.startsWith("/api/") ? "" : t.background_image);
  const [urlError, setUrlError] = useState(false);
  useEffect(() => setUrlText(t.background_image.startsWith("/api/") ? "" : t.background_image), [t.background_image]);
  const uploadBg = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const r = await api.uploadBackground(form.id, file);
      patch({ background_image: r.url, background_overlay: t.background_overlay || 25 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't upload the image");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const commitUrl = () => {
    const v = urlText.trim();
    if (v && !/^https?:\/\//i.test(v)) return setUrlError(true);
    setUrlError(false);
    if (v !== t.background_image && !(v === "" && t.background_image.startsWith("/api/"))) patch({ background_image: v });
  };
  const img = bgUrl(t.background_image);

  return (
    <>
      <div className="psec">
        <div className="psec-title">Themes</div>
        <div className="theme-grid">
          {THEME_PRESETS.map((p) => <ThemeSwatch key={p.name} t={p} active={t.name === p.name} onClick={() => setTheme(p)} />)}
        </div>
      </div>

      <div className="psec">
        <div className="psec-title">My themes</div>
        {saved === null ? (
          <p className="phint" style={{ margin: 0 }}>Loading…</p>
        ) : saved.length === 0 && !naming ? (
          <p className="phint" style={{ margin: "0 0 8px" }}>Tweak colors, font and background below, then save the result to reuse it on any of your forms.</p>
        ) : (
          <div className="theme-grid" style={{ marginBottom: 10 }}>
            {saved.map((c) => (
              <ThemeSwatch key={c.id} t={{ ...c.theme, name: c.name }} active={t.name === c.name} onClick={() => setTheme({ ...c.theme, name: c.name })} onDelete={() => removeSaved(c)} />
            ))}
          </div>
        )}
        {naming ? (
          <div className="row" style={{ gap: 6 }}>
            <input className="input sm" autoFocus maxLength={40} placeholder="Theme name" value={themeName} aria-label="Theme name"
              onChange={(e) => setThemeName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveCurrent(); if (e.key === "Escape") setNaming(false); }} />
            <button className="btn btn-sm btn-primary" disabled={!themeName.trim() || savingTheme} onClick={saveCurrent}>Save</button>
            <button className="btn btn-sm" onClick={() => setNaming(false)}>Cancel</button>
          </div>
        ) : (
          <button className="btn btn-sm" onClick={() => setNaming(true)}><Save size={14} /> Save current as theme</button>
        )}
      </div>

      <div className="psec">
        <div className="psec-title">Font</div>
        <select className="select" value={t.font} onChange={(e) => patch({ font: e.target.value as Theme["font"] })} aria-label="Font" style={{ fontFamily: FONT_STACK[t.font] }}>
          {(Object.keys(FONT_STACK) as Theme["font"][]).map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div className="psec">
        <div className="psec-title">Colors</div>
        {colors.map(([k, label]) => (
          <div className="prow" key={k}>
            <div className="plabel">{label}</div>
            <label className="color-pick">
              <input type="color" value={t[k] as string} onChange={(e) => patch({ [k]: e.target.value.toUpperCase() } as Partial<Theme>)} aria-label={`${label} colour`} />
              <span>{(t[k] as string).toUpperCase()}</span>
            </label>
          </div>
        ))}
      </div>

      <div className="psec">
        <div className="psec-title">Background image</div>
        <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => uploadBg(e.target.files?.[0])} />
        {img && <div className="bg-thumb" style={{ backgroundImage: `url("${img}")` }} role="img" aria-label="Current background image" />}
        <div className="row" style={{ gap: 6, marginBottom: 10 }}>
          <button className="btn btn-sm" disabled={uploading} onClick={() => fileRef.current?.click()}><ImagePlus size={14} /> {uploading ? "Uploading…" : img ? "Replace image" : "Upload image"}</button>
          {img && <button className="btn btn-sm" onClick={() => patch({ background_image: "", background_overlay: 0 })}><Trash2 size={14} /> Remove</button>}
        </div>
        <div className={"field" + (urlError ? " has-error" : "")} style={{ marginBottom: 10 }}>
          <label htmlFor="bgurl">…or paste an image link</label>
          <input id="bgurl" className="input sm" placeholder="https://" value={urlText} onChange={(e) => { setUrlText(e.target.value); setUrlError(false); }}
            onBlur={commitUrl} onKeyDown={(e) => e.key === "Enter" && commitUrl()} />
          {urlError ? <span className="field-error">Use a link that starts with http:// or https://</span> : <span className="field-hint">PNG, JPG, GIF or WebP, up to 5 MB when uploading.</span>}
        </div>
        {img && (
          <div className="prow col">
            <div className="plabel">Darken image <span className="phint" style={{ display: "inline" }}>({t.background_overlay}%)</span></div>
            <input type="range" min={0} max={80} step={5} value={t.background_overlay} onChange={(e) => patch({ background_overlay: Number(e.target.value) })} aria-label="Darken background image" style={{ width: "100%" }} />
          </div>
        )}
      </div>

      <div className="psec">
        <div className="psec-title">Display</div>
        <Row label="Progress bar"><Switch checked={form.settings.show_progress_bar} onChange={(v) => setSettings({ ...form.settings, show_progress_bar: v })} label="Progress bar" /></Row>
        <Row label="Question numbers"><Switch checked={form.settings.show_question_numbers} onChange={(v) => setSettings({ ...form.settings, show_question_numbers: v })} label="Question numbers" /></Row>
      </div>
    </>
  );
}

export default function SettingsPanel() {
  const { form, selected, setSettings } = useBuilderPick((s) => ({ form: s.form!, selected: s.selected, setSettings: s.setSettings }));
  const [tab, setTab] = useState<"question" | "design">("question");
  const questions = [...form.questions].sort((a, b) => a.position - b.position);
  const idx = questions.findIndex((q) => q.id === selected);
  const q = idx >= 0 ? questions[idx] : null;
  const ending = form.settings.ending;
  const welcome = form.settings.welcome;

  return (
    <aside className="bd-right" aria-label="Settings">
      <div className="ptabs" role="tablist">
        <button role="tab" aria-selected={tab === "question"} className={tab === "question" ? "on" : ""} onClick={() => setTab("question")}>
          {selected === "welcome" ? "Welcome" : selected === "ending" ? "Thank-you" : "Question"}
        </button>
        <button role="tab" aria-selected={tab === "design"} className={tab === "design" ? "on" : ""} onClick={() => setTab("design")}>Design</button>
      </div>
      <div className="pscroll">
        {tab === "design" ? (
          <DesignPanel />
        ) : q ? (
          <QuestionSettings q={q} index={idx} />
        ) : selected === "ending" ? (
          <div className="psec">
            <div className="psec-title">Thank-you screen</div>
            <div className="field"><label htmlFor="eb">Button text</label>
              <input id="eb" className="input" maxLength={40} placeholder="e.g. Visit our website" value={ending.button_text} onChange={(e) => setSettings({ ...form.settings, ending: { ...ending, button_text: e.target.value } })} />
            </div>
            <div className="field"><label htmlFor="el">Button link</label>
              <input id="el" className="input" placeholder="https://" value={ending.button_link} onChange={(e) => setSettings({ ...form.settings, ending: { ...ending, button_link: e.target.value } })} />
              <span className="field-hint">The button only appears if it has text.</span>
            </div>
            <p className="phint">Redirects, custom endings per answer and score-based outcomes are coming soon.</p>
          </div>
        ) : selected === "welcome" ? (
          <div className="psec">
            <div className="psec-title">Welcome screen</div>
            <Row label="Show welcome screen"><Switch checked={welcome.enabled} onChange={(v) => setSettings({ ...form.settings, welcome: { ...welcome, enabled: v } })} label="Show welcome screen" /></Row>
            <p className="phint">Edit the title, description and button text directly on the canvas.</p>
          </div>
        ) : (
          <div className="psec"><p className="phint">Select a question to edit its settings.</p></div>
        )}
      </div>
    </aside>
  );
}
