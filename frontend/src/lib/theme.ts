import type { CSSProperties } from "react";
import { API_URL } from "./api";
import type { Theme } from "./types";

/** Uploaded backgrounds are served by the API ("/api/public/assets/…"); external URLs are used as they are. */
export function bgUrl(url: string | undefined | null): string {
  if (!url) return "";
  return url.startsWith("/api/") ? `${API_URL}${url}` : url.replace(/["()\\\s]/g, encodeURIComponent);
}

export const APP_NAME = "Typeform Clone";

export const FONT_STACK: Record<Theme["font"], string> = {
  Karla: "'Karla', system-ui, sans-serif",
  Inter: "'Inter', system-ui, sans-serif",
  "Playfair Display": "'Playfair Display', Georgia, serif",
  "Space Grotesk": "'Space Grotesk', system-ui, sans-serif",
  Georgia: "Georgia, 'Times New Roman', serif",
  Verdana: "Verdana, Geneva, sans-serif",
  "Courier New": "'Courier New', Courier, monospace",
};

export const THEME_PRESETS: Theme[] = [
  { name: "Classic", font: "Karla", background: "#FFFFFF", question_color: "#262627", answer_color: "#0445AF", button_color: "#0445AF", button_text_color: "#FFFFFF", background_image: "", background_overlay: 0 },
  { name: "Midnight", font: "Inter", background: "#0F172A", question_color: "#F8FAFC", answer_color: "#38BDF8", button_color: "#38BDF8", button_text_color: "#0F172A", background_image: "", background_overlay: 0 },
  { name: "Sunset", font: "Karla", background: "#FFF4E6", question_color: "#3B1F0B", answer_color: "#D9480F", button_color: "#D9480F", button_text_color: "#FFFFFF", background_image: "", background_overlay: 0 },
  { name: "Forest", font: "Space Grotesk", background: "#F1F7F2", question_color: "#12351F", answer_color: "#2F7D4B", button_color: "#2F7D4B", button_text_color: "#FFFFFF", background_image: "", background_overlay: 0 },
  { name: "Rosé", font: "Playfair Display", background: "#FFF0F3", question_color: "#4A1020", answer_color: "#C2255C", button_color: "#C2255C", button_text_color: "#FFFFFF", background_image: "", background_overlay: 0 },
  { name: "Mono", font: "Inter", background: "#F5F5F5", question_color: "#111111", answer_color: "#111111", button_color: "#111111", button_text_color: "#FFFFFF", background_image: "", background_overlay: 0 },
];

/** CSS custom properties consumed by runtime.css — the whole look is driven by these tokens. */
export function themeStyle(t: Theme): CSSProperties {
  const img = bgUrl(t.background_image);
  return {
    "--tf-bg-image": img ? `url("${img}")` : "none",
    "--tf-overlay": String((t.background_overlay || 0) / 100),
    "--tf-bg": t.background,
    "--tf-q": t.question_color,
    "--tf-a": t.answer_color,
    "--tf-btn": t.button_color,
    "--tf-btn-text": t.button_text_color,
    "--tf-font": FONT_STACK[t.font] ?? FONT_STACK.Karla,
  } as CSSProperties;
}
