import type { ReactNode } from "react";

// Safely renders the simple Markdown bots write (HTML is never interpreted).
// Supported: headings, bold, italic, code, code blocks, bulleted/numbered lists, tables, links.

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith("**")) out.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const label = t.slice(1, t.indexOf("]"));
      const href = t.slice(t.indexOf("(") + 1, -1);
      out.push(
        <a key={k} href={href} target="_blank" rel="noreferrer">
          {label}
        </a>,
      );
    } else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={k++} className="code">{code.join("\n")}</pre>);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(<div key={k++} className={`h h${h[1].length}`}>{inline(h[2], k)}</div>);
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().slice(1, -1).split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <table key={k++} className="md-table">
          <thead>
            <tr>{head?.map((c, j) => <th key={j}>{inline(c, j)}</th>)}</tr>
          </thead>
          <tbody>
            {body.map((r, ri) => (
              <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, j)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
      const li = items.map((t, j) => <li key={j}>{inline(t, j)}</li>);
      blocks.push(ordered ? <ol key={k++}>{li}</ol> : <ul key={k++}>{li}</ul>);
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|\s*\||\s*([-*•]|\d+[.)])\s+)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(
      <p key={k++}>
        {para.flatMap((p, j) => (j ? [<br key={`br${j}`} />, ...inline(p, j)] : inline(p, j)))}
      </p>,
    );
  }
  return <div className="md">{blocks}</div>;
}
