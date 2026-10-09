"use client";
import { ChevronDown, ChevronUp, Download, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ConfirmModal, Spinner, TypeBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { formatBytes, saveBlob } from "@/lib/download";
import { formatAnswer, formatDateTime, formatDuration } from "@/lib/format";
import { toast } from "@/lib/toast";
import type { FileAnswer, ResponseColumn, ResponseRow } from "@/lib/types";

export default function ResponseDrawer({
  formId, responseId, columns, onClose, onPrev, onNext, onDeleted,
}: {
  formId: number; responseId: number; columns: ResponseColumn[]; onClose: () => void; onPrev?: () => void; onNext?: () => void; onDeleted: () => void;
}) {
  const [resp, setResp] = useState<ResponseRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setResp(null);
    setError(null);
    api.getResponse(formId, responseId).then((r) => live && setResp(r)).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [formId, responseId]);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (confirm || (e.target as HTMLElement).closest("input,textarea,select")) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowUp" || e.key === "k") onPrev?.();
      if (e.key === "ArrowDown" || e.key === "j") onNext?.();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [confirm, onClose, onPrev, onNext]);

  const byRef = new Map(resp?.answers.map((a) => [a.question_ref, a]));
  // show in the form's current order, then answers to since-deleted questions
  const ordered = resp ? [...columns.filter((c) => byRef.has(c.ref)).map((c) => byRef.get(c.ref)!), ...resp.answers.filter((a) => !columns.some((c) => c.ref === a.question_ref))] : [];

  const download = async (f: FileAnswer) => {
    try {
      saveBlob(await api.downloadFile(formId, f.file_id), f.name);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't download the file");
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteResponse(formId, responseId);
      toast.success("Response deleted");
      setConfirm(false);
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Response details">
        <header>
          <div>
            <h2>{resp?.status === "partial" ? "Partial response" : "Response"}</h2>
            <p className="muted">{resp ? formatDateTime(resp.submitted_at) : "Loading…"}{resp?.duration_seconds != null && ` · took ${formatDuration(resp.duration_seconds)}`}</p>
          </div>
          <div className="row" style={{ gap: 2 }}>
            <button className="icon-btn" onClick={onPrev} disabled={!onPrev} aria-label="Previous response"><ChevronUp size={18} /></button>
            <button className="icon-btn" onClick={onNext} disabled={!onNext} aria-label="Next response"><ChevronDown size={18} /></button>
            <button className="icon-btn" onClick={() => setConfirm(true)} aria-label="Delete response"><Trash2 size={17} /></button>
            <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </div>
        </header>
        <div className="drawer-body">
          {error && <p className="tf-error-text">{error}</p>}
          {!resp && !error && <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>}
          {resp?.status === "partial" && <p className="partial-note">This person started the form but didn't submit it. Showing the answers they gave before leaving.</p>}
          {resp && ordered.map((a, i) => {
            const text = formatAnswer(a.value);
            const file = a.question_type === "file_upload" && a.value && typeof a.value === "object" && "file_id" in a.value ? (a.value as FileAnswer) : null;
            return (
              <div className="qa" key={a.question_ref}>
                <div className="qa-q"><TypeBadge type={a.question_type} size={18} /> <span>{i + 1}. {a.question_title || "Untitled question"}</span></div>
                {file ? (
                  <div className="qa-a qa-file">
                    <span>{file.name} <span className="muted">({formatBytes(file.size)})</span></span>
                    <button className="btn btn-sm" onClick={() => download(file)}><Download size={14} /> Download</button>
                  </div>
                ) : text ? <div className="qa-a">{text}</div> : <div className="qa-a skipped">Skipped</div>}
              </div>
            );
          })}
          {resp && <p className="muted token">ID: {resp.token}</p>}
        </div>
      </aside>
      <ConfirmModal open={confirm} title="Delete this response?" message="This permanently removes the response and its answers." busy={busy} onClose={() => setConfirm(false)} onConfirm={remove} />
    </>
  );
}
