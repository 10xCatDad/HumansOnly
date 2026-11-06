"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { SuccessFireworks } from "./SuccessFireworks";

export function ResultDialog({ open, result, onClose, children }: { open: boolean; result: "passed" | "rejected"; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (open && node && !node.open) node.showModal();
    else if (!open && node?.open) node.close();
  }, [open]);
  return <dialog ref={dialog} className="result-dialog" aria-labelledby="result-dialog-title" onClose={onClose} onClick={event => { if (event.target === dialog.current) dialog.current?.close(); }}>
    <div className="result-dialog-body">
      {open && result === "passed" && <SuccessFireworks />}
      <div className="result-dialog-topline"><span>LEVEL 1 // RESULT</span><button aria-label="Close result" onClick={() => dialog.current?.close()} autoFocus><X size={22} /></button></div>
      <h2 id="result-dialog-title" className={result === "passed" ? "history-passed" : "history-rejected"}>{result === "passed" ? "Pass" : "Fail"}</h2>
      <p>{result === "passed" ? "Challenge I cleared." : "The captcha held."}</p>
      {children}
    </div>
  </dialog>;
}
