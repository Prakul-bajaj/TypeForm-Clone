"use client";
import { ArrowLeft, Check, CircleAlert, Eye, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import PreviewOverlay from "@/components/builder/PreviewOverlay";
import ShareModal from "@/components/builder/ShareModal";
import { Spinner } from "@/components/ui";
import { hasUnsaved, useBuilder, useBuilderPick } from "@/lib/store";
import { toast } from "@/lib/toast";
import RequireAuth from "@/components/auth/RequireAuth";
import ColorModeButton from "@/components/ColorModeButton";

const TABS = [
  { slug: "edit", label: "Content" },
  { slug: "workflow", label: "Workflow" },
  { slug: "connect", label: "Connect" },
  { slug: "share", label: "Share" },
  { slug: "results", label: "Results" },
];

export default function FormShell({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <FormShellInner>{children}</FormShellInner>
    </RequireAuth>
  );
}

function FormShellInner({ children }: { children: React.ReactNode }) {
  const { id: rawId } = useParams<{ id: string }>();
  const id = Number(rawId);
  const pathname = usePathname();
  const router = useRouter();
  const { form, loading, error, pending, saveError, load, reset, setTitle, publish } = useBuilderPick((s) => ({
    form: s.form, loading: s.loading, error: s.error, pending: s.pending, saveError: s.saveError,
    load: s.load, reset: s.reset, setTitle: s.setTitle, publish: s.publish,
  }));
  const [previewing, setPreviewing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    load(id);
    return () => reset();
  }, [id, load, reset]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (hasUnsaved()) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  useEffect(() => {
    if (form) document.title = `${form.title || "Untitled form"} · Typeform Clone`;
  }, [form?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="page-center"><Spinner size={32} /></div>;
  if (error || !form) {
    return (
      <div className="page-center">
        <div>
          <h2 style={{ color: "var(--ink)" }}>{error === "Form not found" ? "We couldn't find that form" : "Couldn't load the form"}</h2>
          <p>{error}</p>
          <Link className="btn" href="/"><ArrowLeft size={16} /> Back to workspace</Link>
        </div>
      </div>
    );
  }

  const published = form.status === "published";
  const cta = !published ? "Publish" : form.has_unpublished_changes ? "Publish changes" : "Share";

  const onCta = async () => {
    if (published && !form.has_unpublished_changes) return setSharing(true);
    setPublishing(true);
    const ok = await publish();
    setPublishing(false);
    if (!ok) return;
    if (published) toast.success("Changes published — your live form is up to date");
    else {
      toast.success("Form published");
      setSharing(true);
    }
  };

  return (
    <div className="bd">
      <header className="bd-top">
        <div className="bd-title-wrap">
          <button className="icon-btn" aria-label="Back to workspace" onClick={() => router.push("/")}><ArrowLeft size={18} /></button>
          <input
            className="bd-title"
            value={form.title}
            maxLength={200}
            style={{ width: `${Math.min(34, Math.max(8, form.title.length + 2))}ch` }}
            aria-label="Form name"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => !form.title.trim() && setTitle("Untitled form")}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          <span className={"chip " + (published ? (form.has_unpublished_changes ? "warn" : "live") : "draft")}>
            {published ? (form.has_unpublished_changes ? "Unpublished edits" : "Published") : "Draft"}
          </span>
        </div>

        <nav className="bd-tabs" aria-label="Form sections">
          {TABS.map((t) => {
            const href = `/forms/${id}/${t.slug}`;
            const active = pathname.startsWith(href);
            return <Link key={t.slug} href={href} className={active ? "on" : ""} aria-current={active ? "page" : undefined}>{t.label}</Link>;
          })}
        </nav>

        <div className="bd-right-actions">
          <span className={"save-state" + (saveError ? " err" : "")} role="status" aria-live="polite">
            {saveError ? <><CircleAlert size={14} /> Not saved</> : pending > 0 ? <><Loader2 size={14} className="spin" /> Saving…</> : <><Check size={14} /> Saved</>}
          </span>
          <ColorModeButton />
          <button className="btn" onClick={() => setPreviewing(true)}><Eye size={16} /> Preview</button>
          <button className="btn btn-primary" onClick={onCta} disabled={publishing}>{publishing ? "Publishing…" : cta}</button>
        </div>
      </header>

      <div className="bd-content">{children}</div>

      {previewing && <PreviewOverlay onClose={() => setPreviewing(false)} />}
      <ShareModal open={sharing} onClose={() => setSharing(false)} />
    </div>
  );
}
