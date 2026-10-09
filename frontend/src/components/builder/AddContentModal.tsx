"use client";
import { Lock, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Modal, TypeBadge } from "@/components/ui";
import { COMING_SOON_TYPES, GROUPS, QUESTION_TYPES } from "@/lib/questionTypes";
import type { QuestionType } from "@/lib/types";

export default function AddContentModal({
  open, onClose, onPick,
}: { open: boolean; onClose: () => void; onPick: (t: QuestionType) => void }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(
    () => QUESTION_TYPES.filter((t) => (t.label + " " + t.description).toLowerCase().includes(q.trim().toLowerCase())),
    [q],
  );
  return (
    <Modal open={open} onClose={onClose} title="Add a question" width={720}>
      <div className="search-box">
        <Search size={16} />
        <input className="input" data-autofocus placeholder="Search question types" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search question types"
          onKeyDown={(e) => { if (e.key === "Enter" && filtered[0]) { onPick(filtered[0].type); onClose(); } }} />
      </div>
      {GROUPS.map((g) => {
        const items = filtered.filter((t) => t.group === g);
        if (!items.length) return null;
        return (
          <section key={g} className="type-group">
            <h3>{g}</h3>
            <div className="type-grid">
              {items.map((t) => (
                <button key={t.type} className="type-card" onClick={() => { onPick(t.type); onClose(); }}>
                  <TypeBadge type={t.type} size={32} />
                  <span><b>{t.label}</b><small>{t.description}</small></span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
      {filtered.length === 0 && <p className="muted" style={{ textAlign: "center", padding: 24 }}>No question type matches “{q}”.</p>}
      {!q && (
        <section className="type-group">
          <h3>More <span className="chip soon">Coming soon</span></h3>
          <div className="type-grid">
            {COMING_SOON_TYPES.map((t) => (
              <div key={t.label} className="type-card disabled" aria-disabled>
                <span className="type-badge" style={{ background: "#c9c9c9", width: 32, height: 32 }}><Lock size={14} /></span>
                <span><b>{t.label}</b><small>{t.description}</small></span>
              </div>
            ))}
          </div>
        </section>
      )}
    </Modal>
  );
}
