export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  const units: [number, string][] = [[60, "minute"], [3600, "hour"], [86400, "day"], [604800, "week"], [2629800, "month"], [31557600, "year"]];
  let out = "just now";
  for (let i = 0; i < units.length; i++) {
    const [secs, name] = units[i];
    if (s >= secs) {
      const n = Math.floor(s / secs);
      out = `${n} ${name}${n === 1 ? "" : "s"} ago`;
    }
  }
  return out;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return "—";
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

export function formatAnswer(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object" && v !== null && "name" in v) return String((v as { name: unknown }).name); // file answer
  return String(v);
}

export const publicUrl = (publicId: string) =>
  `${typeof window !== "undefined" ? window.location.origin : ""}/to/${publicId}`;
