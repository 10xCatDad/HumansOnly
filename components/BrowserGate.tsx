"use client";
import { useEffect, useRef } from "react";
import { TURNSTILE_ACTION } from "@/lib/turnstile";

type Turnstile = {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  remove(id: string): void;
};
declare global { interface Window { turnstile?: Turnstile } }
let scriptPromise: Promise<Turnstile> | null = null;
function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    const timeout = setTimeout(fail, 15_000);
    function fail() { clearTimeout(timeout); script.remove(); reject(new Error("Browser check could not load.")); }
    script.onerror = fail;
    script.onload = () => { clearTimeout(timeout); if (window.turnstile) resolve(window.turnstile); else fail(); };
    document.head.appendChild(script);
  }).catch(error => { scriptPromise = null; throw error; });
  return scriptPromise;
}
export function BrowserGate({ siteKey, onVerified, onError }: { siteKey: string; onVerified: (token: string) => void; onError: (message: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onVerified, onError });
  useEffect(() => { callbacks.current = { onVerified, onError }; }, [onVerified, onError]);
  useEffect(() => {
    let alive = true, widget: string | undefined, api: Turnstile | undefined, lastMode = "";
    const render = () => {
      if (!alive || !api || !container.current) return;
      const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
      const size = container.current.clientWidth < 300 ? "compact" : "flexible";
      if (`${theme}:${size}` === lastMode) return;
      lastMode = `${theme}:${size}`;
      if (widget !== undefined) api.remove(widget);
      widget = api.render(container.current, {
        sitekey: siteKey, action: TURNSTILE_ACTION, theme, size, "response-field": false,
        callback: (token: string) => { if (alive) callbacks.current.onVerified(token); },
        "error-callback": () => { if (alive) callbacks.current.onError("The browser check could not complete. Please retry it."); },
        "expired-callback": () => { if (alive) callbacks.current.onError("The browser check expired. Please retry it."); },
        "timeout-callback": () => { if (alive) callbacks.current.onError("The browser check timed out. Please retry it."); },
      });
    };
    const themeObserver = new MutationObserver(render);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const sizeObserver = new ResizeObserver(render);
    if (container.current) sizeObserver.observe(container.current);
    loadTurnstile().then(loaded => { api = loaded; render(); }).catch(() => { if (alive) callbacks.current.onError("The browser check could not load. Please retry it."); });
    return () => { alive = false; themeObserver.disconnect(); sizeObserver.disconnect(); if (api && widget !== undefined) api.remove(widget); };
  }, [siteKey]);
  return <div ref={container} className="browser-gate-widget" />;
}
