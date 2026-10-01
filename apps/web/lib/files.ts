import { API_URL, Artifact } from "./types";

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

export function previewSrc(jobId: string, file: Artifact) {
  const stamp = file.created_at || file.id;
  if (isHtmlFile(file)) {
    const rel = file.name.replace(/^\/+/, "") || "index.html";
    return `${API_URL}/api/jobs/${jobId}/site/${rel}?v=${encodeURIComponent(stamp)}`;
  }
  return `${API_URL}/api/artifacts/${file.id}/file?v=${encodeURIComponent(stamp)}`;
}

export function downloadSrc(file: Artifact) {
  return `${API_URL}/api/artifacts/${file.id}/file?download=1`;
}

export function bestView(files: Artifact[]) {
  return (
    files.find(isHtmlFile) ||
    files.find(isMermaidFile) ||
    files.find(isSheetFile) ||
    files.find(isPdfFile) ||
    files.find(isDrawioFile) ||
    files.find(isImageFile) ||
    files[0]
  );
}

export function filesForJob(job: { id: string; artifacts?: Artifact[] }, liveArts: Artifact[], liveJobId?: string) {
  const map = new Map<string, Artifact>();
  for (const a of job.artifacts || []) map.set(a.id, a);
  if (job.id === liveJobId) {
    for (const a of liveArts) map.set(a.id, a);
  }
  return [...map.values()];
}

export function thumbSrc(file: Artifact) {
  if (isImageFile(file) || isPdfFile(file) || isHtmlFile(file)) {
    return `${API_URL}/api/artifacts/${file.id}/file`;
  }
  return null;
}
