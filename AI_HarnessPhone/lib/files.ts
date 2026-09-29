import { Artifact, Job } from "./types";
import { apiUrl, withAuthParam } from "./config";

export function filesForJob(job: Job, liveArts: Artifact[], liveJobId?: string) {
  const map = new Map<string, Artifact>();
  for (const a of job.artifacts || []) map.set(a.id, a);
  if (job.id === liveJobId) {
    for (const a of liveArts) map.set(a.id, a);
  }
  return [...map.values()];
}

export function isHtmlFile(a: Artifact) {
  return a.kind === "site" || /\.html?$/i.test(a.name);
}

export function isImageFile(a: Artifact) {
  return a.kind === "plot" || /\.(png|jpe?g|gif|svg|webp)$/i.test(a.name);
}

export function isDrawioFile(a: Artifact) {
  return /\.drawio$/i.test(a.name);
}

export function isMermaidFile(a: Artifact) {
  return /\.mmd$/i.test(a.name);
}

export function isSheetFile(a: Artifact) {
  return a.kind === "sheet" || /\.csv$/i.test(a.name);
}

export function isPdfFile(a: Artifact) {
  return a.kind === "pack" || /\.pdf$/i.test(a.name);
}

export function bestView(files: Artifact[]): Artifact | undefined {
  return (
    files.find((f) => /slides\.html$/i.test(f.name)) ||
    files.find(isHtmlFile) ||
    files.find(isMermaidFile) ||
    files.find(isSheetFile) ||
    files.find(isPdfFile) ||
    files.find(isDrawioFile) ||
    files.find(isImageFile) ||
    files[0]
  );
}

export function previewSrc(jobId: string, file: Artifact) {
  const base = apiUrl();
  const stamp = file.created_at || file.id;
  const raw = isHtmlFile(file)
    ? `${base}/api/jobs/${jobId}/site/${file.name.replace(/^\/+/, "") || "index.html"}?v=${encodeURIComponent(stamp)}`
    : `${base}/api/artifacts/${file.id}/file?v=${encodeURIComponent(stamp)}`;
  return withAuthParam(raw);
}

export function downloadSrc(file: Artifact) {
  return withAuthParam(`${apiUrl()}/api/artifacts/${file.id}/file?download=1`);
}

export function isTextFile(a: Artifact) {
  return /\.(md|txt|json|csv|mmd|drawio)$/i.test(a.name) || a.kind === "report" || a.kind === "sheet";
}

export function isAudioFile(a: Artifact) {
  return /\.(mp3|wav|m4a|ogg)$/i.test(a.name);
}

export function fileKindLabel(file: Artifact) {
  if (/slides\.html$/i.test(file.name)) return "Deck";
  if (isHtmlFile(file)) return "Page";
  if (isMermaidFile(file)) return "Chart";
  if (isDrawioFile(file)) return "draw.io";
  if (isSheetFile(file)) return "Sheet";
  if (isPdfFile(file)) return "PDF";
  if (/\.md$/i.test(file.name) || file.kind === "report") return "Notes";
  if (isImageFile(file)) return "Image";
  return file.name;
}
