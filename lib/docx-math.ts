import katex from 'katex';

export type DocxMathOptions = { display?: boolean; bold?: boolean; underline?: boolean };

type MathNode = { tag: string; attrs: Record<string, string>; children: Array<MathNode | string> };
type Style = { bold: boolean; variant?: string };

// The caller declares m and w on document.xml. Element ordering follows the
// Microsoft Open XML SDK schema, notably CT_F, CT_Rad, CT_Nary, CT_SSubSup,
// CT_DPr, CT_MCPr and CT_R (math run properties precede Word run properties):
// https://github.com/dotnet/Open-XML-SDK/blob/main/data/schemas/schemas_openxmlformats_org_officeDocument_2006_math.json
// This is a structural converter, not a mathematical equivalence checker.
const NARY = new Set(Array.from('∑∏∐∫∬∭∮∯∰⋃⋂⋁⋀⨀⨁⨂⨄⨆'));
const ACCENTS: Record<string, string> = { '^': '\u0302', '~': '\u0303', '˙': '\u0307', '¨': '\u0308', '´': '\u0301', '`': '\u0300', '˘': '\u0306', 'ˇ': '\u030c', '⃗': '\u20d7', '→': '\u20d7', '←': '\u20d6', '↔': '\u20e1' };

function failure(detail: string): never {
  throw new Error(`Word 편집형 수식으로 변환할 수 없습니다: ${detail}`);
}

function xml(value: string): string {
  // XML 1.0 forbids these characters, even when escaped as numeric entities.
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if ((code < 0x20 && code !== 9 && code !== 10 && code !== 13) || (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff) failure('잘못된 XML 문자');
  }
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!));
}

function decodeEntities(value: string): string {
  return value.replace(/&([^;]+);/g, (_, entity: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
    if (Object.hasOwn(named, entity)) return named[entity];
    if (/^#(?:x[0-9a-f]+|[0-9]+)$/i.test(entity)) {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (code >= 0 && code <= 0x10ffff) return String.fromCodePoint(code);
    }
    return failure('알 수 없는 MathML 문자 참조');
  });
}

// Parse only KaTeX's generated XML, never arbitrary HTML or external XML.
// No DOMParser, filesystem, fetch, custom entity expansion or runtime dependency.
function parseMathml(markup: string): MathNode {
  const math = markup.match(/<math\b[^>]*>[\s\S]*?<\/math>/)?.[0];
  if (!math || math.length > 500_000) failure('MathML이 없거나 너무 큽니다');
  const root: MathNode = { tag: 'root', attrs: {}, children: [] };
  const stack = [root];
  let count = 0;
  for (const token of math.match(/<[^>]*>|[^<]+/g) ?? []) {
    if (++count > 30_000 || stack.length > 128) failure('수식 구조가 너무 복잡합니다');
    if (!token.startsWith('<')) {
      stack.at(-1)!.children.push(decodeEntities(token));
      continue;
    }
    const end = /^<\/([a-z][a-z0-9]*)>$/.exec(token);
    if (end) {
      if (stack.length < 2 || stack.pop()!.tag !== end[1]) failure('MathML 닫는 태그가 맞지 않습니다');
      continue;
    }
    const start = /^<([a-z][a-z0-9]*)([\s\S]*?)(\/?)>$/.exec(token);
    if (!start) failure('지원하지 않는 MathML 태그');
    const node: MathNode = { tag: start[1], attrs: {}, children: [] };
    const attrs = start[2];
    const rest = attrs.replace(/\s+([a-z][a-z0-9:-]*)="([^"]*)"/g, (_, name: string, value: string) => {
      if (Object.hasOwn(node.attrs, name)) failure('중복 MathML 속성');
      node.attrs[name] = decodeEntities(value);
      return '';
    });
    if (rest.trim()) failure('잘못된 MathML 속성');
    stack.at(-1)!.children.push(node);
    if (!start[3]) stack.push(node);
  }
  if (stack.length !== 1 || root.children.length !== 1 || typeof root.children[0] === 'string') failure('잘못된 MathML 문서');
  return root.children[0];
}

function nodes(node: MathNode): MathNode[] {
  if (node.children.some((child) => typeof child === 'string' && child.trim())) failure(`${node.tag}의 예상하지 못한 본문`);
  return node.children.filter((child): child is MathNode => typeof child !== 'string');
}

function content(node: MathNode): string {
  return node.children.map((child) => typeof child === 'string' ? child : content(child)).join('');
}

function argumentsOf(node: MathNode, count: number): MathNode[] {
  const children = nodes(node);
  if (children.length !== count) failure(`${node.tag}의 인수 개수`);
  return children;
}

function checkAttributes(node: MathNode, allowed: string[]) {
  for (const attr of Object.keys(node.attrs)) if (!allowed.includes(attr)) failure(`${node.tag}/${attr}는 아직 지원하지 않습니다`);
}

function run(text: string, tag: string, style: Style): string {
  if (!text) return '';
  const variant = style.variant ?? (tag === 'mi' && Array.from(text).length === 1 ? 'italic' : 'normal');
  const variants: Record<string, [string, string]> = {
    normal: ['roman', 'p'], italic: ['roman', 'i'], bold: ['roman', 'b'], 'bold-italic': ['roman', 'bi'],
    script: ['script', 'i'], 'bold-script': ['script', 'bi'], fraktur: ['fraktur', 'p'], 'bold-fraktur': ['fraktur', 'b'],
    'double-struck': ['double-struck', 'p'], 'sans-serif': ['sans-serif', 'p'], 'bold-sans-serif': ['sans-serif', 'b'],
    'sans-serif-italic': ['sans-serif', 'i'], 'sans-serif-bold-italic': ['sans-serif', 'bi'], monospace: ['monospace', 'p'],
  };
  if (!Object.hasOwn(variants, variant)) failure(`mathvariant=${variant}`);
  const [script, baseStyle] = variants[variant];
  const mathStyle = style.bold ? (baseStyle === 'i' || baseStyle === 'bi' ? 'bi' : 'b') : baseStyle;
  // Normal text is native OMML too, and preserves upright chemical/function
  // letters in readers that ignore m:sty. It replaces, not accompanies, scr/sty.
  const normal = tag === 'mtext' || (tag === 'mi' && script === 'roman' && ['p', 'b'].includes(mathStyle));
  const mathPr = normal ? '<m:nor/>' : `<m:scr m:val="${script}"/><m:sty m:val="${mathStyle}"/>`;
  const wordPr = `<w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/>${style.bold || mathStyle.startsWith('b') ? '<w:b/>' : ''}${normal ? `<w:i w:val="${mathStyle.includes('i') ? 1 : 0}"/>` : ''}`;
  return `<m:r><m:rPr>${mathPr}</m:rPr><w:rPr>${wordPr}</w:rPr><m:t xml:space="preserve">${xml(text)}</m:t></m:r>`;
}

function unwrap(node: MathNode): MathNode {
  while ((node.tag === 'mrow' || node.tag === 'mstyle' || node.tag === 'mo') && node.children.length === 1 && typeof node.children[0] !== 'string' && !Object.keys(node.attrs).length) node = node.children[0];
  return node;
}

function naryInfo(node: MathNode) {
  node = unwrap(node);
  let lower: MathNode | undefined;
  let upper: MathNode | undefined;
  let base = node;
  const underOver = ['munder', 'mover', 'munderover'].includes(node.tag);
  if (['msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover'].includes(node.tag)) {
    const parts = argumentsOf(node, ['msubsup', 'munderover'].includes(node.tag) ? 3 : 2);
    base = unwrap(parts[0]);
    if (['msub', 'msubsup', 'munder', 'munderover'].includes(node.tag)) lower = parts[1];
    if (['msup', 'mover'].includes(node.tag)) upper = parts[1];
    if (['msubsup', 'munderover'].includes(node.tag)) upper = parts[2];
  }
  return base.tag === 'mo' && !nodesSafe(base).length && NARY.has(content(base)) ? { char: content(base), lower, upper, underOver } : undefined;
}

function nodesSafe(node: MathNode): MathNode[] {
  return node.children.filter((child): child is MathNode => typeof child !== 'string');
}

function nary(node: MathNode, body: string, style: Style): string {
  const info = naryInfo(node)!;
  return `<m:nary><m:naryPr><m:chr m:val="${xml(info.char)}"/><m:limLoc m:val="${info.underOver ? 'undOvr' : 'subSup'}"/><m:grow m:val="1"/><m:subHide m:val="${info.lower ? 0 : 1}"/><m:supHide m:val="${info.upper ? 0 : 1}"/></m:naryPr><m:sub>${info.lower ? convert(info.lower, style) : ''}</m:sub><m:sup>${info.upper ? convert(info.upper, style) : ''}</m:sup><m:e>${body}</m:e></m:nary>`;
}

function isFence(node: MathNode | undefined): boolean {
  return node?.tag === 'mo' && node.attrs.fence === 'true';
}

function row(children: MathNode[], style: Style): string {
  if (children.length > 1 && (isFence(children[0]) || isFence(children.at(-1)))) {
    const begin = isFence(children[0]) ? children[0] : undefined;
    const end = isFence(children.at(-1)) ? children.at(-1) : undefined;
    const inside = children.slice(begin ? 1 : 0, end ? -1 : undefined);
    const separators = inside.filter(isFence);
    if (separators.some((separator) => content(separator) !== content(separators[0]))) failure('서로 다른 middle 구분자');
    const groups: MathNode[][] = [[]];
    for (const child of inside) {
      if (isFence(child)) groups.push([]); else groups.at(-1)!.push(child);
    }
    return `<m:d><m:dPr><m:begChr m:val="${xml(begin ? content(begin) : '')}"/><m:sepChr m:val="${xml(separators.length ? content(separators[0]) : '')}"/><m:endChr m:val="${xml(end ? content(end) : '')}"/><m:grow m:val="1"/></m:dPr>${groups.map((group) => `<m:e>${row(group, style)}</m:e>`).join('')}</m:d>`;
  }
  const parts: string[] = [];
  function closingOperand(start: number): number | undefined {
    const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
    const opening = children[start];
    if (opening?.tag !== 'mo' || !Object.hasOwn(pairs, content(opening))) return;
    const stack: string[] = [];
    for (let index = start; index < children.length; index++) {
      const node = children[index];
      if (node.tag !== 'mo') continue;
      const char = content(node);
      if (Object.hasOwn(pairs, char)) stack.push(pairs[char]);
      else if (Object.values(pairs).includes(char)) {
        if (stack.pop() !== char) return;
        if (!stack.length) return index;
      }
    }
  }
  function takeNary(index: number): { value: string; last: number } {
    let nextIndex = index + 1;
    let spacing = '';
    while (children[nextIndex] && (children[nextIndex].tag === 'mspace' || (children[nextIndex].tag === 'mtext' && /^[\s\u2061-\u2064]*$/u.test(content(children[nextIndex]))))) {
      spacing += convert(children[nextIndex++], style);
    }
    const next = children[nextIndex];
    if (next && naryInfo(next)) {
      const nested = takeNary(nextIndex);
      return { value: nary(children[index], spacing + nested.value, style), last: nested.last };
    }
    // Ordinary (a+b) uses separate mo siblings, unlike a \left...\right mrow.
    // Its balanced delimiters provide the exact summand boundary.
    const close = closingOperand(nextIndex);
    if (close !== undefined) {
      const operand = row(children.slice(nextIndex, close + 1), style);
      return { value: nary(children[index], spacing + operand, style), last: close };
    }
    const operand = next && !(next.tag === 'mo' && !isFence(next)) ? convert(next, style) : '';
    return { value: nary(children[index], spacing + operand, style), last: nextIndex - (operand ? 0 : 1) };
  }
  for (let index = 0; index < children.length; index++) {
    const node = children[index];
    if (naryInfo(node)) {
      // MathML leaves the operand as a following sibling. Attach one following
      // atom without guessing how far an unbracketed expression extends.
      const expression = takeNary(index);
      index = expression.last;
      parts.push(expression.value);
    } else if (['msub', 'msup', 'msubsup'].includes(node.tag) && nodes(node)[0]?.tag === 'mrow' && nodes(node)[0].children.length === 0 && children[index + 1] && children[index + 1].tag !== 'mo') {
      const args = nodes(node);
      const sub = node.tag === 'msup' ? '' : convert(args[1], style);
      const sup = node.tag === 'msub' ? '' : convert(args[node.tag === 'msup' ? 1 : 2], style);
      parts.push(`<m:sPre><m:sub>${sub}</m:sub><m:sup>${sup}</m:sup><m:e>${convert(children[++index], style)}</m:e></m:sPre>`);
    } else parts.push(convert(node, style));
  }
  return parts.join('');
}

function matrix(node: MathNode, style: Style): string {
  checkAttributes(node, ['rowspacing', 'columnalign', 'columnspacing']);
  const rows = nodes(node);
  if (!rows.length || rows.length > 256 || rows.some((item) => item.tag !== 'mtr')) failure('지원하지 않는 행렬 행');
  const columns = Math.max(...rows.map((item) => nodes(item).length));
  if (!columns || columns > 64) failure('행렬은 1~64열이어야 합니다');
  const alignment = (node.attrs.columnalign ?? 'center').split(/\s+/);
  if (alignment.some((value) => !['left', 'center', 'right'].includes(value))) failure('지원하지 않는 행렬 정렬');
  const columnPr = Array.from({ length: columns }, (_, index) => `<m:mc><m:mcPr><m:count m:val="1"/><m:mcJc m:val="${alignment[index] ?? alignment.at(-1)}"/></m:mcPr></m:mc>`).join('');
  const body = rows.map((item) => {
    checkAttributes(item, []);
    const cells = nodes(item);
    if (cells.some((cell) => cell.tag !== 'mtd')) failure('지원하지 않는 행렬 셀');
    return `<m:mr>${Array.from({ length: columns }, (_, index) => {
      if (!cells[index]) return '<m:e/>';
      checkAttributes(cells[index], []);
      return `<m:e>${row(nodes(cells[index]), style)}</m:e>`;
    }).join('')}</m:mr>`;
  }).join('');
  return `<m:m><m:mPr><m:baseJc m:val="center"/><m:mcs>${columnPr}</m:mcs></m:mPr>${body}</m:m>`;
}

function convert(node: MathNode, inherited: Style): string {
  const style = { ...inherited, variant: node.attrs.mathvariant ?? inherited.variant };
  switch (node.tag) {
    case 'math':
      checkAttributes(node, ['xmlns', 'display']);
      return row(nodes(node), style);
    case 'semantics': {
      checkAttributes(node, []);
      const children = nodes(node).filter((child) => child.tag !== 'annotation');
      if (children.length !== 1) failure('예상하지 못한 MathML semantics');
      return convert(children[0], style);
    }
    case 'mrow':
      checkAttributes(node, []);
      return row(nodes(node), style);
    case 'mstyle':
      // Word sets its own script sizes/spacing. Structural child nodes retain
      // the explicit scripts; unsupported color/phantom layouts must not vanish.
      checkAttributes(node, ['displaystyle', 'scriptlevel', 'mathvariant']);
      return row(nodes(node), style);
    case 'mi': case 'mn': case 'mo': case 'mtext':
      checkAttributes(node, ['mathvariant', 'fence', 'stretchy', 'symmetric', 'minsize', 'maxsize', 'lspace', 'rspace', 'separator', 'largeop', 'movablelimits']);
      if (nodesSafe(node).length) return row(nodes(node), style);
      if (naryInfo(node)) return nary(node, '', style);
      return run(content(node), node.tag, style);
    case 'mfrac': {
      checkAttributes(node, ['linethickness']);
      const [numerator, denominator] = argumentsOf(node, 2);
      if (node.attrs.linethickness && !/^0(?:\.0+)?(?:px|em|pt)?$/.test(node.attrs.linethickness)) failure('사용자 지정 분수선 두께');
      return `<m:f>${node.attrs.linethickness ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : ''}<m:num>${convert(numerator, style)}</m:num><m:den>${convert(denominator, style)}</m:den></m:f>`;
    }
    case 'msqrt': case 'mroot': {
      checkAttributes(node, []);
      const args = node.tag === 'mroot' ? argumentsOf(node, 2) : nodes(node);
      return `<m:rad><m:radPr><m:degHide m:val="${node.tag === 'msqrt' ? 1 : 0}"/></m:radPr><m:deg>${node.tag === 'mroot' ? convert(args[1], style) : ''}</m:deg><m:e>${node.tag === 'mroot' ? convert(args[0], style) : row(args, style)}</m:e></m:rad>`;
    }
    case 'msub': case 'msup': case 'msubsup': {
      checkAttributes(node, []);
      if (naryInfo(node)) return nary(node, '', style);
      const args = argumentsOf(node, node.tag === 'msubsup' ? 3 : 2);
      const tag = { msub: 'sSub', msup: 'sSup', msubsup: 'sSubSup' }[node.tag]!;
      return `<m:${tag}><m:e>${convert(args[0], style)}</m:e>${node.tag !== 'msup' ? `<m:sub>${convert(args[1], style)}</m:sub>` : ''}${node.tag !== 'msub' ? `<m:sup>${convert(args[node.tag === 'msup' ? 1 : 2], style)}</m:sup>` : ''}</m:${tag}>`;
    }
    case 'munder': case 'mover': case 'munderover': {
      checkAttributes(node, ['accent', 'accentunder']);
      if (naryInfo(node)) return nary(node, '', style);
      const args = argumentsOf(node, node.tag === 'munderover' ? 3 : 2);
      const base = convert(args[0], style);
      const mark = content(args[1]);
      if (node.tag !== 'munderover' && nodesSafe(args[1]).length === 0) {
        const position = node.tag === 'mover' ? 'top' : 'bot';
        if (['‾', '¯', '_'].includes(mark)) return `<m:bar><m:barPr><m:pos m:val="${position}"/></m:barPr><m:e>${base}</m:e></m:bar>`;
        if (['⏞', '⏟', '⏜', '⏝'].includes(mark)) return `<m:groupChr><m:groupChrPr><m:chr m:val="${xml(mark)}"/><m:pos m:val="${position}"/><m:vertJc m:val="${position === 'top' ? 'bot' : 'top'}"/></m:groupChrPr><m:e>${base}</m:e></m:groupChr>`;
        if (node.tag === 'mover' && node.attrs.accent === 'true') {
          const accent = ACCENTS[mark] ?? (Array.from(mark).length === 1 ? mark : undefined);
          if (!accent) failure('지원하지 않는 수식 악센트');
          return `<m:acc><m:accPr><m:chr m:val="${xml(accent)}"/></m:accPr><m:e>${base}</m:e></m:acc>`;
        }
      }
      if (node.attrs.accent === 'true' || node.attrs.accentunder === 'true') failure('지원하지 않는 수식 악센트 구조');
      const lower = node.tag !== 'mover' ? `<m:limLow><m:e>${base}</m:e><m:lim>${convert(args[1], style)}</m:lim></m:limLow>` : base;
      return node.tag !== 'munder' ? `<m:limUpp><m:e>${lower}</m:e><m:lim>${convert(args[node.tag === 'mover' ? 1 : 2], style)}</m:lim></m:limUpp>` : lower;
    }
    case 'mtable': return matrix(node, style);
    case 'mspace': {
      checkAttributes(node, ['width']);
      const match = /^([0-9]+(?:\.[0-9]+)?)em$/.exec(node.attrs.width ?? '');
      if (!match || Number(match[1]) > 10) failure('지원하지 않는 수식 간격 또는 줄바꿈');
      // Explicit positive spacing is preserved approximately in Unicode em and
      // thin spaces; Word controls the precise mathematical typography.
      const width = Number(match[1]);
      return run('\u2003'.repeat(Math.floor(width)) + '\u2009'.repeat(Math.round((width % 1) * 6)), 'mtext', style);
    }
    default: return failure(`${node.tag} 구조는 아직 지원하지 않습니다`);
  }
}

/** Returns a native editable Word equation; throws instead of dropping content. */
export function latexToOmml(latex: string, options: DocxMathOptions = {}): string {
  if (typeof latex !== 'string' || !latex.trim() || latex.length > 20_000) failure('비어 있거나 너무 긴 수식');
  // Explicit limits need display-style MathML in KaTeX even inside an inline
  // paragraph. oMath remains inline; its enclosing paragraph controls placement.
  let markup: string;
  try {
    markup = katex.renderToString(latex, { output: 'mathml', throwOnError: true, trust: false, strict: 'ignore', displayMode: options.display === true || /\\limits(?![A-Za-z])/.test(latex), maxExpand: 1000, maxSize: 20 });
  } catch {
    return failure('LaTeX 문법을 확인해 주세요');
  }
  const body = convert(parseMathml(markup), { bold: options.bold === true });
  if (!body) failure('표시할 수식이 없습니다');
  // A Word run underline inside OMML is ignored by some native readers.
  // Use one bottom bar across the complete selected formula, including scripts.
  const styled = options.underline ? `<m:bar><m:barPr><m:pos m:val="bot"/></m:barPr><m:e>${body}</m:e></m:bar>` : body;
  return `<m:oMath>${styled}</m:oMath>`;
}
