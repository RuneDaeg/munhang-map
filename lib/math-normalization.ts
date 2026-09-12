export type MathPart = { text: string; math: boolean; display: boolean };

// Printed money choices use a currency sign, not an opening TeX delimiter.
// Mask only unambiguous numbered amounts, preserving indices and source text.
function maskChoiceCurrency(value: string): string {
  return value.replace(/([①②③④⑤]\s*)\$(\d[\d,]*(?:\.\d+)?)(?=\s*(?:[①②③④⑤]|\n|$))/g,'$1\u0000$2');
}

export function hasUnbalancedMathDelimiters(value: string): boolean {
  return (maskChoiceCurrency(value).match(/(?<!\\)\$/g)?.length ?? 0) % 2 !== 0;
}

/** Only known JSON escape damage inside a math span; prose tabs stay tabs. */
function repairMathEscapes(value: string): string {
  return value
    // A double-escaped command outside an environment is not a row break.
    // Leave array/cases bodies (and their legitimate \\ separators) untouched.
    .replace(/\\begin\{(array|[bpBvV]?matrix|cases|aligned)\}[\s\S]*?\\end\{\1\}|(?<!\\)\\\\(left|right|sum|prod|lim|frac|sqrt|overline)(?![A-Za-z])/g,
      (match, _environment: string | undefined, command: string | undefined) => command ? `\\${command}` : match)
    // oxlint-disable-next-line no-control-regex -- A JSON backspace swallowed the leading b.
    .replace(/\u0008(igg?[lrm]?)(?=\s*(?:[()[\]|.]|\\))/g, '\\b$1')
    // oxlint-disable-next-line no-control-regex -- Recover named commands only, not arbitrary controls.
    .replace(/\u0008(ar|inom)(?=\s*\{)/g, '\\b$1')
    // oxlint-disable-next-line no-control-regex -- JSON-decoded beta.
    .replace(/\u0008(eta)(?![A-Za-z])/g, '\\b$1')
    .replace(/\t(o|imes|heta|au|an)(?![A-Za-z])/g, '\\t$1')
    .replace(/\t(frac|ilde)(?=\s*\{)/g, '\\t$1')
    // oxlint-disable-next-line no-control-regex -- A JSON form feed swallowed the f in frac.
    .replace(/\u000crac(?=\s*\{)/g, '\\frac')
    .replace(/\right(?=\s*(?:[()[\]|.]|\\))/g, '\\right')
    // A typeset lim with a condition is an operator, not a text subscript.
    .replace(/\\(?:text|mathrm|operatorname)\s*\{\s*lim\s*\}(?=\s*(?:_|\\limits))/g, '\\lim');
}

/** Keep renderer and syntax validation on the same operator layout. */
export function mathForRendering(value: string): string {
  return value.replace(/(?<!\\)((?:\\\\)*)\\(lim|sum|prod)(?![A-Za-z]|\s*\\(?:no)?limits)/g,'$1\\$2\\limits');
}

// A formula such as CO_2 is ambiguous in isolation. Use chemistry prose as
// evidence, and leave genetics questions and explicit author styling alone.
function hasChemistryContext(value: string): boolean {
  return /화학|탄산|이산화\s*탄소|산소|수소|이온|용액|분자식|반응식/.test(value)
    && !/유전자|대립\s*유전자|염색체/.test(value);
}

const chemicalElements = new Set(('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca '
  + 'Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd '
  + 'In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os '
  + 'Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr '
  + 'Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og').split(' '));

const chemicalScript = String.raw`(?:_(?:\d+|\{\d+\})|\^(?:[+−-]|\{(?:\d*[+−-]|[+−-]\d+)\}))`;
const chemicalAtom = String.raw`[A-Z][a-z]?(?:${chemicalScript}){0,2}`;
// A grouped molecule must have an atom prefix and a numeric/charge script on
// the group. Ordinary \left(...) geometry and variable expressions stay out.
const chemicalGroup = String.raw`(?:\\left\((?:${chemicalAtom})+\\right\)|\((?:${chemicalAtom})+\))(?:${chemicalScript}){1,2}`;
const chemicalFormula = new RegExp(String.raw`(?<![A-Za-z\\])(?:(?:${chemicalAtom})+(?:${chemicalGroup})(?:(?:${chemicalAtom})|(?:${chemicalGroup}))*|(?:${chemicalAtom})+)(?![A-Za-z])`, 'g');

function uprightChemicalFormulae(value: string): string {
  const protectedRanges: Array<[number, number]> = [];
  for (const match of value.matchAll(/\\(?:text|mathrm|mathit|mathbf|mathsf|mathtt|mathbb|mathcal|operatorname|ce|bar|overline|vec|hat)\s*\{/g)) {
    const end = closingBrace(value, match.index + match[0].length - 1);
    protectedRanges.push([match.index, end < 0 ? value.length : end + 1]);
  }
  // Consume a complete atom sequence first, then validate every element. This
  // prevents accepting a chemical-looking suffix of a gene or geometry label.
  return value.replace(chemicalFormula,
    (formula, offset: number) => {
      if (protectedRanges.some(([start, end]) => offset >= start && offset < end)) return formula;
      if (!/[_^]/.test(formula)) return formula;
      const atoms = formula.match(/[A-Z][a-z]?/g) ?? [];
      if (!atoms.every((atom: string) => chemicalElements.has(atom))) return formula;
      // A lone indexed C or H can be a variable; a charge or a familiar
      // diatomic molecule supplies stronger evidence for a single atom type.
      if (atoms.length < 2 && !formula.includes('^') && !/^(?:H|N|O|F|Cl|Br|I)_(?:2|\{2\})$/.test(formula)) return formula;
      return `\\mathrm{${formula}}`;
    });
}

function repairProseNewlines(value: string): string {
  // Preserve code/quoted strings and doubled escapes. Only recognizable list
  // starts justify turning a literal backslash-n into a real prose line break.
  return value.replace(/(`+)[\s\S]*?\1|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?<!\\)\\n(?=[ \t]*(?:[•○◦]|ㅇ(?=[ \t.]|$)|[ㄱ-ㅎ](?=[ \t]*[.)．]|[ \t]+[가-힣㉠-㉻])|\\(?:bullet|textbullet|circ)\b))/g,
    (match) => match === '\\n' ? '\n' : match);
}

// Match complete math spans only. Incomplete input remains editable plain text.
// Legacy OCR sometimes omitted delimiters around a whole array/table.
const mathSpans = /(?<!\\)(\$\$[\s\S]+?\$\$|\$(?:\\[^\n]|[^$\n]|\n(?=[ \t]*\\))+?\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|\\begin\{(array|[bpBvV]?matrix|cases|aligned)\}[\s\S]+?\\end\{\2\})/g;

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
  const commands = /(?<!\\)\\(frac|dfrac|tfrac|binom|sqrt|vec|hat|overline|lim|sum|prod|int|sin|cos|tan|log|ln|exp|min|max)(?![A-Za-z])/g;
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
    const arity = /^(?:[dt]?frac|binom)$/.test(match[1]) ? 2 : /^(sqrt|vec|hat|overline)$/.test(match[1]) ? 1 : 0;
    for (let count = arity; count > 0; count -= 1) {
      while (/\s/.test(text[end] ?? '') && end < text.length) end += 1;
      const close = text[end] === '{' ? closingBrace(text, end) : -1;
      if (close < 0) { complete = false; break; }
      end = close + 1;
    }
    // Complete operator scripts are self-contained math even if the following
    // operand is prose. Do not consume an unbounded stretch of the sentence.
    const scripts = new Set<string>();
    while (complete) {
      let cursor = end;
      while (cursor < text.length && /\s/.test(text[cursor])) cursor++;
      const script = text[cursor];
      if (script !== '^' && script !== '_') break;
      if (scripts.has(script)) { complete = false; break; }
      scripts.add(script);
      cursor++;
      while (cursor < text.length && /\s/.test(text[cursor])) cursor++;
      if (text[cursor] === '{') {
        const close = closingBrace(text, cursor);
        if (close < 0 || close === cursor + 1) { complete = false; break; }
        end = close + 1;
      } else if (/^[A-Za-z0-9α-ωΑ-Ω+−-]$/u.test(text[cursor] ?? '')) {
        end = cursor + 1;
      } else {
        const symbol = /^\\(?:alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|omega|infty)(?![A-Za-z])/.exec(text.slice(cursor));
        if (!symbol) { complete = false; break; }
        end = cursor + symbol[0].length;
      }
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
  for (const match of maskChoiceCurrency(value).matchAll(mathSpans)) {
    if (match.index > offset) appendProse(parts, value.slice(offset, match.index));
    const span = value.slice(match.index, match.index + match[0].length);
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
  const chemistry = hasChemistryContext(repaired);
  const prose = splitMathText(repaired).map((part) => {
    if (!part.math) return part.text;
    const repairedExpression = repairMathEscapes(part.text);
    const expression = chemistry ? uprightChemicalFormulae(repairedExpression) : repairedExpression;
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
  return repairProseNewlines(unwrapText(prose).text.replace(/\\(?:qquad|quad)\b/g, ' '))
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
