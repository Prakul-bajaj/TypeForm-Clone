"use client";
import { Check, CircleAlert, Info, X } from "lucide-react";
import { ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TYPE_BY_ID } from "@/lib/questionTypes";
import { toast, ToastItem } from "@/lib/toast";
import type { QuestionType } from "@/lib/types";

/* ───────────────────────── Modal ───────────────────────── */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 480,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  labelledBy?: string;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && box.current) {
        // keep keyboard focus inside the dialog
        const f = box.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    const t = setTimeout(() => {
      const auto = box.current?.querySelector<HTMLElement>("[data-autofocus]");
      (auto ?? box.current?.querySelector<HTMLElement>("input,button,textarea"))?.focus();
    }, 30);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      clearTimeout(t);
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className="modal" style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? (title ? id : undefined)}>
        {title && (
          <div className="modal-head">
            <h2 id={id}>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmModal({
  open, title, message, confirmLabel = "Delete", busy, onConfirm, onClose,
}: {
  open: boolean; title: string; message: ReactNode; confirmLabel?: string; busy?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={440}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={busy} data-autofocus>{busy ? "Working…" : confirmLabel}</button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>{message}</p>
    </Modal>
  );
}

/* ───────────────────────── Toasts ───────────────────────── */
export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(
    () =>
      toast.subscribe((t) => {
        setItems((l) => [...l.slice(-3), t]);
        setTimeout(() => setItems((l) => l.filter((x) => x.id !== t.id)), t.kind === "error" ? 5200 : 3200);
      }),
    [],
  );
  return (
    <div className="toast-host" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
          {t.kind === "success" ? <Check size={16} /> : t.kind === "error" ? <CircleAlert size={16} /> : <Info size={16} />}
          <span>{t.message}</span>
          <button aria-label="Dismiss" onClick={() => setItems((l) => l.filter((x) => x.id !== t.id))}><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────── Switch ───────────────────────── */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={"switch" + (checked ? " on" : "")} onClick={() => onChange(!checked)}>
      <i />
    </button>
  );
}

/* ───────────────────────── Popover menu ───────────────────────── */
export function useOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onOutside();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onOutside();
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [ref, onOutside, active]);
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  hidden?: boolean;
  divider?: boolean;
}

export function MenuButton({ items, trigger, label = "More actions", align = "right" }: { items: MenuItem[]; trigger: ReactNode; label?: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useOutside(ref, close, open);
  return (
    <div className="menu-wrap" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button className="icon-btn" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open && (
        <div className={"menu " + align} role="menu">
          {items.filter((i) => !i.hidden).map((it, i) => (
            <div key={i}>
              {it.divider && <hr />}
              <button
                role="menuitem"
                className={it.danger ? "danger" : ""}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
              >
                {it.icon}
                {it.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Misc ───────────────────────── */
export function Spinner({ size = 24 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} role="status" aria-label="Loading" />;
}

export function TypeBadge({ type, size = 28 }: { type: QuestionType; size?: number }) {
  const meta = TYPE_BY_ID[type];
  return (
    <span className="type-badge" style={{ background: meta.color, width: size, height: size, fontSize: size * 0.46 }} aria-hidden>
      {meta.letter}
    </span>
  );
}

export function ComingSoon({ title, description, icon }: { title: string; description: string; icon?: ReactNode }) {
  return (
    <div className="soon-card">
      <div className="soon-icon">{icon}</div>
      <div>
        <h3>{title} <span className="chip soon">Coming soon</span></h3>
        <p>{description}</p>
      </div>
    </div>
  );
}
