"use client";
import { useEffect, useId, useState } from "react";
import { intentUrl } from "@/lib/share";
import { renderResultImage, type ResultImageInput } from "@/lib/result-image";
import { loadResultImage, saveResultImage, RESULT_IMAGE_SAVED, RESULT_IMAGE_VERSION } from "@/lib/result-images";

type Props = ResultImageInput & { attemptsRemaining: number | null };
export function ShareResult(props: Props) {
  return <ResultImageShare key={props.id} {...props} />;
}
function ResultImageShare({ id, result, checks, precheck, submittedAt, attemptsRemaining }: Props) {
  const [image, setImage] = useState<{ url: string } | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [showAttachReminder, setShowAttachReminder] = useState(false);
  const instructionsId = useId();
  useEffect(() => {
    let alive = true, currentUrl: string | undefined;
    function display(blob: Blob) {
      if (!alive) return;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      currentUrl = URL.createObjectURL(blob);
      setImage({ url: currentUrl }); setError(false);
    }
    async function prepare() {
      try {
        let saved = await loadResultImage(id);
        if (!saved) {
          const blob = await renderResultImage({ id, result, checks, precheck, submittedAt });
          saved = await saveResultImage({ id, image: blob, savedAt: Date.now(), version: RESULT_IMAGE_VERSION });
        }
        display(saved.image);
      } catch { if (alive) setError(true); }
    }
    async function updated(event: Event) {
      if ((event as CustomEvent).detail !== id) return;
      const saved = await loadResultImage(id);
      if (saved) display(saved.image);
    }
    void prepare();
    window.addEventListener(RESULT_IMAGE_SAVED, updated);
    return () => { alive = false; if (currentUrl) URL.revokeObjectURL(currentUrl); window.removeEventListener(RESULT_IMAGE_SAVED, updated); };
  }, [id, result, checks, precheck, submittedAt, retry]);

  function saveImage() {
    if (!image) return;
    const link = document.createElement("a");
    link.href = image.url; link.download = "humansonly-result.png";
    document.body.appendChild(link); link.click(); link.remove();
  }
  function share() {
    if (!image || result === "error") return;
    saveImage();
    // Keep both actions in the click handler. Web intents cannot attach files;
    // the visitor uploads the downloaded PNG using X's photo button.
    window.open(intentUrl(result, attemptsRemaining), "_blank", "popup,width=640,height=720,noopener,noreferrer");
    setShowAttachReminder(true);
  }
  return <div className="share-result"><p>Result image</p>
    {result !== "error" && <small id={instructionsId}>Downloads the PNG and opens X. Attach it using X’s photo button before posting.</small>}
    <div>{result !== "error" && <button className="primary-button" onClick={share} disabled={!image} aria-describedby={instructionsId}>SHARE TO X ↗</button>}
      <a className="secondary-button" href={image?.url} download="humansonly-result.png" aria-disabled={!image}>Save image</a>
    </div>
    {showAttachReminder && result !== "error" && <p role="status">Attach humansonly-result.png in X before posting. <a href={intentUrl(result, attemptsRemaining)} target="_blank" rel="noopener noreferrer">Open X draft ↗</a></p>}
    {image ? <a className="result-image-preview" href={image.url} target="_blank" rel="noopener noreferrer" aria-label="Open result image">
      {/* eslint-disable-next-line @next/next/no-img-element -- Result images are generated and cached locally. */}
      <img src={image.url} alt={`HumansOnly result image: ${result === "passed" ? "Pass" : result === "rejected" ? "Fail" : "Check unavailable"}`} />
    </a> : error ? <p role="alert">RESULT IMAGE GENERATION FAILURE <button className="text-button" onClick={() => { setError(false); setRetry(value => value + 1); }}>Retry image</button></p> : <p role="status">Preparing your result image…</p>}
  </div>;
}
