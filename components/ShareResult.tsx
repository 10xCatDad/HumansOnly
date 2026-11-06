"use client";
import { useEffect, useState } from "react";
import { intentUrl } from "@/lib/share";
import { renderResultImage, type ResultImageInput } from "@/lib/result-image";
import { loadResultImage, saveResultImage, RESULT_IMAGE_SAVED, RESULT_IMAGE_VERSION } from "@/lib/result-images";

type Props = ResultImageInput & { attemptsRemaining: number | null };
type HostedImage = { shareUrl: string; imageUrl: string };
function validHosted(value: unknown): value is HostedImage {
  if (!value || typeof value !== "object") return false;
  const row = value as HostedImage;
  return typeof row.shareUrl === "string" && /^https:\/\/art\.10xcatdad\.xyz\/r\/[a-f0-9]{64}$/.test(row.shareUrl) && row.imageUrl === `${row.shareUrl}/image.png`;
}
export function ShareResult({ id, text, prompt, result, checks, precheck, submittedAt, attemptsRemaining }: Props) {
  const [image, setImage] = useState<{ blob: Blob; url: string; hasStory: boolean } | null>(null);
  const [hosted, setHosted] = useState<HostedImage | null>(null);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [message, setMessage] = useState("");
  const endpoint = `/api/result-image?id=${encodeURIComponent(id)}`;
  useEffect(() => {
    let alive = true, currentUrl: string | undefined;
    function display(blob: Blob, hasStory: boolean) {
      if (!alive) return;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      currentUrl = URL.createObjectURL(blob);
      setImage({ blob, url: currentUrl, hasStory }); setError(false);
    }
    async function prepare() {
      try {
        let saved = await loadResultImage(id);
        try {
          const response = await fetch(endpoint, { credentials: "same-origin", signal: AbortSignal.timeout(8_000) });
          const remote: unknown = response.ok ? await response.json() : null;
          if (validHosted(remote)) {
            if (alive) setHosted(remote);
            if (!saved) {
              const response = await fetch(remote.imageUrl, { credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(8_000) });
              if (response.ok && response.headers.get("content-type") === "image/png") {
                const blob = await response.blob();
                if (blob.size <= 2 * 1024 * 1024) saved = await saveResultImage({ id, image: blob, hasStory: true, savedAt: Date.now(), version: RESULT_IMAGE_VERSION });
              }
            }
          }
        } catch { /* A local image remains available when hosting is offline. */ }
        if (!saved || text && (!saved.hasStory || saved.version < RESULT_IMAGE_VERSION)) {
          const blob = await renderResultImage({ id, result, checks, precheck, text, prompt, submittedAt });
          saved = await saveResultImage({ id, image: blob, hasStory: !!text, savedAt: Date.now(), version: RESULT_IMAGE_VERSION });
        }
        display(saved.image, saved.hasStory);
      } catch { if (alive) setError(true); }
    }
    async function updated(event: Event) {
      if ((event as CustomEvent).detail !== id) return;
      const saved = await loadResultImage(id);
      if (saved) display(saved.image, saved.hasStory);
    }
    void prepare();
    window.addEventListener(RESULT_IMAGE_SAVED, updated);
    return () => { alive = false; if (currentUrl) URL.revokeObjectURL(currentUrl); window.removeEventListener(RESULT_IMAGE_SAVED, updated); };
  }, [id, endpoint, text, prompt, result, checks, precheck, submittedAt, retry]);

  function saveImage() {
    if (!image) return;
    const link = document.createElement("a");
    link.href = image.url; link.download = "humansonly-result.png";
    document.body.appendChild(link); link.click(); link.remove();
  }
  async function share() {
    if (!image || result === "error" || sharing) return;
    if (hosted) {
      window.open(intentUrl(result, attemptsRemaining, hosted.shareUrl), "_blank", "popup,width=640,height=720,noopener,noreferrer");
      setMessage("X draft opened. Its image preview is up to X. Review it before posting."); return;
    }
    // Open during the click, before uploading, to preserve popup permission.
    // Deliberately bypass navigator.share, which opens Windows Share on PCs.
    const popup = window.open("about:blank", "_blank", "popup,width=640,height=720");
    if (popup) {
      popup.opener = null;
      popup.document.title = "Preparing X draft";
      popup.document.body.textContent = "Preparing your X draft…";
      const meta = popup.document.createElement("meta"); meta.name = "referrer"; meta.content = "no-referrer"; popup.document.head.appendChild(meta);
    }
    setSharing(true); setMessage("Saving the image for your X draft…");
    try {
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "image/png" }, body: image.blob, signal: AbortSignal.timeout(25_000) });
      const saved: unknown = await response.json();
      if (!response.ok || !validHosted(saved)) throw new Error("Image hosting is unavailable.");
      setHosted(saved);
      const draft = intentUrl(result, attemptsRemaining, saved.shareUrl);
      if (popup && !popup.closed) popup.location.replace(draft);
      setMessage(popup ? "X draft opened with your result link. X decides whether to show the image preview." : "Your result link is ready. Use Open X draft below.");
    } catch {
      if (popup && !popup.closed) popup.location.replace(intentUrl(result, attemptsRemaining));
      saveImage();
      setMessage("Image hosting is unavailable. Attach the downloaded image to your X draft instead.");
    } finally { setSharing(false); }
  }
  return <div className="share-result"><p>Result image</p>
    <div>{result !== "error" && <button className="primary-button" onClick={() => void share()} disabled={!image || sharing}>{sharing ? "PREPARING X DRAFT…" : "SHARE TO X ↗"}</button>}
      <a className="secondary-button" href={image?.url} download="humansonly-result.png" aria-disabled={!image}>Save image</a>
    </div>
    {image ? <a className="result-image-preview" href={image.url} target="_blank" rel="noopener noreferrer" aria-label="Open result image">
      {/* eslint-disable-next-line @next/next/no-img-element -- Result images are generated locally or retrieved from their unlisted link. */}
      <img src={image.url} alt={`HumansOnly result image: ${result === "passed" ? "Pass" : result === "rejected" ? "Fail" : "Check unavailable"}`} />
    </a> : error ? <p role="alert">RESULT IMAGE GENERATION FAILURE <button className="text-button" onClick={() => { setError(false); setRetry(value => value + 1); }}>Retry image</button></p> : <p role="status">Preparing your result image…</p>}
    {image && <small>{hosted ? "Unlisted // anyone with the link can view this image." : "Sharing saves this image at an unlisted link. Anyone with the link can view it."}</small>}
    {message && <p role="status">{message} <a href={result === "error" ? undefined : intentUrl(result, attemptsRemaining, hosted?.shareUrl)} target="_blank" rel="noopener noreferrer">Open X draft ↗</a></p>}
  </div>;
}
