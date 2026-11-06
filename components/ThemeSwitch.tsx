"use client";

import { useEffect, useState } from "react";
import { Monitor, Sun, Moon } from "lucide-react";
import { resolveTheme, THEME_KEY, type ThemePreference } from "@/lib/theme";

const choices = [
  { value: "system", label: "System theme", title: "System: follow your device", Icon: Monitor },
  { value: "light", label: "Light theme", title: "Light theme", Icon: Sun },
  { value: "dark", label: "Dark theme", title: "Dark theme", Icon: Moon },
] as const;

export function ThemeSwitch() {
  const [preference, setPreference] = useState<ThemePreference>("system");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") setPreference(saved);
    } catch { /* Storage is optional. */ }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const apply = () => {
      const theme = resolveTheme(preference);
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    };
    apply();
    if (preference !== "system" || typeof window.matchMedia !== "function") return;
    const queries = [window.matchMedia("(prefers-color-scheme: dark)"), window.matchMedia("(prefers-color-scheme: light)")];
    queries.forEach(q => q.addEventListener?.("change", apply));
    return () => queries.forEach(q => q.removeEventListener?.("change", apply));
  }, [preference, ready]);
  function choose(next: ThemePreference) {
    setPreference(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* Storage is optional. */ }
  }
  return <div className="theme-switch" role="group" aria-label="Color theme">
    {choices.map(({ value, label, title, Icon }) => <button key={value} type="button" aria-label={label} title={title} aria-pressed={preference === value} onClick={() => choose(value)}><Icon size={18} strokeWidth={1.7} aria-hidden="true" /></button>)}
  </div>;
}
