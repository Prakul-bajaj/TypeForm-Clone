"use client";
import { Mail, MessageSquare, Sheet, Users, Webhook, Zap } from "lucide-react";
import { ComingSoon } from "@/components/ui";

export default function ConnectPage() {
  return (
    <div className="plain-page">
      <h1>Connect</h1>
      <p className="muted">Send responses to the tools your team already uses.</p>
      <div className="soon-list">
        <ComingSoon icon={<Webhook size={20} />} title="Webhooks" description="POST every new response to your own server in real time." />
        <ComingSoon icon={<Zap size={20} />} title="Zapier & Make" description="Trigger thousands of automations from a submission." />
        <ComingSoon icon={<Sheet size={20} />} title="Google Sheets" description="Append each response as a new row." />
        <ComingSoon icon={<MessageSquare size={20} />} title="Slack" description="Get notified in a channel when someone responds." />
        <ComingSoon icon={<Mail size={20} />} title="Email notifications" description="Receive an email for every submission." />
        <ComingSoon icon={<Users size={20} />} title="Team collaboration" description="Invite teammates to build and review results together." />
      </div>
    </div>
  );
}
