export type MathPart = { text: string; math: boolean; display: boolean };

// Match complete math spans only. Incomplete input remains editable plain text.
// Legacy OCR sometimes omitted delimiters around a whole array/table.
const mathSpans = /(?<!\\)(\$\$[\s\S]+?\$\$|\$(?:\\[^\n]|[^$\n])+?\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|\\begin\{(array|[bpBvV]?matrix|cases|aligned)\}[\s\S]+?\\end\{\2\})/g;

// Prose needs real symbols, not math wrappers around entire Korean sentences.
const proseSymbols: Record<string, string> = {
  bullet: '•', textbullet: '•', circ: '○', cdot: '·', times: '×', div: '÷',
  pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈',
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔',
  Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', infty: '∞',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', omega: 'ω', Delta: 'Δ', Omega: 'Ω',
};

function appendProse(parts: MathPart[], text: string) {
  // Promote only a complete, known argument-taking command to math. Never
  // guess at partial edits or treat an arbitrary backslash command as HTML.
  const commands = /(?<!\\)\\(frac|dfrac|tfrac|binom|sqrt|vec|hat|overline)(?![A-Za-z])/g;
  let offset = 0;
  for (const match of text.matchAll(commands)) {
    if (match.index < offset) continue;
    let end = match.index + match[0].length;
    if (match[1] === 'sqrt' && text[end] === '[') {
      const close = text.indexOf(']', end + 1);
      if (close < 0) continue;
      end = close + 1;
    }
    let complete = true;
    for (let count = /^(?:[dt]?frac|binom)$/.test(match[1]) ? 2 : 1; count > 0; count -= 1) {
      while (/\s/.test(text[end] ?? '') && end < text.length) end += 1;
      const close = text[end] === '{' ? closingBrace(text, end) : -1;
      if (close < 0) { complete = false; break; }
      end = close + 1;
    }
    if (!complete) continue;
    if (match.index > offset) parts.push({ text: text.slice(offset, match.index), math: false, display: false });
    parts.push({ text: text.slice(match.index, end), math: true, display: false });
    offset = end;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset), math: false, display: false });
}

export function splitMathText(value: string): MathPart[] {
  const parts: MathPart[] = [];
  let offset = 0;
  for (const match of value.matchAll(mathSpans)) {
    if (match.index > offset) appendProse(parts, value.slice(offset, match.index));
    const span = match[0];
    const environment = span.startsWith('\\begin');
    const display = environment || span.startsWith('$$') || span.startsWith('\\[');
    const width = display || span.startsWith('\\(') ? 2 : 1;
    parts.push({ text: environment ? span : span.slice(width, -width), math: true, display });
    offset = match.index + span.length;
  }
  if (offset < value.length) appendProse(parts, value.slice(offset));
  return parts;
}

/** Repair only recognizable OCR escape damage; never JSON-decode text twice. */
export function normalizeQuestionText(value: string): string {
  const repaired = value
    .replace(/\t[ ]*ext(?=\s*\{)/g, '\\text')
    .replace(/(^|[\s{])ext(?=\s*\{)/g, '$1\\text')
    // oxlint-disable-next-line no-control-regex -- JSON's backspace escape can consume the b in bullet.
    .replace(/\u0008ullet\b/g, '\\bullet')
    // oxlint-disable-next-line no-control-regex -- Repair JSON-decoded backspace before an environment name.
    .replace(/\u0008egin(?=\{(?:array|[bpBvV]?matrix|cases|aligned)\})/g, '\\begin');
  // Protect math before unwrapping prose, including a prose wrapper that
  // surrounds an inline formula. Choose a marker absent from the input.
  let marker = '\uE000';
  while (repaired.includes(marker)) marker += '\uE000';
  const expressions: string[] = [];
  const prose = splitMathText(repaired).map((part) => {
    if (!part.math) return part.text;
    const expression = part.text
      // oxlint-disable-next-line no-control-regex -- Repair JSON-decoded form feed before frac.
      .replace(/\u000crac(?=\s*\{)/g, '\\frac')
      .replace(/\t(imes|heta)\b/g, '\\t$1')
      .replace(/\right(?=[([.|\\])/g, '\\right');
    const unwrapped = unwrapText(expression);
    // Labels inside actual formulae (fractions, subscripts, matrices, etc.)
    // must remain LaTeX. Only math spans consisting of prose/values are flattened.
    const remainder = unwrapped.remainder.replace(/\\(?:qquad|quad|[,;! ])|[{}\s]/g, '');
    const delimiter = part.display ? '$$' : '$';
    expressions.push(unwrapped.count && !/[\\=+*/^_<>|]/.test(remainder)
      ? unwrapped.text.replace(/\\(?:qquad|quad)\b|\\[,;! ]/g, ' ')
      : `${delimiter}${expression}${delimiter}`);
    return `${marker}${expressions.length - 1}\uE001`;
  }).join('');
  return unwrapText(prose).text.replace(/\\(?:qquad|quad)\b/g, ' ')
    .replace(/(?<!\\)\\n(?=\s*(?:[•○]|\\(?:bullet|textbullet|circ)\b))/g, '\n')
    .replace(/(?<!\\)\\([A-Za-z]+)(?:\{\})?/g, (command, name: string) => proseSymbols[name] ?? command)
    .replace(new RegExp(`${marker}(\\d+)\uE001`, 'g'), (_match, index: string) => expressions[Number(index)]);
}

function unwrapText(value: string): { text: string; remainder: string; count: number } {
  let text = '';
  let remainder = '';
  let count = 0;
  let offset = 0;
  const command = /\\text\s*\{/g;
  for (let match = command.exec(value); match; match = command.exec(value)) {
    const open = match.index + match[0].length - 1;
    const close = closingBrace(value, open);
    if (close < 0) continue;
    const before = value.slice(offset, match.index);
    text += before + unwrapText(value.slice(open + 1, close)).text;
    remainder += before;
    count += 1;
    offset = close + 1;
    command.lastIndex = offset;
  }
  return { text: text + value.slice(offset), remainder: remainder + value.slice(offset), count };
}

function closingBrace(value: string, open: number) {
  let depth = 1;
  for (let index = open + 1; index < value.length; index += 1) {
    if (value[index] === '\\') { index += 1; continue; }
    if (value[index] === '{') depth += 1;
    if (value[index] === '}' && --depth === 0) return index;
  }
  return -1;
}
