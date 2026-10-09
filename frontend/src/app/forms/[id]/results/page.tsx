"use client";
import { BarChart3, ChevronLeft, ChevronRight, Download, ExternalLink, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import ResponseDrawer from "@/components/results/ResponseDrawer";
import Summary from "@/components/results/Summary";
import { Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { saveBlob } from "@/lib/download";
import { formatAnswer, formatDateTime, formatDuration } from "@/lib/format";
import { useBuilder } from "@/lib/store";
import { toast } from "@/lib/toast";
import type { ResponsePage, Summary as SummaryT } from "@/lib/types";

const PAGE_SIZE = 25;
const POLL_MS = 15000;

export default function ResultsPage() {
  const form = useBuilder((s) => s.form)!;
  const [tab, setTab] = useState<"summary" | "responses">("summary");
  const [summary, setSummary] = useState<SummaryT | null>(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ResponsePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<"all" | "completed" | "partial">("all");
  const pageRef = useRef(page);
  pageRef.current = page;
  const statusRef = useRef(status);
  statusRef.current = status;

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const [s, r] = await Promise.all([api.summary(form.id), api.listResponses(form.id, pageRef.current, PAGE_SIZE, statusRef.current)]);
      setSummary(s);
      setData(r);
      setError(null);
    } catch (e) {
      if (!quiet) setError(e instanceof ApiError ? e.message : "Failed to load results");
    } finally {
      setRefreshing(false);
    }
  }, [form.id]);

  useEffect(() => { load(); }, [load, page, status]);
  // live-ish dashboard: poll while the tab is visible so new submissions appear without a refresh
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && load(true), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const exportCsv = async () => {
    try {
      saveBlob(await api.downloadCsv(form.id), `${(form.title || "form").replace(/[^\w\-]+/g, "_")}-responses.csv`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't export the responses");
    }
  };

  const total = data?.total ?? 0; // rows in the current filter (drives the pager)
  const everyone = summary?.starts ?? 0; // completed + partial responses
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const items = data?.items ?? [];
  const openIdx = items.findIndex((r) => r.id === open);

  return (
    <div className="results">
      <div className="results-head">
        <div className="row between" style={{ flexWrap: "wrap", gap: 12 }}>
          <h1>Results</h1>
          <div className="row">
            <button className="btn btn-sm" onClick={() => load()} disabled={refreshing}><RefreshCw size={14} className={refreshing ? "spin" : ""} /> Refresh</button>
            <button className="btn btn-sm" onClick={exportCsv} disabled={!everyone}><Download size={14} /> Export CSV</button>
          </div>
        </div>

        <div className="stats">
          <div><span>Views</span><b>{summary?.views ?? "—"}</b></div>
          <div title="People who answered at least one question"><span>Starts</span><b>{summary?.starts ?? "—"}</b></div>
          <div title="Completed submissions"><span>Responses</span><b>{summary?.total_responses ?? "—"}</b></div>
          <div title="Responses ÷ starts"><span>Completion rate</span><b>{summary ? (summary.completion_rate != null ? `${summary.completion_rate}%` : "—") : "—"}</b></div>
          <div><span>Avg. time to complete</span><b>{summary ? formatDuration(summary.average_duration_seconds) : "—"}</b></div>
        </div>

        <div className="rtabs" role="tablist">
          <button role="tab" aria-selected={tab === "summary"} className={tab === "summary" ? "on" : ""} onClick={() => setTab("summary")}>Summary</button>
          <button role="tab" aria-selected={tab === "responses"} className={tab === "responses" ? "on" : ""} onClick={() => setTab("responses")}>Responses <span className="count">{everyone}</span></button>
        </div>
      </div>

      <div className="results-body">
        {error ? (
          <div className="empty"><h2>Couldn't load results</h2><p>{error}</p><button className="btn" onClick={() => load()}>Try again</button></div>
        ) : !summary || !data ? (
          <div className="page-center" style={{ minHeight: 240 }}><Spinner size={30} /></div>
        ) : everyone === 0 ? (
          <div className="empty">
            <BarChart3 size={40} strokeWidth={1.3} />
            <h2>No responses yet</h2>
            {form.status === "published" ? (
              <>
                <p>Share your link to start collecting responses. They'll show up here automatically.</p>
                <Link className="btn btn-primary" href={`/forms/${form.id}/share`}>Get the link</Link>{" "}
                <a className="btn" href={`/to/${form.public_id}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Open form</a>
              </>
            ) : (
              <>
                <p>Publish your form to start collecting responses.</p>
                <Link className="btn btn-primary" href={`/forms/${form.id}/share`}>Go to Share</Link>
              </>
            )}
          </div>
        ) : tab === "summary" ? (
          <Summary data={summary} />
        ) : (
          <>
            <div className="seg-filter" role="group" aria-label="Filter responses">
              {([["all", "All", summary.starts], ["completed", "Completed", summary.total_responses], ["partial", "Partial", summary.partial_responses]] as const).map(([k, label, n]) => (
                <button key={k} className={status === k ? "on" : ""} aria-pressed={status === k} onClick={() => { setStatus(k); setPage(1); }}>
                  {label} <span className="count">{n}</span>
                </button>
              ))}
            </div>
            {items.length === 0 && <p className="muted" style={{ padding: "28px 0", textAlign: "center" }}>No {status} responses.</p>}
            <div className="table-wrap" style={items.length === 0 ? { display: "none" } : undefined}>
              <table className="rtable">
                <thead>
                  <tr>
                    <th className="sticky">Submitted / last activity</th>
                    {data.columns.map((c, i) => <th key={c.ref} title={c.title}>{i + 1}. {c.title}{c.removed && " (deleted)"}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => {
                    const by = new Map(r.answers.map((a) => [a.question_ref, a.value]));
                    return (
                      <tr key={r.id} tabIndex={0} onClick={() => setOpen(r.id)} onKeyDown={(e) => e.key === "Enter" && setOpen(r.id)} className={open === r.id ? "active" : ""}>
                        <td className="sticky">{formatDateTime(r.submitted_at)}{r.status === "partial" && <span className="chip draft" style={{ marginLeft: 8 }}>Partial</span>}</td>
                        {data.columns.map((c) => {
                          const t = by.has(c.ref) ? formatAnswer(by.get(c.ref)) : null;
                          return <td key={c.ref} className={t === null ? "na" : t === "" ? "skip" : ""} title={t ?? undefined}>{t === null ? "—" : t || "skipped"}</td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <span className="muted">{total ? `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}` : ""}</span>
              <div className="row">
                <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={14} /> Previous</button>
                <span className="muted">Page {page} of {pages}</span>
                <button className="btn btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next <ChevronRight size={14} /></button>
              </div>
            </div>
          </>
        )}
      </div>

      {open !== null && data && (
        <ResponseDrawer
          formId={form.id}
          responseId={open}
          columns={data.columns}
          onClose={() => setOpen(null)}
          onPrev={openIdx > 0 ? () => setOpen(items[openIdx - 1].id) : undefined}
          onNext={openIdx >= 0 && openIdx < items.length - 1 ? () => setOpen(items[openIdx + 1].id) : undefined}
          onDeleted={() => { setOpen(null); load(); }}
        />
      )}
    </div>
  );
}
