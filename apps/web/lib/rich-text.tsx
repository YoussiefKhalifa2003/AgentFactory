import { ReactNode } from "react";

function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+?\*\*|__[^_]+?__|`[^`]+?`|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, i) => {
    if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-white/70 px-1 py-0.5 text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      return (
        <a key={i} href={link[2]} target="_blank" rel="noreferrer" className="underline">
          {link[1]}
        </a>
      );
    }
    return <span key={i}>{part.replace(/\*\*/g, "").replace(/__/g, "")}</span>;
  });
}

function isTableSep(line: string) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line.trim());
}

function isTableLine(line: string) {
  const t = line.trim();
  if (!t.includes("|")) return false;
  if (isTableSep(t)) return true;
  return t.replace(/\|/g, "").trim().length > 0;
}

function tableCells(line: string) {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((cell) => cell.trim());
}

function blocks(text: string): string[][] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[][] = [];
  let buf: string[] = [];
  let kind = "p";
  const flush = () => {
    if (buf.length) out.push([kind, ...buf]);
    buf = [];
    kind = "p";
  };
  for (const line of lines) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (isTableLine(line)) {
      if (kind !== "table") flush();
      kind = "table";
      buf.push(line);
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      if (kind !== "ul") flush();
      kind = "ul";
      buf.push(line.replace(/^\s*[-*•]\s+/, ""));
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      if (kind !== "ol") flush();
      kind = "ol";
      buf.push(line.replace(/^\s*\d+[.)]\s+/, ""));
      continue;
    }
    if (/^#{1,3}\s+/.test(line)) {
      flush();
      kind = "h";
      buf.push(line.replace(/^#{1,3}\s+/, ""));
      flush();
      continue;
    }
    if (kind !== "p") flush();
    kind = "p";
    buf.push(line);
  }
  flush();
  return out;
}

export function RichText({ text }: { text: string }) {
  const body = (text || "").trim();
  if (!body) return null;
  return (
    <div className="space-y-2 text-sm leading-6">
      {blocks(body).map((block, i) => {
        const [kind, ...items] = block;
        if (kind === "h") {
          return (
            <p key={i} className="font-semibold">
              {inline(items.join(" "))}
            </p>
          );
        }
        if (kind === "ul") {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {items.map((item, j) => (
                <li key={j}>{inline(item)}</li>
              ))}
            </ul>
          );
        }
        if (kind === "ol") {
          return (
            <ol key={i} className="list-decimal space-y-1 pl-5">
              {items.map((item, j) => (
                <li key={j}>{inline(item)}</li>
              ))}
            </ol>
          );
        }
        if (kind === "table") {
          const rows = items.filter((ln) => !isTableSep(ln)).map(tableCells);
          if (!rows.length) return null;
          const head = rows[0];
          const bodyRows = rows.slice(1);
          return (
            <div key={i} className="sheet-wrap overflow-x-auto">
              <table className="sheet-table">
                <thead>
                  <tr>
                    {head.map((cell, j) => (
                      <th key={j}>{inline(cell || " ")}</th>
                    ))}
                  </tr>
                </thead>
                {bodyRows.length > 0 && (
                  <tbody>
                    {bodyRows.map((row, r) => (
                      <tr key={r}>
                        {head.map((_, c) => (
                          <td key={c}>{inline(row[c] || "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                )}
              </table>
            </div>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {inline(items.join("\n"))}
          </p>
        );
      })}
    </div>
  );
}
