"use client";
import {
  BarChart3, Copy, ExternalLink, FilePlus2, Link2, Pencil, Plus, Search, Sparkles, Trash2, Upload, LayoutTemplate,
  EllipsisVertical, Globe, GlobeLock,
} from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { timeAgo, publicUrl } from "@/lib/format";
import { toast } from "@/lib/toast";
import type { FormSummary } from "@/lib/types";
import { ConfirmModal, MenuButton, Modal } from "@/components/ui";
import RequireAuth from "@/components/auth/RequireAuth";
import UserMenu from "@/components/auth/UserMenu";
import ColorModeButton from "@/components/ColorModeButton";
import { useAuth } from "@/components/auth/AuthProvider";

type Sort = "updated" | "name" | "responses";

export default function WorkspacePage() {
  return (
    <RequireAuth>
      <Workspace />
    </RequireAuth>
  );
}

function Workspace() {
  const { user } = useAuth();
  const router = useRouter();
  const [forms, setForms] = useState<FormSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("updated");

  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<FormSummary | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deleting, setDeleting] = useState<FormSummary | null>(null);

  const load = useCallback(async () => {
    try {
      setForms(await api.listForms());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load forms");
    }
  }, []);
  useEffect(() => void load(), [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (forms ?? []).filter((f) => f.title.toLowerCase().includes(q));
    return list.sort((a, b) =>
      sort === "name" ? a.title.localeCompare(b.title) : sort === "responses" ? b.response_count - a.response_count : +new Date(b.updated_at) - +new Date(a.updated_at),
    );
  }, [forms, query, sort]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      const f = await api.createForm(newTitle.trim() || "Untitled form");
      router.push(`/forms/${f.id}/edit`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create the form");
      setBusy(false);
    }
  };

  return (
    <div className="ws">
      <header className="ws-top">
        <span className="logo"><i /> Typeform Clone</span>
        <span className="spacer" />
        <span className="muted" style={{ fontSize: 13 }}>{user?.name}</span>
        <ColorModeButton />
        <UserMenu />
      </header>

      <main className="ws-main">
        <div className="ws-head">
          <div>
            <h1>My workspace</h1>
            <div className="muted" style={{ marginTop: 2 }}>
              {forms ? `${forms.length} form${forms.length === 1 ? "" : "s"}` : "Loading…"}
            </div>
          </div>
          <button className="btn btn-primary btn-lg" onClick={() => { setNewTitle(""); setCreating(true); }}>
            <Plus size={18} /> Create form
          </button>
        </div>

        <div className="ws-tools">
          <div className="search">
            <Search size={16} />
            <input className="input" placeholder="Search forms" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search forms" />
          </div>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort forms">
            <option value="updated">Last updated</option>
            <option value="name">Name (A–Z)</option>
            <option value="responses">Most responses</option>
          </select>
        </div>

        {error ? (
          <div className="empty">
            <h2>Can't reach the server</h2>
            <p>{error}</p>
            <button className="btn" onClick={load}>Try again</button>
          </div>
        ) : forms === null ? (
          <div className="forms" aria-busy>{[0, 1, 2].map((i) => <div className="skeleton" key={i} />)}</div>
        ) : forms.length === 0 ? (
          <div className="empty">
            <FilePlus2 size={40} strokeWidth={1.4} />
            <h2>Create your first form</h2>
            <p>Ask one question at a time and get more answers.</p>
            <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> Create form</button>
          </div>
        ) : visible.length === 0 ? (
          <div className="empty"><h2>No forms match “{query}”</h2></div>
        ) : (
          <div className="forms">
            <div className="forms-head">
              <span>Name</span><span>Responses</span><span>Status</span><span />
            </div>
            {visible.map((f) => (
              <div key={f.id} className="form-row" onClick={() => router.push(`/forms/${f.id}/edit`)} role="link" tabIndex={0}
                   onKeyDown={(e) => e.key === "Enter" && router.push(`/forms/${f.id}/edit`)}>
                <div className="form-id">
                  <div className="thumb" style={{ background: "#fff" }} aria-hidden><b style={{ background: "#262627" }} /><i style={{ background: "#0445AF" }} /></div>
                  <div style={{ minWidth: 0 }}>
                    <div className="form-title">{f.title}</div>
                    <div className="form-meta">Updated {timeAgo(f.updated_at)} · {f.question_count} question{f.question_count === 1 ? "" : "s"}</div>
                  </div>
                </div>
                <div className="col-resp" onClick={(e) => e.stopPropagation()}>
                  <Link className="resp-link" href={`/forms/${f.id}/results`} title="View responses">{f.response_count}</Link>
                </div>
                <div className="col-status">
                  {f.status === "published" ? (
                    <span className={"chip " + (f.has_unpublished_changes ? "warn" : "live")}>
                      <span className="dot" />{f.has_unpublished_changes ? "Unpublished edits" : "Published"}
                    </span>
                  ) : (
                    <span className="chip draft">Draft</span>
                  )}
                </div>
                <MenuButton
                  trigger={<EllipsisVertical size={18} />}
                  label={`Actions for ${f.title}`}
                  items={[
                    { label: "Edit", icon: <Pencil size={15} />, onClick: () => router.push(`/forms/${f.id}/edit`) },
                    { label: "View results", icon: <BarChart3 size={15} />, onClick: () => router.push(`/forms/${f.id}/results`) },
                    { label: "Rename", icon: <Pencil size={15} />, onClick: () => { setRenaming(f); setRenameTitle(f.title); } },
                    { label: "Duplicate", icon: <Copy size={15} />, onClick: () => act(() => api.duplicateForm(f.id), "Form duplicated") },
                    { label: "Copy link", icon: <Link2 size={15} />, hidden: f.status !== "published", divider: true,
                      onClick: () => navigator.clipboard.writeText(publicUrl(f.public_id)).then(() => toast.success("Link copied"), () => toast.error("Couldn't copy the link")) },
                    { label: "Open public link", icon: <ExternalLink size={15} />, hidden: f.status !== "published", onClick: () => window.open(`/to/${f.public_id}`, "_blank") },
                    f.status === "published"
                      ? { label: "Unpublish", icon: <GlobeLock size={15} />, onClick: () => act(() => api.unpublishForm(f.id), "Form unpublished") }
                      : { label: "Publish", icon: <Globe size={15} />, onClick: () => act(async () => {
                          try { await api.publishForm(f.id); toast.success("Form published"); }
                          catch (e) { throw new Error(e instanceof ApiError && e.errors[0] ? `${e.errors[0].message} — open the form to fix it` : e instanceof Error ? e.message : "Couldn't publish"); }
                        }) },
                    { label: "Delete", icon: <Trash2 size={15} />, danger: true, divider: true, onClick: () => setDeleting(f) },
                  ]}
                />
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Create */}
      <Modal open={creating} onClose={() => !busy && setCreating(false)} title="Create a new form" width={560}
        footer={<>
          <button className="btn" onClick={() => setCreating(false)} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={create} disabled={busy}>{busy ? "Creating…" : "Create form"}</button>
        </>}>
        <form onSubmit={(e) => { e.preventDefault(); create(); }}>
          <div className="field">
            <label htmlFor="new-title">Form name</label>
            <input id="new-title" className="input" data-autofocus maxLength={200} placeholder="e.g. Customer feedback" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            <span className="field-hint">You can rename it any time.</span>
          </div>
        </form>
        <div className="label" style={{ margin: "4px 0 8px" }}>Other ways to start</div>
        <div className="create-grid">
          <div className="create-card"><Sparkles size={16} /><b>Generate with AI</b>Coming soon</div>
          <div className="create-card"><LayoutTemplate size={16} /><b>Browse templates</b>Coming soon</div>
          <div className="create-card"><Upload size={16} /><b>Import questions</b>Coming soon</div>
        </div>
      </Modal>

      {/* Rename */}
      <Modal open={!!renaming} onClose={() => setRenaming(null)} title="Rename form" width={440}
        footer={<>
          <button className="btn" onClick={() => setRenaming(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !renameTitle.trim()}
            onClick={() => renaming && act(async () => { await api.updateForm(renaming.id, { title: renameTitle.trim() }); setRenaming(null); }, "Form renamed")}>Save</button>
        </>}>
        <form onSubmit={(e) => { e.preventDefault(); if (renaming && renameTitle.trim()) act(async () => { await api.updateForm(renaming.id, { title: renameTitle.trim() }); setRenaming(null); }, "Form renamed"); }}>
          <div className="field">
            <label htmlFor="rename">Form name</label>
            <input id="rename" className="input" data-autofocus maxLength={200} value={renameTitle} onChange={(e) => setRenameTitle(e.target.value)} />
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={!!deleting}
        title="Delete this form?"
        message={<>“{deleting?.title}” and its {deleting?.response_count ?? 0} response{deleting?.response_count === 1 ? "" : "s"} will be permanently deleted. This can't be undone.</>}
        busy={busy}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && act(async () => { await api.deleteForm(deleting.id); setDeleting(null); }, "Form deleted")}
      />
    </div>
  );
}
