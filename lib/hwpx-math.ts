import katex from 'katex';

export type HwpxMathOptions = { display?: boolean; bold?: boolean; underline?: boolean; fontSizePt?: number };
export type HwpxMathMetrics = { width: number; height: number; baseline: number };
type Node = { tag: string; attrs: Record<string, string>; children: Array<Node | string> };
type Part = { script: string; width: number; above: number; below: number };
type Style = { variant?: string };

// Native equation language: Hancom's Equation Commands / Equation Fonts help.
// https://help.hancom.com/hoffice/multi/en_us/hwp/insert/equation/equation(explanation).htm
// https://help.hancom.com/hoffice/multi/ko_kr/hwp/insert/equation/equation(font).htm
// 본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.
// This converter deliberately accepts a bounded subset. Unknown structures,
// fonts and symbols throw; they must never become successful literal LaTeX.
const SYMBOLS: Record<string, string> = {
  '−': '-', '×': 'TIMES', '÷': 'DIVIDE', '±': '+-', '∓': '-+', '⋅': 'CDOT', '·': 'CDOT',
  '≤': 'LEQ', '≥': 'GEQ', '≠': '!=', '≈': 'APPROX', '≃': 'SIMEQ', '≅': 'CONG', '≡': 'IDENTICAL',
  '∼': 'SIM', '≪': '<<', '≫': '>>', '∝': 'PROPTO', '∞': 'INF', '∂': 'PARTIAL', '∇': 'NABLA',
  '∈': 'IN', '∉': 'NOTIN', '∋': 'OWNS', '⊂': 'SUBSET', '⊃': 'SUPERSET', '⊆': 'SUBSETEQ', '⊇': 'SUPSETEQ',
  '∅': 'EMPTYSET', '∩': 'SMALLINTER', '∪': 'CUP', '∧': 'WEDGE', '∨': 'LOR', '¬': 'LNOT',
  '∀': 'FORALL', '∃': 'EXIST', '∴': 'THEREFORE', '∵': 'BECAUSE', '⊥': 'BOT', '⊤': 'TOP',
  '→': 'rarrow', '←': 'larrow', '↔': 'lrarrow', '⇒': 'RARROW', '⇐': 'LARROW', '⇔': 'LRARROW',
  '↑': 'uparrow', '↓': 'downarrow', '↦': 'MAPSTO', '↪': 'HOOKRIGHT', '↩': 'HOOKLEFT',
  '∑': 'SUM', '∏': 'PROD', '∐': 'COPROD', '∫': 'INT', '∬': 'DINT', '∭': 'TINT',
  '∮': 'OINT', '∯': 'ODINT', '∰': 'OTINT', '⋃': 'UNION', '⋂': 'INTER',
  '⊕': 'OPLUS', '⊗': 'OTIMES', '⊙': 'ODOT', '∘': 'CIRC', '•': 'BULLET', '∗': 'AST',
  '⋯': 'CDOTS', '…': 'LDOTS', '⋮': 'VDOTS', '⋱': 'DDOTS', '′': 'prime', '″': 'prime prime',
  '°': 'DEG', '℃': 'CENTIGRADE', 'ℏ': 'hbar', 'ℓ': 'LITER', 'ℵ': 'ALEPH', '∠': 'ANGLE',
  'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ϵ': 'epsilon', 'ε': 'varepsilon',
  'ζ': 'zeta', 'η': 'eta', 'θ': 'theta', 'ϑ': 'vartheta', 'ι': 'iota', 'κ': 'kappa',
  'λ': 'lambda', 'μ': 'mu', 'ν': 'nu', 'ξ': 'xi', 'ο': 'omicron', 'π': 'pi', 'ϖ': 'varpi',
  'ρ': 'rho', 'σ': 'sigma', 'ς': 'varsigma', 'τ': 'tau', 'υ': 'upsilon', 'ϕ': 'phi', 'φ': 'varphi',
  'χ': 'chi', 'ψ': 'psi', 'ω': 'omega', 'Γ': 'GAMMA', 'Δ': 'DELTA', 'Θ': 'THETA', 'Λ': 'LAMBDA',
  'Ξ': 'XI', 'Π': 'PI', 'Σ': 'SIGMA', 'Υ': 'UPSILON', 'Φ': 'PHI', 'Ψ': 'PSI', 'Ω': 'OMEGA',
};
const NARY = new Set(Array.from('∑∏∐∫∬∭∮∯∰⋃⋂'));
const FUNCTIONS = new Set('sin cos tan cot sec csc cosec arcsin arccos arctan sinh cosh tanh coth log ln lg exp max min lim Lim det gcd mod arg dim ker Pr'.split(' '));
const FENCES: Record<string, string> = { '(': '(', ')': ')', '[': '[', ']': ']', '{': '{', '}': '}', '|': '|', '∣': '|', '‖': 'DLINE', '∥': 'DLINE', '⟨': '<', '⟩': '>', '⌈': 'LCEIL', '⌉': 'RCEIL', '⌊': 'LFLOOR', '⌋': 'RFLOOR', '': '.' };
const ACCENTS: Record<string, string> = { '^': 'HAT', 'ˇ': 'CHECK', '~': 'TILDE', '˜': 'TILDE', '´': 'ACUTE', '`': 'GRAVE', '˙': 'DOT', '¨': 'DDOT', '¯': 'BAR', '‾': 'BAR', '→': 'VEC', '⃗': 'VEC', '↔': 'DYAD' };

function fail(detail: string): never {
  throw new Error(`한글 편집형 수식으로 변환할 수 없습니다: ${detail}`);
}

function xml(value: string): string {
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if ((code < 32 && ![9, 10, 13].includes(code)) || (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff) fail('잘못된 XML 문자');
  }
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!));
}

function entities(value: string): string {
  return value.replace(/&([^;]+);/g, (_, name: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
    if (Object.hasOwn(named, name)) return named[name];
    if (/^#(?:x[0-9a-f]+|[0-9]+)$/i.test(name)) {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      if (code <= 0x10ffff) return String.fromCodePoint(code);
    }
    return fail('알 수 없는 MathML 문자 참조');
  });
}

// Only consumes KaTeX-generated MathML; no DOM, external entities or HTML.
function parse(markup: string): Node {
  const math = markup.match(/<math\b[^>]*>[\s\S]*?<\/math>/)?.[0];
  if (!math || math.length > 500_000) fail('MathML이 없거나 너무 큽니다');
  const root: Node = { tag: 'root', attrs: {}, children: [] }, stack = [root];
  let count = 0;
  for (const token of math.match(/<[^>]*>|[^<]+/g) ?? []) {
    if (++count > 30_000 || stack.length > 128) fail('수식 구조가 너무 복잡합니다');
    if (!token.startsWith('<')) { stack.at(-1)!.children.push(entities(token)); continue; }
    const end = /^<\/([a-z][a-z0-9]*)>$/.exec(token);
    if (end) {
      if (stack.length < 2 || stack.pop()!.tag !== end[1]) fail('MathML 닫는 태그가 맞지 않습니다');
      continue;
    }
    const start = /^<([a-z][a-z0-9]*)([\s\S]*?)(\/?)>$/.exec(token);
    if (!start) fail('지원하지 않는 MathML 태그');
    const node: Node = { tag: start[1], attrs: {}, children: [] };
    const rest = start[2].replace(/\s+([a-z][a-z0-9:-]*)="([^"]*)"/g, (_, name: string, value: string) => {
      if (Object.hasOwn(node.attrs, name)) fail('중복 MathML 속성');
      node.attrs[name] = entities(value);
      return '';
    });
    if (rest.trim()) fail('잘못된 MathML 속성');
    stack.at(-1)!.children.push(node);
    if (!start[3]) stack.push(node);
  }
  if (stack.length !== 1 || root.children.length !== 1 || typeof root.children[0] === 'string') fail('잘못된 MathML 문서');
  return root.children[0];
}

function children(node: Node): Node[] {
  if (node.children.some((child) => typeof child === 'string' && child.trim())) fail(`${node.tag}의 예상하지 못한 본문`);
  return node.children.filter((child): child is Node => typeof child !== 'string');
}

function content(node: Node): string {
  return node.children.map((child) => typeof child === 'string' ? child : content(child)).join('');
}

function attrs(node: Node, allowed: string[]) {
  for (const key of Object.keys(node.attrs)) if (!allowed.includes(key)) fail(`${node.tag}/${key}는 아직 지원하지 않습니다`);
}

function args(node: Node, length: number): Node[] {
  const list = children(node);
  if (list.length !== length) fail(`${node.tag}의 인수 개수`);
  return list;
}

const group = (script: string) => `{${script}}`;
const part = (script: string, width = 0, above = 0.8, below = 0.2): Part => ({ script, width, above, below });
const isFence = (node: Node | undefined) => node?.tag === 'mo' && node.attrs.fence === 'true';

function literal(text: string, style: Style, normal: boolean): string {
  const variant = style.variant ?? (normal ? 'normal' : 'italic');
  if (!['normal', 'italic', 'bold', 'bold-italic'].includes(variant)) fail(`mathvariant=${variant}는 아직 지원하지 않습니다`);
  const font = { normal: 'rm', italic: 'it', bold: 'rmbold', 'bold-italic': 'bold' }[variant]!;
  return group(`${font} ${text}`);
}

function atom(node: Node, style: Style): Part {
  attrs(node, ['mathvariant', 'fence', 'stretchy', 'symmetric', 'minsize', 'maxsize', 'lspace', 'rspace', 'separator', 'largeop', 'movablelimits']);
  if (node.children.some((child) => typeof child !== 'string')) return row(children(node), style);
  const value = content(node);
  xml(value);
  if (style.variant && !['normal', 'italic', 'bold', 'bold-italic'].includes(style.variant)) fail(`mathvariant=${style.variant}는 아직 지원하지 않습니다`);
  // MathML's invisible function application is represented by native function
  // tokens; invisible multiplication likewise needs no visible character.
  if (!value || /^[\u2061\u2062]+$/.test(value)) return part('', 0, 0, 0);
  if (node.tag === 'mtext') {
    if (/["\\\r\n]/.test(value)) fail('텍스트 수식의 따옴표·역슬래시·줄바꿈');
    const plain = value.replace(/\u00a0/g, ' ');
    return part(literal(`"${plain}"`, style, true), Array.from(plain).reduce((w, char) => w + (/\s/.test(char) ? 0.35 : /[\u1100-\uffff]/.test(char) ? 1 : 0.58), 0));
  }
  if (node.tag === 'mn' && /^[0-9.,]+$/.test(value)) return part(style.variant ? literal(value, style, true) : value, value.length * 0.58);
  if (FUNCTIONS.has(value) && !style.variant && node.tag === 'mi') return part(value, value.length * 0.56);
  const tokens = Array.from(value).map((char) => {
    if (Object.hasOwn(SYMBOLS, char)) return style.variant ? literal(SYMBOLS[char], style, node.tag !== 'mi') : SYMBOLS[char];
    if (/[A-Za-z]/.test(char)) return literal(char, style, node.tag !== 'mi' || value.length > 1);
    if (/[0-9.,+\-=:;!?/()[\]<>|]/.test(char)) return style.variant ? literal(char, style, true) : char;
    if (/[%&#{}_]/.test(char)) return `"${char}"`;
    // Retain Korean labels and Roman numerals without interpreting them as
    // commands. Unknown mathematical glyphs must get an explicit review error.
    if (/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af\u2160-\u217f]/.test(char)) return literal(`"${char}"`, style, true);
    return fail(`지원하지 않는 수식 문자 ${char}`);
  });
  return part(tokens.join(' '), Array.from(value).reduce((width, char) => width + (NARY.has(char) ? 1 : /[=+−→←]/.test(char) ? 0.95 : 0.58), 0), NARY.has(value) ? 1.05 : 0.8, NARY.has(value) ? 0.35 : 0.2);
}

function row(list: Node[], style: Style): Part {
  if (list.length > 1 && (isFence(list[0]) || isFence(list.at(-1)))) {
    const first = isFence(list[0]) ? list[0] : undefined, last = isFence(list.at(-1)) ? list.at(-1) : undefined;
    const inside = list.slice(first ? 1 : 0, last ? -1 : undefined);
    if (inside.some(isFence)) fail('middle 괄호는 아직 지원하지 않습니다');
    const left = first ? FENCES[content(first)] : '.', right = last ? FENCES[content(last)] : '.';
    if (left === undefined || right === undefined) fail('지원하지 않는 자동 크기 괄호');
    if (left === '{' && right === '.' && inside.length === 1 && inside[0].tag === 'mtable') {
      return matrix(inside[0], style, true);
    }
    const body = row(inside, style);
    return { ...body, script: `LEFT ${left} ${body.script} RIGHT ${right}`, width: body.width + (first ? 0.5 : 0) + (last ? 0.5 : 0) };
  }
  if (list.some(isFence)) fail('짝이 없는 자동 크기 괄호');
  const items: Part[] = [];
  for (let index = 0; index < list.length; index++) {
    const node = list[index];
    // TeX isotope notation {}^{14}_{6}C attaches the scripts on C's left.
    if (['msub', 'msup', 'msubsup'].includes(node.tag) && children(node)[0]?.tag === 'mrow' && !children(node)[0].children.length) {
      const fields = args(node, node.tag === 'msubsup' ? 3 : 2), next = list[++index];
      if (!next || next.tag === 'mo') fail('왼쪽 첨자의 본문이 없습니다');
      const base = convert(next, style), sub = node.tag === 'msup' ? undefined : convert(fields[1], style), sup = node.tag === 'msub' ? undefined : convert(fields.at(-1)!, style);
      items.push(scripted(base, sub, sup, true));
    } else items.push(convert(node, style));
  }
  return part(items.map((item) => item.script).filter(Boolean).join(' '), items.reduce((sum, item) => sum + item.width, 0), Math.max(0, ...items.map((item) => item.above)), Math.max(0, ...items.map((item) => item.below)));
}

function scripted(base: Part, sub?: Part, sup?: Part, left = false): Part {
  return part(`${group(base.script)}${sub ? ` ${left ? 'LSUB' : '_'} ${group(sub.script)}` : ''}${sup ? ` ${left ? 'LSUP' : '^'} ${group(sup.script)}` : ''}`, base.width + Math.max(sub?.width ?? 0, sup?.width ?? 0) * 0.7, Math.max(base.above, sup ? 0.5 + sup.above * 0.7 : 0), Math.max(base.below, sub ? 0.35 + sub.below * 0.7 : 0));
}

function matrix(node: Node, style: Style, cases = false): Part {
  attrs(node, ['rowspacing', 'columnalign', 'columnspacing']);
  const rows = children(node);
  if (!rows.length || rows.length > 64 || rows.some((item) => item.tag !== 'mtr')) fail('지원하지 않는 행렬 행');
  const align = (node.attrs.columnalign ?? 'center').split(/\s+/);
  if (align.some((value) => value !== (cases ? 'left' : 'center'))) fail('왼쪽·오른쪽 정렬 행렬은 아직 지원하지 않습니다');
  const cells = rows.map((item) => {
    attrs(item, []);
    return children(item).map((cell) => {
      if (cell.tag !== 'mtd') fail('지원하지 않는 행렬 셀');
      attrs(cell, []);
      return row(children(cell), style);
    });
  });
  const columns = cells[0].length;
  if (!columns || columns > 32 || cells.some((line) => line.length !== columns)) fail('열 수가 다른 행렬');
  if (cases && columns !== 2) fail('구간별 함수는 식·조건 두 열이어야 합니다');
  const height = cells.reduce((sum, line) => sum + Math.max(...line.map((cell) => cell.above + cell.below)) + 0.3, 0);
  const width = Array.from({ length: columns }, (_, col) => Math.max(...cells.map((line) => line[col].width))).reduce((a, b) => a + b, 0) + (columns - 1) * 0.8;
  return part(`${cases ? 'CASES' : 'MATRIX'} ${group(cells.map((line) => line.map((cell) => group(cell.script)).join(' & ')).join(' # '))}`, width + (cases ? 0.5 : 0), height / 2 + 0.25, height / 2 - 0.25);
}

function convert(node: Node, inherited: Style): Part {
  const style = { ...inherited, variant: node.attrs.mathvariant ?? inherited.variant };
  switch (node.tag) {
    case 'math': attrs(node, ['xmlns', 'display']); return row(children(node), style);
    case 'semantics': {
      attrs(node, []);
      const body = children(node).filter((child) => child.tag !== 'annotation');
      if (body.length !== 1) fail('예상하지 못한 MathML semantics');
      return convert(body[0], style);
    }
    case 'mrow': attrs(node, []); return row(children(node), style);
    case 'mstyle': attrs(node, ['displaystyle', 'scriptlevel', 'mathvariant']); return row(children(node), style);
    case 'mi': case 'mo': case 'mn': case 'mtext': return atom(node, style);
    case 'mfrac': {
      attrs(node, ['linethickness']);
      if (node.attrs.linethickness && !/^0(?:\.0+)?(?:px|em|pt)?$/.test(node.attrs.linethickness)) fail('사용자 지정 분수선 두께');
      const [top, bottom] = args(node, 2).map((item) => convert(item, style));
      return part(`${group(top.script)} ${node.attrs.linethickness ? 'ATOP' : 'OVER'} ${group(bottom.script)}`, Math.max(top.width, bottom.width) + 0.35, top.above + top.below + 0.4, bottom.above + bottom.below + 0.2);
    }
    case 'msqrt': case 'mroot': {
      attrs(node, []);
      const list = node.tag === 'mroot' ? args(node, 2) : children(node);
      const body = node.tag === 'msqrt' ? row(list, style) : convert(list[0], style), degree = node.tag === 'mroot' ? convert(list[1], style) : undefined;
      return part(degree ? `ROOT ${group(degree.script)} OF ${group(body.script)}` : `SQRT ${group(body.script)}`, body.width + 0.7 + (degree?.width ?? 0) * 0.4, body.above + 0.25, body.below);
    }
    case 'msub': case 'msup': case 'msubsup': {
      attrs(node, []);
      const fields = args(node, node.tag === 'msubsup' ? 3 : 2);
      return scripted(convert(fields[0], style), node.tag === 'msup' ? undefined : convert(fields[1], style), node.tag === 'msub' ? undefined : convert(fields.at(-1)!, style));
    }
    case 'munder': case 'mover': case 'munderover': {
      attrs(node, ['accent', 'accentunder']);
      const fields = args(node, node.tag === 'munderover' ? 3 : 2), base = convert(fields[0], style), mark = content(fields[1]);
      if (node.tag !== 'munderover' && (node.attrs.accent === 'true' || node.attrs.accentunder === 'true')) {
        const command = node.tag === 'munder' && ['¯', '‾', '_'].includes(mark) ? 'UNDER' : node.tag === 'mover' ? ACCENTS[mark] : undefined;
        if (!command) fail('지원하지 않는 수식 장식');
        return { ...base, script: `${command} ${group(base.script)}`, above: base.above + (node.tag === 'mover' ? 0.25 : 0), below: base.below + (node.tag === 'munder' ? 0.25 : 0) };
      }
      const sub = node.tag === 'mover' ? undefined : convert(fields[1], style), sup = node.tag === 'munder' ? undefined : convert(fields.at(-1)!, style);
      const baseContent = content(fields[0]).replace(/[\u2061\u2062]/g, '');
      // Native SUM/INT/lim understand their limits; other stacked annotations
      // use UNDEROVER instead of incorrectly turning them into side scripts.
      const head = NARY.has(baseContent) || ['lim', 'Lim', 'max', 'min'].includes(baseContent) ? base.script : `UNDEROVER ${group(base.script)}`;
      return part(`${head}${sub ? ` _ ${group(sub.script)}` : ''}${sup ? ` ^ ${group(sup.script)}` : ''}`, Math.max(base.width, sub?.width ?? 0, sup?.width ?? 0), base.above + (sup ? (sup.above + sup.below) * 0.7 + 0.15 : 0), base.below + (sub ? (sub.above + sub.below) * 0.7 + 0.15 : 0));
    }
    case 'mtable': return matrix(node, style);
    case 'mspace': {
      attrs(node, ['width']);
      const match = /^([0-9]+(?:\.[0-9]+)?)em$/.exec(node.attrs.width ?? '');
      if (!match || Number(match[1]) > 10) fail('음수 간격·줄바꿈·지원하지 않는 수식 간격');
      const width = Number(match[1]);
      return part('`'.repeat(Math.round(width * 4)), width, 0, 0);
    }
    default: return fail(`${node.tag} 구조는 아직 지원하지 않습니다`);
  }
}

function compile(latex: string, options: HwpxMathOptions): Part {
  if (typeof latex !== 'string' || !latex.trim() || latex.length > 20_000) fail('비어 있거나 너무 긴 수식');
  xml(latex);
  let markup: string;
  try {
    markup = katex.renderToString(latex, { output: 'mathml', throwOnError: true, trust: false, strict: 'ignore', displayMode: options.display === true || /\\limits(?![A-Za-z])/.test(latex), maxExpand: 1000, maxSize: 20 });
  } catch { return fail('LaTeX 문법을 확인해 주세요'); }
  const result = convert(parse(markup), {});
  if (!result.script || !result.width) fail('표시할 수식이 없습니다');
  if (options.bold) result.script = `BOLD ${group(result.script)}`;
  if (options.underline) { result.script = `UNDER ${group(result.script)}`; result.below += 0.2; }
  return result;
}

/** Native Hancom script, with unsupported expressions reported explicitly. */
export function latexToHwpScript(latex: string, options: HwpxMathOptions = {}): string {
  return compile(latex, options).script;
}

function baseUnit(options: HwpxMathOptions): number {
  const size = options.fontSizePt ?? 10;
  if (!Number.isFinite(size) || size < 1 || size > 100) fail('글자 크기는 1~100pt여야 합니다');
  return Math.round(size * 100);
}

/** Conservative pre-layout estimates in HWPUNIT (1pt=100); not font metrics. */
export function measureHwpxMath(latex: string, options: HwpxMathOptions = {}): HwpxMathMetrics {
  const value = compile(latex, options), unit = baseUnit(options);
  return { width: Math.ceil(value.width * unit * 1.1), height: Math.ceil((value.above + value.below) * unit * 1.1), baseline: Math.ceil(value.above * unit * 1.1) };
}

/** Self-contained, inline editable equation. Caller owns document-wide IDs. */
export function latexToHwpxEquation(latex: string, options: HwpxMathOptions & { id: number }): string {
  if (!Number.isInteger(options.id) || options.id < 1 || options.id > 0xffffffff) fail('수식 개체 ID가 올바르지 않습니다');
  const script = latexToHwpScript(latex, options), unit = baseUnit(options);
  // Hancom explicitly recommends zero width/height/baseLine to recalculate
  // dimensions with its own equation font on open, avoiding fabricated sizes:
  // https://forum.developer.hancom.com/t/hp-sz-width/1783
  // Envelope follows hp:EquationType and the documented native example:
  // https://github.com/jkf87/hwpx-skill/blob/96a2633f23a08f707679d7e212ebdc59948260e6/scripts/fill_hwpx.py
  return `<hp:equation id="${options.id}" zOrder="0" numberingType="EQUATION" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" version="Equation Version 60" baseLine="0" textColor="#000000" baseUnit="${unit}" lineMode="CHAR" font="HancomEQN"><hp:sz width="0" widthRelTo="ABSOLUTE" height="0" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="1" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="56" right="56" top="0" bottom="0"/><hp:script>${xml(script)}</hp:script></hp:equation>`;
}
