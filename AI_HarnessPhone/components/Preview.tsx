"use client";

import { useEffect, useState } from "react";
import { Artifact } from "@/lib/types";
import {
  downloadSrc,
  fileKindLabel,
  isAudioFile,
  isDrawioFile,
  isHtmlFile,
  isImageFile,
  isMermaidFile,
  isPdfFile,
  isSheetFile,
  isTextFile,
  previewSrc,
} from "@/lib/files";
import { apiFetch } from "@/lib/config";

export function FilePreview({
  jobId,
  file,
  onClose,
}: {
  jobId: string;
  file: Artifact;
  onClose: () => void;
}) {
  const src = previewSrc(jobId, file);
  const [text, setText] = useState("");
  const html = isHtmlFile(file);
  const image = isImageFile(file);
  const pdf = isPdfFile(file);
  const audio = isAudioFile(file);
  const texty = isTextFile(file) && !html;

  useEffect(() => {
    if (!texty) return;
    apiFetch(`/api/artifacts/${file.id}/file`)
      .then((r) => r.text())
      .then(setText)
      .catch(() => setText("Couldn’t load this file."));
  }, [file.id, texty]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[var(--paper)]"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-2 px-3">
        <button type="button" className="btn btn-compact px-3" onClick={onClose}>
          Close
        </button>
        <p className="min-w-0 flex-1 truncate px-2 text-center text-[13px] font-medium">{file.name}</p>
        <a className="btn btn-compact px-3" href={downloadSrc(file)} download={file.name}>
          Save
        </a>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {html && (
          <iframe
            title={file.name}
            src={src}
            className="h-full min-h-[70dvh] w-full border-0 bg-white"
            allow="fullscreen; gamepad; pointer-lock; autoplay"
          />
        )}
        {image && <img src={src} alt={file.name} className="mx-auto max-w-full" />}
        {pdf && <iframe title={file.name} src={src} className="h-full min-h-[70dvh] w-full border-0 bg-white" />}
        {audio && (
          <div className="flex h-full items-center justify-center px-6">
            <audio controls src={src} className="w-full" />
          </div>
        )}
        {texty && (
          <pre className="whitespace-pre-wrap px-4 py-3 text-[14px] leading-6">{text || "…"}</pre>
        )}
        {!html && !image && !pdf && !audio && !texty && (
          <p className="px-6 py-10 text-center text-sm text-[var(--ink-soft)]">
            {fileKindLabel(file)}
            {isMermaidFile(file) || isDrawioFile(file) || isSheetFile(file)
              ? " — open on desktop for the full view, or Save to download."
              : " — use Save to download."}
          </p>
        )}
      </div>
    </div>
  );
}
