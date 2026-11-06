"use client";

import { useEffect, useState } from "react";
import { resolveTheme, THEME_KEY, type ThemePreference } from "@/lib/theme";

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
  return <select className="theme-select" aria-label="Color theme" value={preference} onChange={event => {
    const next = event.target.value as ThemePreference;
    setPreference(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* Storage is optional. */ }
  }}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select>;
}
