"use client";
import { useCallback, useEffect, useState } from "react";

/** Dark mode for the app itself (workspace, builder, results, login). Forms keep the creator's own theme. */
export type ColorMode = "light" | "dark" | "system";

const KEY = "tf_color_mode";

/** Inlined in <head> (see app/layout.tsx) so the right theme is set before first paint → no white flash. */
export const COLOR_MODE_BOOT_SCRIPT = `(function(){try{var m=localStorage.getItem('${KEY}')||'system';var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){}})()`;

function readMode(): ColorMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
const resolve = (m: ColorMode): "light" | "dark" => (m === "system" ? (prefersDark() ? "dark" : "light") : m);

export function useColorMode() {
  const [mode, setModeState] = useState<ColorMode>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  const apply = useCallback((m: ColorMode) => {
    const r = resolve(m);
    document.documentElement.dataset.theme = r;
    setResolved(r);
  }, []);

  useEffect(() => {
    const m = readMode();
    setModeState(m);
    apply(m);
  }, [apply]);

  // "system" follows the OS setting live
  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => apply("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [mode, apply]);

  const setMode = useCallback(
    (m: ColorMode) => {
      try {
        localStorage.setItem(KEY, m);
      } catch {
        /* ignore */
      }
      setModeState(m);
      apply(m);
    },
    [apply],
  );

  const toggle = useCallback(() => setMode(resolved === "dark" ? "light" : "dark"), [resolved, setMode]);
  return { mode, resolved, setMode, toggle };
}
