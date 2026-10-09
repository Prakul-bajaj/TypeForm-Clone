"use client";
import { Check, ChevronDown, File as FileIcon, Heart, Star, UploadCloud, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatBytes } from "@/lib/download";
import type { AnswerValue, FileAnswer, RuntimeQuestion } from "@/lib/types";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

interface InputProps {
  q: RuntimeQuestion;
  value: AnswerValue;
  /** `auto` = the answer is complete, the player may advance by itself (single choice, rating, …). */
  onChange: (v: AnswerValue, auto?: boolean) => void;
  disabled?: boolean;
  /** how file questions talk to the server (real upload on a published form, a stand-in in previews) */
  files?: FileApi;
  /** file questions report "an upload is running" so the player doesn't move on / submit too early */
  onBusy?: (busy: boolean) => void;
}

export interface FileApi {
  upload: (q: RuntimeQuestion, file: File, onProgress: (fraction: number) => void, signal: AbortSignal) => Promise<FileAnswer>;
  discard: (fileId: string) => void;
}

export function TextInput({ q, value, onChange, disabled }: InputProps) {
  const placeholder =
    q.type === "email" ? "name@example.com" : q.type === "number" ? "Type a number..." : q.properties.placeholder || "Type your answer here...";
  return (
    <input
      className="tf-input"
      type="text"
      inputMode={q.type === "email" ? "email" : q.type === "number" ? "decimal" : "text"}
      autoComplete={q.type === "email" ? "email" : "off"}
      spellCheck={q.type !== "email"}
      placeholder={placeholder}
      aria-label={q.title || "Your answer"}
      value={(value as string) ?? ""}
      disabled={disabled}
      maxLength={q.properties.max_length || undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function LongTextInput({ q, value, onChange, disabled }: InputProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 360) + "px";
  }, [value]);
  return (
    <textarea
      ref={ref}
      className="tf-textarea"
      rows={1}
      placeholder={q.properties.placeholder || "Type your answer here..."}
      aria-label={q.title || "Your answer"}
      value={(value as string) ?? ""}
      disabled={disabled}
      maxLength={q.properties.max_length || undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function ChoiceList({
  labels,
  value,
  multiple,
  onChange,
  disabled,
  keys = LETTERS,
}: {
  labels: string[];
  value: AnswerValue;
  multiple: boolean;
  onChange: InputProps["onChange"];
  disabled?: boolean;
  keys?: string;
}) {
  const selected = new Set(Array.isArray(value) ? value : value ? [String(value)] : []);
  return (
    <div className="tf-choices" role={multiple ? "group" : "radiogroup"}>
      {labels.map((label, i) => {
        const on = selected.has(label);
        return (
          <button
            type="button"
            key={`${label}-${i}`}
            className={"tf-choice" + (on ? " selected" : "")}
            role={multiple ? "checkbox" : "radio"}
            aria-checked={on}
            disabled={disabled}
            onClick={() => {
              if (multiple) {
                const next = on ? [...selected].filter((x) => x !== label) : [...selected, label];
                onChange(labels.filter((l) => next.includes(l)));
              } else {
                onChange(label, true);
              }
            }}
          >
            <span className="tf-key">{keys[i] ?? ""}</span>
            <span className="lbl">{label}</span>
            <Check className="tick" strokeWidth={3} />
          </button>
        );
      })}
    </div>
  );
}

export function YesNoInput({ value, onChange, disabled }: InputProps) {
  const pick = (v: boolean) => onChange(v, true);
  return (
    <div className="tf-choices compact" role="radiogroup">
      {[
        { key: "Y", label: "Yes", v: true },
        { key: "N", label: "No", v: false },
      ].map((o) => (
        <button
          type="button"
          key={o.key}
          role="radio"
          aria-checked={value === o.v}
          disabled={disabled}
          className={"tf-choice" + (value === o.v ? " selected" : "")}
          onClick={() => pick(o.v)}
        >
          <span className="tf-key">{o.key}</span>
          <span className="lbl">{o.label}</span>
          <Check className="tick" strokeWidth={3} />
        </button>
      ))}
    </div>
  );
}

export function RatingInput({ q, value, onChange, disabled }: InputProps) {
  const steps = Math.max(3, Math.min(10, Number(q.properties.steps) || 5));
  const shape = (q.properties.shape as string) || "star";
  const [hover, setHover] = useState(0);
  const shown = hover || (typeof value === "number" ? value : 0);
  const Icon = shape === "heart" ? Heart : Star;
  return (
    <div className="tf-rating-wrap">
      <div className={"tf-rating" + (shape === "number" ? " numbers" : "")} role="radiogroup" onMouseLeave={() => setHover(0)}>
        {Array.from({ length: steps }, (_, i) => i + 1).map((n) => (
          <button
            type="button"
            key={n}
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} of ${steps}`}
            disabled={disabled}
            className={"tf-rate" + (n <= shown ? " on" : "") + (shape === "number" && value === n ? " on" : "")}
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(n, true)}
          >
            {shape === "number" ? n : <Icon />}
            {shape !== "number" && <span className="n">{n}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DropdownInput({ q, value, onChange, disabled }: InputProps) {
  const labels = useMemo(() => q.choices.map((c) => c.label), [q.choices]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const filtered = labels.filter((l) => l.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = typeof value === "string" ? value : "";

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const choose = (label: string) => {
    setOpen(false);
    setQuery("");
    onChange(label, true);
  };

  return (
    <div ref={wrap} className={"tf-dd" + (open ? " open" : "")}>
      <input
        className="tf-input"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-label={q.title || "Choose an option"}
        placeholder={selected || "Type or select an option"}
        value={open ? query : selected}
        disabled={disabled}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            if (!open) return; // closed: let the player navigate between questions
            e.preventDefault();
            const n = filtered.length;
            if (n) setHi((h) => (e.key === "ArrowDown" ? (h + 1) % n : (h - 1 + n) % n));
          } else if (e.key === "Enter" && open && filtered[hi]) {
            e.preventDefault();
            choose(filtered[hi]);
          } else if (e.key === "Escape") {
            if (open) {
              e.preventDefault();
              setOpen(false);
            }
          }
        }}
      />
      <ChevronDown className="chev" />
      {open && (
        <ul className="tf-dd-list" role="listbox">
          {filtered.length === 0 && <li className="empty">No matching options</li>}
          {filtered.map((l, i) => (
            <li
              key={l + i}
              role="option"
              aria-selected={l === selected}
              className={(i === hi ? "hi " : "") + (l === selected ? "sel" : "")}
              onMouseEnter={() => setHi(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(l)}
            >
              {l}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FileInput({ q, value, onChange, disabled, files, onBusy }: InputProps) {
  const maxMb = Number(q.properties.max_size_mb) || 10;
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<number | null>(null); // null = not uploading
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const done = value && typeof value === "object" && !Array.isArray(value) ? (value as FileAnswer) : null;

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    onBusy?.(progress !== null);
  }, [progress]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (file: File | undefined) => {
    if (!file || !files) return;
    setError(null);
    if (file.size > maxMb * 1024 * 1024) return setError(`That file is too large (limit ${maxMb} MB)`);
    if (file.size === 0) return setError("That file is empty");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setName(file.name);
    setProgress(0);
    try {
      const uploaded = await files.upload(q, file, setProgress, ctrl.signal);
      if (done) files.discard(done.file_id); // replaced
      onChange(uploaded);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : "The upload failed. Please try again.");
    } finally {
      abortRef.current = null;
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = () => {
    if (done) files?.discard(done.file_id);
    onChange(null);
    setError(null);
  };

  return (
    <div className="tf-file">
      <input ref={inputRef} type="file" hidden tabIndex={-1} onChange={(e) => pick(e.target.files?.[0])} />
      {progress !== null ? (
        <div className="tf-filecard" role="status" aria-label={`Uploading ${name}`}>
          <FileIcon />
          <span className="meta">
            <span className="name">{name}</span>
            <span className="tf-filebar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></span>
          </span>
          <button type="button" className="x" aria-label="Cancel upload" onClick={() => abortRef.current?.abort()}><X /></button>
        </div>
      ) : done ? (
        <div className="tf-filecard">
          <FileIcon />
          <span className="meta"><span className="name">{done.name}</span><span className="size">{formatBytes(done.size)}</span></span>
          <button type="button" className="x" aria-label="Remove file" disabled={disabled} onClick={remove}><X /></button>
        </div>
      ) : (
        <button
          type="button"
          className={"tf-drop" + (over ? " over" : "")}
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]); }}
        >
          <UploadCloud />
          <span><b>Choose file</b> or drag it here</span>
          <small>Up to {maxMb} MB</small>
        </button>
      )}
      {error && <div className="tf-file-error" role="alert">{error}</div>}
    </div>
  );
}

/** Renders the right input for a question type (shared by the player). */
export function AnswerField(props: InputProps) {
  switch (props.q.type) {
    case "long_text":
      return <LongTextInput {...props} />;
    case "multiple_choice":
      return (
        <ChoiceList
          labels={props.q.choices.map((c) => c.label)}
          value={props.value}
          multiple={!!props.q.properties.allow_multiple}
          onChange={props.onChange}
          disabled={props.disabled}
        />
      );
    case "dropdown":
      return <DropdownInput {...props} />;
    case "yes_no":
      return <YesNoInput {...props} />;
    case "rating":
      return <RatingInput {...props} />;
    case "file_upload":
      return <FileInput {...props} />;
    default:
      return <TextInput {...props} />;
  }
}
