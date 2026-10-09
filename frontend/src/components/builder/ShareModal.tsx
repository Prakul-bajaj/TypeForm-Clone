"use client";
import { Check, Copy, ExternalLink, GlobeLock, QrCode } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/ui";
import { publicUrl } from "@/lib/format";
import { useBuilder } from "@/lib/store";
import { toast } from "@/lib/toast";

export function copyToClipboard(text: string) {
  return navigator.clipboard.writeText(text).then(
    () => toast.success("Link copied to clipboard"),
    () => toast.error("Couldn't copy — select the link and copy it manually"),
  );
}

export default function ShareModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const form = useBuilder((s) => s.form)!;
  const unpublish = useBuilder((s) => s.unpublish);
  const [copied, setCopied] = useState(false);
  const url = publicUrl(form.public_id);
  return (
    <Modal open={open} onClose={onClose} title="Your form is live 🎉" width={520}>
      <p className="muted" style={{ marginTop: 0 }}>Anyone with this link can fill in your form — no account needed.</p>
      <div className="link-box">
        <input className="input" readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Public form link" data-autofocus />
        <button className="btn btn-primary" onClick={() => { copyToClipboard(url); setCopied(true); setTimeout(() => setCopied(false), 1800); }}>
          {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="row" style={{ marginTop: 14, gap: 8, flexWrap: "wrap" }}>
        <a className="btn btn-sm" href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Open form</a>
        <span className="btn btn-sm" aria-disabled style={{ opacity: 0.55, cursor: "not-allowed" }}><QrCode size={14} /> QR code · soon</span>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={async () => { await unpublish(); onClose(); toast.info("Form unpublished — the link is now closed"); }}>
          <GlobeLock size={14} /> Unpublish
        </button>
      </div>
    </Modal>
  );
}
