import { formatRuns, textRuns, type TextRun } from './text-formatting';

type Unit = { key: string; start: number; end: number; bold: boolean; underline: boolean };

function closingBrace(value: string, start: number): number {
  let depth = 1;
  for (let index = start + 1; index < value.length; index++) {
    if (value[index] === '\\') { index++; continue; }
    if (value[index] === '{') depth++;
    if (value[index] === '}' && --depth === 0) return index;
  }
  return -1;
}

/** Ignore presentation wrappers, but keep operators and multi-character groups. */
function mathKey(value: string): string {
  const wrapper = /\\(?:mathrm|mathit|mathbf|mathsf|mathtt|mathnormal|text)\s*\{/g;
  let result = '', at = 0;
  for (const match of value.matchAll(wrapper)) {
    if (match.index < at) continue;
    const open = match.index + match[0].length - 1;
    const close = closingBrace(value, open);
    if (close < 0) continue;
    result += value.slice(at, match.index) + mathKey(value.slice(open + 1, close));
    at = close + 1;
  }
  return (result + value.slice(at))
    .replace(/\\(?:left|right)(?![A-Za-z])/g, '')
    .replace(/\\[dt]frac(?![A-Za-z])/g, '\\frac')
    .replace(/\\(?:qquad|quad)(?![A-Za-z])|\\[,;! ]/g, '')
    .replace(/([_^])\{([^{}\\])\}/g, '$1$2')
    .replace(/\s+/g, '');
}

function documentUnits(value: string) {
  const runs = textRuns(value);
  const plain = runs.map((run) => run.text).join('');
  const styles = { bold: new Uint8Array(plain.length), underline: new Uint8Array(plain.length) };
  let offset = 0;
  for (const run of runs) {
    for (const style of ['bold', 'underline'] as const)
      if (run[style]) styles[style].fill(1, offset, offset + run.text.length);
    offset += run.text.length;
  }
  const units: Unit[] = [];
  const append = (key: string, start: number, end: number) => units.push({
    key, start, end,
    bold: styles.bold.slice(start, end).every(Boolean),
    underline: styles.underline.slice(start, end).every(Boolean),
  });
  const prose = (start: number, end: number) => {
    for (let at = start; at < end;) {
      const char = String.fromCodePoint(plain.codePointAt(at)!);
      if (!/\s/.test(char)) append(char, at, at + char.length);
      at += char.length;
    }
  };
  // A formula is indivisible: restored emphasis must not insert tags inside TeX.
  const math = /(?<!\\)(\$\$[\s\S]+?\$\$|\$(?:\\[^\n]|[^$\n]|\n(?=[ \t]*\\))+?\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\])/g;
  offset = 0;
  for (const match of plain.matchAll(math)) {
    prose(offset, match.index);
    const width = match[0].startsWith('$$') || match[0].startsWith('\\') ? 2 : 1;
    append(`math:${mathKey(match[0].slice(width, -width))}`, match.index, match.index + match[0].length);
    offset = match.index + match[0].length;
  }
  prose(offset, plain.length);
  return { plain, styles, units };
}

function occurrences(haystack: Unit[], needle: Unit[]) {
  const found: number[] = [];
  for (let start = 0; start <= haystack.length - needle.length; start++) {
    if (needle.every((unit, index) => unit.key === haystack[start + index].key)) found.push(start);
    // Repeated text cannot provide a unique anchor for a missing/deleted span.
    if (found.length > 1) break;
  }
  return found;
}

/**
 * Reapply only complete source style spans with an exact, unique text anchor.
 * Whitespace and harmless math font/group spelling may change; letters,
 * operators, missing text and ambiguous repeated phrases are never guessed.
 * The source must be the matching PDF extraction (or another trusted revision).
 */
export function preserveSourceTextFormatting(candidate: string, source: string): string {
  const from = documentUnits(source), to = documentUnits(candidate);
  // Invalid nesting is deliberately literal in textRuns. Adding valid tags to
  // that literal string would expose new markup instead of rendering emphasis.
  if (/<\/?[bu]>|\[\/?[bu]\]/.test(to.plain)) return candidate;
  const identical = from.units.length === to.units.length && from.units.every((unit, index) => unit.key === to.units[index].key);
  for (const style of ['bold', 'underline'] as const) {
    for (let start = 0; start < from.units.length;) {
      if (!from.units[start][style]) { start++; continue; }
      let end = start + 1;
      while (end < from.units.length && from.units[end][style]) end++;
      const span = from.units.slice(start, end);
      const sourceMatches = identical ? [start] : occurrences(from.units, span);
      const targetMatches = identical ? [start] : occurrences(to.units, span);
      if (sourceMatches.length === 1 && targetMatches.length === 1) {
        const targetStart = targetMatches[0];
        let context = 0;
        for (const direction of [-1, 1]) {
          for (let distance = 0; distance < 8; distance++) {
            const a = direction < 0 ? start - 1 - distance : end + distance;
            const b = direction < 0 ? targetStart - 1 - distance : targetStart + span.length + distance;
            if (!from.units[a] || !to.units[b] || from.units[a].key !== to.units[b].key) break;
            context++;
          }
        }
        // Tiny labels need neighboring evidence when the overall text changed.
        if (identical || span.length >= 4 || context >= 4) {
          const first = to.units[targetStart], last = to.units[targetStart + span.length - 1];
          to.styles[style].fill(1, first.start, last.end);
        }
      }
      start = end;
    }
  }
  const result: TextRun[] = [];
  for (let start = 0; start < to.plain.length;) {
    let end = start + 1;
    while (end < to.plain.length && to.styles.bold[end] === to.styles.bold[start] && to.styles.underline[end] === to.styles.underline[start]) end++;
    result.push({ text: to.plain.slice(start, end), bold: !!to.styles.bold[start], underline: !!to.styles.underline[start] });
    start = end;
  }
  return formatRuns(result);
}
