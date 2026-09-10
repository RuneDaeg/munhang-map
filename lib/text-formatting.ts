export type TextRun = { text: string; bold: boolean; underline: boolean };
const tag = /<\/?(?:b|u)>/g;

/** Only balanced b/u tags are formatting. All other input remains escaped text. */
export function textRuns(source: string): TextRun[] {
  const stack: string[] = [];
  const runs: TextRun[] = [];
  let at = 0;
  for (const match of source.matchAll(tag)) {
    if (match.index > at)
      runs.push({
        text: source.slice(at, match.index),
        bold: stack.includes('b'),
        underline: stack.includes('u'),
      });
    const name = match[0].includes('b') ? 'b' : 'u';
    if (match[0][1] === '/') {
      if (stack.pop() !== name)
        return [{ text: source, bold: false, underline: false }];
    } else stack.push(name);
    at = match.index + match[0].length;
  }
  if (stack.length) return [{ text: source, bold: false, underline: false }];
  if (at < source.length)
    runs.push({ text: source.slice(at), bold: false, underline: false });
  return runs;
}
export const unformattedText = (source: string) =>
  textRuns(source)
    .map((r) => r.text)
    .join('');
export function formatRuns(runs: TextRun[]) {
  const plain = runs.map((r) => r.text).join('');
  const protectedChars = new Uint8Array(plain.length);
  let start = 0,
    table = false;
  for (const line of plain.split('\n')) {
    if (/^\s*:::/.test(line)) {
      protectedChars.fill(1, start, start + line.length);
      table = /^\s*:::table\b/.test(line);
    } else if (table && /^\s*\|/.test(line)) {
      if (/^\s*\|[\s:|-]+$/.test(line))
        protectedChars.fill(1, start, start + line.length);
      else {
        let math = false;
        for (let c = 0; c < line.length; c++) {
          if (line[c - 1] === '\\') continue;
          if (
            line[c] === '$' &&
            (math || !/^\$\d+(?:[.,]\d+)*\s*(?:\||$)/.test(line.slice(c)))
          )
            math = !math;
          if (line[c] === '|' && !math) protectedChars[start + c] = 1;
        }
      }
    }
    if (start + line.length < plain.length)
      protectedChars[start + line.length] = 1;
    start += line.length + 1;
  }
  const merged: TextRun[] = [];
  let at = 0;
  for (const run of runs) {
    let from = 0;
    while (from < run.text.length) {
      const protectedPart = protectedChars[at + from];
      let to = from + 1;
      while (to < run.text.length && protectedChars[at + to] === protectedPart)
        to++;
      const next = {
        text: run.text.slice(from, to),
        bold: run.bold && !protectedPart,
        underline: run.underline && !protectedPart,
      };
      const previous = merged.at(-1);
      if (
        previous &&
        previous.bold === next.bold &&
        previous.underline === next.underline
      )
        previous.text += next.text;
      else merged.push(next);
      from = to;
    }
    at += run.text.length;
  }
  // Inline style tags never surround structural fences, row separators or newlines.
  return merged
    .map((r) =>
      r.text
        .split('\n')
        .map((line) =>
          line
            ? `${r.bold ? '<b>' : ''}${r.underline ? '<u>' : ''}${line}${r.underline ? '</u>' : ''}${r.bold ? '</b>' : ''}`
            : '',
        )
        .join('\n'),
    )
    .join('');
}
export function plainToSource(source: string, offset: number) {
  if (unformattedText(source) === source)
    return Math.min(offset, source.length);
  let plain = 0;
  for (let i = 0; i < source.length;) {
    const token = source.slice(i).match(/^<\/?[bu]>/)?.[0];
    if (token) {
      i += token.length;
      continue;
    }
    if (plain === offset) return i;
    plain++;
    i++;
  }
  return source.length;
}

/** Slice at a saved-source cursor without leaving unbalanced inline tags. */
export function splitFormattedText(
  source: string,
  position: number,
): [string, string] {
  if (unformattedText(source) === source)
    return [source.slice(0, position), source.slice(position)];
  const plainOffset = source
    .slice(0, position)
    .replace(/<\/?[bu]>/g, '').length;
  const left: TextRun[] = [],
    right: TextRun[] = [];
  let at = 0;
  for (const run of textRuns(source)) {
    const cut = Math.max(0, Math.min(run.text.length, plainOffset - at));
    left.push({ ...run, text: run.text.slice(0, cut) });
    right.push({ ...run, text: run.text.slice(cut) });
    at += run.text.length;
  }
  return [formatRuns(left), formatRuns(right)];
}

/** Serialize the editor, not arbitrary HTML: preserve just text, line breaks and b/u. */
export function editorSource(root: Node): string {
  const runs: TextRun[] = [];
  const visit = (node: Node, bold = false, underline = false) => {
    if (node.nodeType === 3) {
      runs.push({ text: node.textContent ?? '', bold, underline });
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    const el = node as HTMLElement;
    if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'IMG'].includes(el.tagName))
      return;
    if (el.tagName === 'BR') {
      runs.push({ text: '\n', bold: false, underline: false });
      return;
    }
    const block = ['DIV', 'P', 'LI'].includes(el.tagName) && node !== root;
    if (block && runs.length && !runs.at(-1)!.text.endsWith('\n'))
      runs.push({ text: '\n', bold: false, underline: false });
    const weight = el.style?.fontWeight,
      decoration = el.style?.textDecorationLine || el.style?.textDecoration;
    for (const child of node.childNodes)
      visit(
        child,
        bold ||
          ['B', 'STRONG'].includes(el.tagName) ||
          weight === 'bold' ||
          Number(weight) >= 600,
        underline ||
          el.tagName === 'U' ||
          Boolean(decoration?.includes('underline')),
      );
  };
  visit(root);
  return formatRuns(runs);
}
