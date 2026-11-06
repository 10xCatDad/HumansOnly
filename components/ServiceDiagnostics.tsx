"use client";

import { useEffect, useRef, useState } from "react";
import type { ServiceDiagnostics as Diagnostics } from "@/lib/diagnostics";

const SEQUENCE = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
const time = (value: number) => new Date(value).toLocaleString();

export function ServiceDiagnostics({ onUnlocked }: { onUnlocked: () => Promise<void> }) {
  const [unlocked, setUnlocked] = useState(false);
  const [data, setData] = useState<Diagnostics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const panel = useRef<HTMLElement>(null);
  const callback = useRef(onUnlocked);
  const [retryUnlocked, setRetryUnlocked] = useState(false);
  callback.current = onUnlocked;

  useEffect(() => {
    if (unlocked) return;
    let recent: string[] = [];
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      if (event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey
        || target instanceof HTMLElement && (target.isContentEditable || !!target.closest("input, textarea, select"))) {
        recent = []; return;
      }
      recent = [...recent, event.key.length === 1 ? event.key.toLowerCase() : event.key].slice(-SEQUENCE.length);
      if (recent.length === SEQUENCE.length && recent.every((key, index) => key === SEQUENCE[index])) setUnlocked(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [unlocked]);

  useEffect(() => {
    if (!unlocked) return;
    panel.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView({ block: "start" });
  }, [unlocked]);

  useEffect(() => {
    if (!unlocked) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    async function load() {
      const unlock = await fetch("/api/diagnostics/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "uuddlrlrba" }), signal: controller.signal });
      if (!unlock.ok) throw new Error();
      setRetryUnlocked(true);
      await callback.current();
      const response = await fetch("/api/diagnostics", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        setData(await response.json() as Diagnostics);
    }
    void load()
      .catch(() => { if (!controller.signal.aborted) setError("Could not load diagnostics. Try refreshing."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [unlocked, refresh]);

  if (!unlocked) return null;
  return <section className="service-diagnostics" aria-labelledby="diagnostics-heading" ref={panel} tabIndex={-1}>
    <div className="diagnostics-topline"><h2 id="diagnostics-heading">SERVICE ERRORS // DIAGNOSTICS</h2><button className="text-button" onClick={() => setUnlocked(false)}>Hide diagnostics</button></div>
    {retryUnlocked && <p>Unlimited retries unlocked for this browser. The shared test budget still applies.</p>}
    {loading && <p role="status">Loading diagnostics…</p>}
    {error && <p role="alert">{error}</p>}
    {data && <>
      <p><strong>{data.totalErrors}</strong> service {data.totalErrors === 1 ? "error" : "errors"} since launch.</p>
      <dl className="diagnostics-services">
        <div><dt>Browser check</dt><dd>{data.services.browserConfigured ? "Configured" : "Not configured"}</dd></div>
        <div><dt>AI detection</dt><dd>{data.services.detectorConfigured ? "Configured" : "Not configured"}</dd></div>
        <div><dt>Story validator</dt><dd>{data.services.validatorOnline ? "Online" : "Offline"}</dd></div>
        <div><dt>Detector cooldown</dt><dd>{data.services.detectorPausedUntil ? `Until ${time(data.services.detectorPausedUntil)}` : "None"}</dd></div>
      </dl>
      {data.errors.length > 0 && <ul>{data.errors.map(item => <li key={item.code}>
        <h3><code>{item.code}</code> // {item.count}</h3><p>{item.description}</p>
        <small>Last seen // {item.lastSeen ? time(item.lastSeen) : "Time unavailable"}</small>
      </li>)}</ul>}
      {data.totalErrors === 0 && <p>No service errors recorded.</p>}
      {data.detailsUnavailable > 0 && <p>{data.detailsUnavailable} older {data.detailsUnavailable === 1 ? "error has" : "errors have"} no retained details.</p>}
      <small>Snapshot // {time(data.checkedAt)}. Counts and recorded reasons only; raw provider logs are not retained here.</small>
    </>}
    <button className="secondary-button" onClick={() => setRefresh(value => value + 1)} disabled={loading}>Refresh diagnostics</button>
  </section>;
}
