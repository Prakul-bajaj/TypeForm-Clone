"use client";
import { Check, Code2, Copy, ExternalLink, Globe, GlobeLock, QrCode } from "lucide-react";
import { useState } from "react";
import { copyToClipboard } from "@/components/builder/ShareModal";
import { ComingSoon } from "@/components/ui";
import { publicUrl } from "@/lib/format";
import { useBuilderPick } from "@/lib/store";
import { toast } from "@/lib/toast";

export default function SharePage() {
  const { form, publish, unpublish } = useBuilderPick((s) => ({ form: s.form!, publish: s.publish, unpublish: s.unpublish }));
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = form.status === "published";
  const url = publicUrl(form.public_id);
  return (
    <div className="plain-page">
      <h1>Share</h1>
      <p className="muted">Publish your form to get a public link anyone can use — no login required.</p>

      <section className="card">
        <div className="row between">
          <div>
            <h3>Link</h3>
            <p className="muted" style={{ margin: "2px 0 0" }}>
              {live ? (form.has_unpublished_changes ? "Live — but you have edits that aren't published yet." : "Live and accepting responses.") : "Not published yet. Publish to activate the link."}
            </p>
          </div>
          {live ? (
            <div className="row">
              {form.has_unpublished_changes && (
                <button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); if (await publish()) toast.success("Changes published"); setBusy(false); }}>Publish changes</button>
              )}
              <button className="btn" disabled={busy} onClick={async () => { await unpublish(); toast.info("Form unpublished — the link is now closed"); }}><GlobeLock size={16} /> Unpublish</button>
            </div>
          ) : (
            <button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); if (await publish()) toast.success("Form published"); setBusy(false); }}><Globe size={16} /> Publish</button>
          )}
        </div>
        <div className="link-box" style={{ marginTop: 14, opacity: live ? 1 : 0.55 }}>
          <input className="input" readOnly value={url} aria-label="Public form link" onFocus={(e) => e.target.select()} />
          <button className="btn btn-primary" disabled={!live} onClick={() => { copyToClipboard(url); setCopied(true); setTimeout(() => setCopied(false), 1800); }}>
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy"}
          </button>
          {live ? <a className="btn" href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} /> Open</a> : <span className="btn" aria-disabled style={{ opacity: 0.55 }}><ExternalLink size={16} /> Open</span>}
        </div>
      </section>

      <div className="soon-list" style={{ marginTop: 20 }}>
        <ComingSoon icon={<QrCode size={20} />} title="QR code" description="Download a QR code for print and events." />
        <ComingSoon icon={<Code2 size={20} />} title="Embed" description="Embed the form on your site as a widget, popup or full page." />
      </div>
    </div>
  );
}
