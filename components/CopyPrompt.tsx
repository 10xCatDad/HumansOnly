"use client";
import { useState } from "react";
import { Copy, Check } from "lucide-react";
import type { StoryPrompt } from "@/lib/challenge";

export function CopyPrompt({ prompt, minWords, maxWords }: { prompt: StoryPrompt; minWords: number; maxWords: number }) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const text = `Write a short story of ${minWords}-${maxWords} words using all three requirements below.\n\nSetting and time: ${prompt.setting}\nCharacters: ${prompt.characters}\nConflict: ${prompt.conflict}\n\nReturn only the story.`;
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setManual(false); }
    catch { setManual(true); }
  }
  return <div className="copy-prompt">
    <button className="secondary-button" type="button" onClick={() => void copy()}>{copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copied ? "COPIED" : "COPY PROMPT"}</button>
    <span role="status" className="sr-only">{copied ? "Prompt copied." : ""}</span>
    {manual && <><p>Select and copy the prompt below.</p><textarea aria-label="Prompt to copy" readOnly value={text} onFocus={event => event.currentTarget.select()} /></>}
  </div>;
}
