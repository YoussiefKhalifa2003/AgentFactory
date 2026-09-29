export function stripThink(text: string, live = false) {
  let out = text || "";
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, "");
  if (live) out = out.replace(/<\/?think>/gi, "");
  else out = out.replace(/<think>[\s\S]*$/gi, "");
  return out.trim();
}

export function friendlyText(text: string, live = false) {
  const raw = stripThink(text, live).trim();
  if (!raw) return "";
  if (/freetiererror|only be used from within opencode/i.test(raw)) {
    return "That OpenCode free model isn’t available here. Pick OpenRouter, Spark, or a local model.";
  }
  if (/creditserror|payment method|opencode\.ai\/workspace/i.test(raw)) {
    return "OpenCode ran out of credit. Switch this bay to OpenRouter, Spark, or a local model.";
  }
  if (/spark_api_key is missing|no api key passed in/i.test(raw)) {
    return "Spark needs SPARK_API_KEY in apps/api/.env.";
  }
  if (/server restarted|interrupted/i.test(raw)) {
    return "Interrupted — assign it again.";
  }
  if (/can't find closing|looks like object|couldn't complete this job/i.test(raw)) {
    return "";
  }
  return raw
    .replace(/\{"type":"error"[^\n]*/g, "")
    .replace(/https:\/\/opencode\.ai\/workspace\/\S+/g, "")
    .trim();
}

export function collapseRepeats(text: string) {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of paras) {
    const key = p.replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  const lines: string[] = [];
  let last = "";
  for (const line of out.join("\n\n").split("\n")) {
    if (line === last) continue;
    lines.push(line);
    last = line;
  }
  return lines.join("\n").trim();
}

export function clip(text: string, limit = 640) {
  const t = text.trim();
  if (t.length <= limit) return t;
  return `${t.slice(0, limit).trim()}…`;
}

export function isNoise(job: { status: string; caption?: string; error?: string | null; output?: string }) {
  if (job.status === "queued" || job.status === "thinking" || job.status === "tool") return false;
  const blob = `${job.caption || ""} ${job.error || ""} ${job.output || ""}`;
  if (/server restarted|interrupted/i.test(blob) && !job.output?.trim()) return true;
  if (
    /freetiererror|creditserror|payment method|opencode\.ai\/workspace|only be used from within opencode/i.test(blob) &&
    !job.output?.trim()
  ) {
    return true;
  }
  return false;
}
