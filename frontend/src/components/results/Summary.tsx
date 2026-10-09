"use client";
import { File as FileIcon, Star } from "lucide-react";
import { TypeBadge } from "@/components/ui";
import { formatBytes } from "@/lib/download";
import type { Summary as SummaryT, SummaryQuestion } from "@/lib/types";

function Bar({ label, count, percent }: { label: string; count: number; percent: number }) {
  return (
    <div className="bar-row">
      <div className="bar-label" title={label}>{label}</div>
      <div className="bar-track"><i style={{ width: `${Math.max(percent, count ? 1.5 : 0)}%` }} /></div>
      <div className="bar-val"><b>{percent.toFixed(percent % 1 ? 1 : 0)}%</b> <span>{count}</span></div>
    </div>
  );
}

function QuestionSummary({ q, index }: { q: SummaryQuestion; index: number }) {
  return (
    <section className="sum-card">
      <header>
        <span className="row-num">{index + 1}</span>
        <TypeBadge type={q.type} size={24} />
        <h3>{q.title}{q.removed && <span className="chip draft" style={{ marginLeft: 8 }}>deleted question</span>}</h3>
        <span className="sum-count">{q.answered} answered{q.skipped ? ` · ${q.skipped} skipped` : ""}</span>
      </header>
      {!!q.abandoned && <p className="sum-drop" style={{ margin: "-4px 0 10px" }}>{q.abandoned} {q.abandoned === 1 ? "person" : "people"} stopped here without finishing</p>}
      {q.answered === 0 ? (
        <p className="muted sum-empty">No answers yet.</p>
      ) : q.options ? (
        <>
          {q.type === "rating" && q.average != null && (
            <div className="avg"><Star size={18} fill="currentColor" /> <b>{q.average}</b> average rating</div>
          )}
          <div className="bars">{q.options.map((o) => <Bar key={o.label} {...o} />)}</div>
        </>
      ) : q.stats ? (
        <div className="stat-grid">
          {(["average", "median", "min", "max"] as const).map((k) => (
            <div key={k}><span>{k === "min" ? "Minimum" : k === "max" ? "Maximum" : k[0].toUpperCase() + k.slice(1)}</span><b>{q.stats![k]}</b></div>
          ))}
        </div>
      ) : q.files ? (
        <ul className="file-list">{q.files.map((f, i) => <li key={i}><FileIcon size={15} /> {f.name} <small>{formatBytes(f.size)}</small></li>)}</ul>
      ) : (
        <ul className="recent">{q.recent?.map((t, i) => <li key={i}>{t}</li>)}</ul>
      )}
    </section>
  );
}

export default function Summary({ data }: { data: SummaryT }) {
  return <div className="sum-list">{data.questions.map((q, i) => <QuestionSummary key={q.ref} q={q} index={i} />)}</div>;
}
