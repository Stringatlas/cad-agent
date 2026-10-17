/** Deliberately small Markdown subset. No HTML, images, embeds or arbitrary attributes. */
export type MarkdownInline =
  | { kind: 'text' | 'code'; text: string }
  | { kind: 'strong' | 'em'; children: MarkdownInline[] }
  | { kind: 'link'; href: string; children: MarkdownInline[] };
export type MarkdownBlock =
  | { kind: 'paragraph' | 'quote'; children: MarkdownInline[] }
  | { kind: 'heading'; level: number; children: MarkdownInline[] }
  | { kind: 'code'; text: string; language: string }
  | { kind: 'list'; ordered: boolean; start: number; items: MarkdownInline[][] }
  | { kind: 'rule' };

/** Explicit external protocols only: never resolve relative URLs against the product origin. */
export function safeMarkdownUrl(value: string): string | undefined {
  if (/[\s\u0000-\u001f\u007f\\<>]/u.test(value)) return undefined;
  if (!/^(?:https?:\/\/|mailto:)/iu.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === 'mailto:') return url.pathname ? value : undefined;
    return url.hostname && !url.username && !url.password ? value : undefined;
  } catch { return undefined; }
}

export function markdownInline(text: string, depth = 0): MarkdownInline[] {
  if (depth >= 6) return [{ kind: 'text', text }];
  const result: MarkdownInline[] = [];
  // Markers must be closed; incomplete streamed syntax remains ordinary escaped text.
  const pattern = /`([^`\n]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|(!?)\[([^\]\n]+)\]\(([^)\n]+)\)/gu;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    if (index > cursor) result.push({ kind: 'text', text: text.slice(cursor, index) });
    if (match[1] !== undefined) result.push({ kind: 'code', text: match[1] });
    else if (match[2] !== undefined || match[3] !== undefined) result.push({ kind: 'strong', children: markdownInline((match[2] ?? match[3])!, depth + 1) });
    else if (match[4] !== undefined || match[5] !== undefined) result.push({ kind: 'em', children: markdownInline((match[4] ?? match[5])!, depth + 1) });
    else {
      const href = match[6] ? undefined : safeMarkdownUrl(match[8]!);
      result.push(href ? { kind: 'link', href, children: markdownInline(match[7]!, depth + 1) } : { kind: 'text', text: match[0] });
    }
    cursor = index + match[0].length;
  }
  if (cursor < text.length) result.push({ kind: 'text', text: text.slice(cursor) });
  return result;
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/gu, '\n').split('\n'), blocks: MarkdownBlock[] = [];
  const listItem = (line: string) => /^\s{0,3}(?:([-+*])|(\d{1,6})[.)])\s+(.+)$/u.exec(line);
  const special = (line: string) => /^\s{0,3}(?:`{3,}|~{3,}|#{1,6}\s|>\s?|(?:-{3,}|\*{3,}|_{3,})\s*$)/u.test(line) || !!listItem(line);
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    const fence = /^\s{0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      const content: string[] = [], marker = fence[1]!, closing = new RegExp(`^\\s{0,3}${marker[0]}{${marker.length},}\\s*$`, 'u');
      i++;
      while (i < lines.length && !closing.test(lines[i]!)) content.push(lines[i++]!);
      if (i < lines.length) i++;
      blocks.push({ kind: 'code', text: content.join('\n'), language: fence[2]!.trim() }); continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.+)$/u.exec(line);
    if (heading) { blocks.push({ kind: 'heading', level: heading[1]!.length, children: markdownInline(heading[2]!) }); i++; continue; }
    if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/u.test(line)) { blocks.push({ kind: 'rule' }); i++; continue; }
    const item = listItem(line);
    if (item) {
      const ordered = item[2] !== undefined, items: MarkdownInline[][] = [];
      while (i < lines.length) {
        const next = listItem(lines[i]!);
        if (!next || (next[2] !== undefined) !== ordered) break;
        items.push(markdownInline(next[3]!)); i++;
      }
      blocks.push({ kind: 'list', ordered, start: ordered ? Number(item[2]) : 1, items }); continue;
    }
    if (/^\s{0,3}>/u.test(line)) {
      const content: string[] = [];
      while (i < lines.length && /^\s{0,3}>/u.test(lines[i]!)) content.push(lines[i++]!.replace(/^\s{0,3}>\s?/u, ''));
      blocks.push({ kind: 'quote', children: markdownInline(content.join('\n')) }); continue;
    }
    const content = [line]; i++;
    while (i < lines.length && lines[i]!.trim() && !special(lines[i]!)) content.push(lines[i++]!);
    blocks.push({ kind: 'paragraph', children: markdownInline(content.join('\n')) });
  }
  return blocks;
}
