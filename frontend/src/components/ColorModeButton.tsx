"use client";
import { Moon, Sun } from "lucide-react";
import { useColorMode } from "@/lib/colorMode";

/** Sun / moon button that switches the app between light and dark mode. */
export default function ColorModeButton() {
  const { resolved, toggle } = useColorMode();
  const dark = resolved === "dark";
  return (
    <button className="icon-btn" onClick={toggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title={dark ? "Light mode" : "Dark mode"}>
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
