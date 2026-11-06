"use client";
import { useEffect, useState } from "react";
import { intentUrl, shareText } from "@/lib/share";
import { renderResultImage, type ResultImageInput } from "@/lib/result-image";
import { loadResultImage, saveResultImage, RESULT_IMAGE_SAVED } from "@/lib/result-images";

type Props = ResultImageInput & { attemptsRemaining: number | null };
export function ShareResult({ id, text, prompt, result, checks, precheck, attemptsRemaining }: Props) {
  const [image, setImage] = useState<{ blob: Blob; url: string; hasStory: boolean } | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [message, setMessage] = useState("");
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
        if (!saved || text && !saved.hasStory) {
          const blob = await renderResultImage({ id, result, checks, precheck, text, prompt });
          saved = await saveResultImage({ id, image: blob, hasStory: !!text, savedAt: Date.now(), version: 1 });
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
  }, [id, text, prompt, result, checks, precheck, retry]);

  function saveImage() {
    if (!image) return;
    const link = document.createElement("a");
    link.href = image.url; link.download = "humansonly-result.png";
    document.body.appendChild(link); link.click(); link.remove();
  }
  async function share() {
    if (!image || result === "error") return;
    const file = new File([image.blob], "humansonly-result.png", { type: "image/png" });
    const copy = shareText(result, attemptsRemaining);
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      setMessage("Choose X to share the image and post text.");
      try { await navigator.share({ files: [file], text: copy }); }
      catch (cause) { setMessage(cause instanceof Error && cause.name === "AbortError" ? "" : "Sharing was unavailable. Save the image and open the X draft below."); }
      return;
    }
    // Web intents cannot attach a local image. Prepare the draft and image in
    // one action, leaving the actual attachment and publication to the visitor.
    const clipboard = navigator.clipboard && typeof ClipboardItem !== "undefined"
      ? navigator.clipboard.write([new ClipboardItem({ "image/png": image.blob })]).then(() => true, () => false)
      : Promise.resolve(false);
    window.open(intentUrl(result, attemptsRemaining), "_blank", "popup,width=640,height=720,noopener,noreferrer");
    saveImage();
    setMessage("X opens in a new window. Attach the downloaded image to your post.");
    if (await clipboard) setMessage("Image copied and downloaded. Paste it into the new X window, or attach the download.");
  }
  return <div className="share-result"><p>Result image // {result === "passed" ? "Pass" : result === "rejected" ? "Fail" : "Check unavailable"}</p>
    <div>{result !== "error" && <button className="primary-button" onClick={() => void share()} disabled={!image}>SHARE TO X ↗</button>}
      <a className="secondary-button" href={image?.url} download="humansonly-result.png" aria-disabled={!image}>Save image</a>
    </div>
    {image ? <a className="result-image-preview" href={image.url} target="_blank" rel="noopener noreferrer" aria-label="Open result image">
      {/* eslint-disable-next-line @next/next/no-img-element -- This private image is generated in the visitor's browser. */}
      <img src={image.url} alt={`HumansOnly result image: ${result === "passed" ? "Pass" : result === "rejected" ? "Fail" : "Check unavailable"}`} />
    </a> : error ? <p role="alert">Could not create the image. <button className="text-button" onClick={() => { setError(false); setRetry(value => value + 1); }}>Retry image</button></p> : <p role="status">Preparing your result image…</p>}
    {image && <small>{image.hasStory ? "Includes a story excerpt and all three checks. Saved only in this browser." : "Includes the available check results. The original story is no longer available here."}</small>}
    {message && <p role="status">{message} <a href={result === "error" ? undefined : intentUrl(result, attemptsRemaining)} target="_blank" rel="noopener noreferrer">Open X draft ↗</a></p>}
  </div>;
}
