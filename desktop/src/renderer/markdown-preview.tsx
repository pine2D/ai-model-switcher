import type { ReactNode } from "react";

function inline(value: string): ReactNode[] {
  return value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    return part;
  });
}

export function MarkdownPreview({ value }: { readonly value: string }): React.JSX.Element {
  const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let code: string[] | null = null;
  let paragraph: string[] = [];
  let list: string[] = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(<p key={`p-${blocks.length}`}>{inline(paragraph.join("\n"))}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={`l-${blocks.length}`}>
        {list.map((item, index) => <li key={index}>{inline(item)}</li>)}
      </ul>
    );
    list = [];
  };
  for (const line of lines) {
    if (line.startsWith("```")) {
      flushParagraph();
      flushList();
      if (code) {
        blocks.push(<pre key={`c-${blocks.length}`}><code>{code.join("\n")}</code></pre>);
        code = null;
      } else code = [];
      continue;
    }
    if (code) { code.push(line); continue; }
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(level === 1
        ? <h3 key={`h-${blocks.length}`}>{inline(heading[2])}</h3>
        : <h4 key={`h-${blocks.length}`}>{inline(heading[2])}</h4>);
      continue;
    }
    if (line.startsWith("> ")) {
      flushParagraph();
      flushList();
      blocks.push(<blockquote key={`q-${blocks.length}`}>{inline(line.slice(2))}</blockquote>);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      list.push(line.slice(2));
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  if (code) blocks.push(<pre key={`c-${blocks.length}`}><code>{code.join("\n")}</code></pre>);
  return <div className="markdown-preview">{blocks}</div>;
}
