import { formatRuns, type TextRun } from './text-formatting';
import { hwpxViewBox } from './hwpx-layout';

/** This reader extracts document structure, not Hancom's pagination or rendering. */
export type HwpxInline =
  | ({ kind: 'text'; charPrIDRef?: string } & TextRun)
  | { kind: 'equation'; script: string; latex?: string; bold: boolean; underline: boolean }
  | { kind: 'image'; imageId: string; alt: string };
export type HwpxParagraph = {
  kind: 'paragraph'; text: string; plainText: string; runs: HwpxInline[];
  paragraphId?: string; pageBreak: boolean;
  numbering?: { type: string; idRef?: string; level?: number };
};
export type HwpxTableCell = {
  row: number; column: number; rowSpan: number; colSpan: number;
  blocks: HwpxBlock[]; text: string; plainText: string;
  borderFillIDRef?: string;
  borders?: { left: boolean; right: boolean; top: boolean; bottom: boolean };
};
export type HwpxBlock = HwpxParagraph | {
  kind: 'table'; rows: number; columns: number; cells: HwpxTableCell[];
  text: string; plainText: string;
  presentation?: { kind: 'box'; title: string; reason: 'layout-view' };
};
export type HwpxImage = { id: string; path: string; mimeType: string; dataUrl: string };
export type HwpxImportDocument = {
  format: 'hwpx'; text: string; plainText: string; blocks: HwpxBlock[];
  sections: Array<{ index: number; path: string; text: string; blocks: HwpxBlock[] }>;
  images: HwpxImage[]; warnings: string[]; hasOriginalPageCaptures: false;
  notes: Array<{ kind: 'footnote' | 'endnote'; sectionPath: string; anchorParagraphId?: string; number?: number; text: string; plainText: string; blocks: HwpxBlock[] }>;
};

const LIMIT = {
  archive: 64 * 1024 * 1024, entry: 32 * 1024 * 1024,
  // Large legitimate books can have a 17+ MiB section. Keep the per-entry,
  // aggregate, inflation-ratio, node, depth and cell limits independently.
  expanded: 256 * 1024 * 1024, xml: 24 * 1024 * 1024,
  entries: 2048, nodes: 500_000, depth: 96, cells: 4096,
};
function fail(detail: string): never { throw new Error(`HWPX 파일을 읽을 수 없습니다: ${detail}`); }
const utf8 = new TextDecoder('utf-8', { fatal: true });
function decode(bytes: Uint8Array): string {
  try { return utf8.decode(bytes); } catch { return fail('UTF-8 문자 데이터가 손상되었습니다.'); }
}
function safePath(path: string, directory = false): boolean {
  const parts = (directory && path.endsWith('/') ? path.slice(0, -1) : path).split('/');
  return path.length > 0 && path.length <= 1024 && !/[\\:%?#]/.test(path)
    && !Array.from(path).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    && parts.every((part) => part !== '' && part !== '.' && part !== '..');
}
const crcTable = new Uint32Array(256).map((_value, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  return crc >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
type ZipPart = { name: string; start: number; compressed: number; size: number; method: number; crc: number };

/** ZIP32 only. Every bound is checked before decompression or allocation. */
function openZip(bytes: Uint8Array) {
  if (bytes.length < 22 || bytes.length > LIMIT.archive) fail('압축 파일 크기가 올바르지 않습니다 (최대 64 MB).');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true), u32 = (at: number) => view.getUint32(at, true);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (u32(at) === 0x06054b50 && at + 22 + u16(at + 20) === bytes.length) { end = at; break; }
  }
  if (end < 0) fail('ZIP 끝 정보가 없거나 파일이 잘렸습니다.');
  const count = u16(end + 10), centralSize = u32(end + 12), centralStart = u32(end + 16);
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || count === 65535
    || centralSize === 0xffffffff || centralStart === 0xffffffff) fail('분할 ZIP 또는 ZIP64는 지원하지 않습니다.');
  if (!count || count > LIMIT.entries || centralStart + centralSize !== end) fail('ZIP 항목 수 또는 디렉터리가 올바르지 않습니다.');
  const parts = new Map<string, ZipPart>(), ranges: Array<[number, number]> = [];
  let at = centralStart, total = 0;
  const checkExtra = (start: number, length: number) => {
    const finish = start + length;
    while (start < finish) {
      if (start + 4 > finish || start + 4 + u16(start + 2) > finish) fail('ZIP 확장 정보가 손상되었습니다.');
      if (u16(start) === 1) fail('ZIP64는 지원하지 않습니다.');
      start += 4 + u16(start + 2);
    }
  };
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || u32(at) !== 0x02014b50) fail('ZIP 디렉터리가 손상되었습니다.');
    const flags = u16(at + 8), method = u16(at + 10), crc = u32(at + 16);
    const compressed = u32(at + 20), size = u32(at + 24), nameLength = u16(at + 28), extra = u16(at + 30), comment = u16(at + 32);
    const local = u32(at + 42), next = at + 46 + nameLength + extra + comment;
    if (next > end || u16(at + 34)) fail('ZIP 항목의 경계가 올바르지 않습니다.');
    if (flags & (1 | 64 | 8192)) fail('암호화된 문서는 지원하지 않습니다. 한글에서 암호를 해제해 주세요.');
    if (flags & ~(0x0800 | 8 | 2 | 4)) fail('지원하지 않는 ZIP 압축 옵션입니다.');
    if (![0, 8].includes(method)) fail('지원하지 않는 ZIP 압축 방식입니다.');
    if (size > LIMIT.entry || compressed > LIMIT.archive || (total += size) > LIMIT.expanded)
      fail('압축 해제 크기가 허용 범위를 넘습니다.');
    if (size > Math.max(1024 * 1024, compressed * 500)) fail('압축률이 지나치게 높은 파일입니다.');
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength), name = decode(nameBytes);
    if (!(flags & 0x0800) && nameBytes.some((byte) => byte > 127)) fail('UTF-8이 아닌 ZIP 파일 이름은 지원하지 않습니다.');
    if (!safePath(name, true) || parts.has(name)) fail('위험하거나 중복된 ZIP 파일 경로입니다.');
    checkExtra(at + 46 + nameLength, extra);
    if (local + 30 > centralStart || u32(local) !== 0x04034b50) fail('ZIP 항목 헤더가 손상되었습니다.');
    const localNameLength = u16(local + 26), localExtra = u16(local + 28), start = local + 30 + localNameLength + localExtra;
    if (start + compressed > centralStart || u16(local + 6) !== flags || u16(local + 8) !== method
      || localNameLength !== nameLength || decode(bytes.subarray(local + 30, local + 30 + localNameLength)) !== name)
      fail('ZIP 항목 정보가 일치하지 않습니다.');
    checkExtra(local + 30 + localNameLength, localExtra);
    if (!(flags & 8) && (u32(local + 14) !== crc || u32(local + 18) !== compressed || u32(local + 22) !== size))
      fail('ZIP 항목 크기 또는 검증 값이 일치하지 않습니다.');
    if (method === 0 && size !== compressed) fail('ZIP 저장 항목 크기가 일치하지 않습니다.');
    let finish = start + compressed;
    if (flags & 8) {
      if (finish + 12 > centralStart) fail('ZIP 데이터 설명자가 없습니다.');
      const descriptor = u32(finish) === 0x08074b50 ? finish + 4 : finish;
      if (descriptor + 12 > centralStart || u32(descriptor) !== crc || u32(descriptor + 4) !== compressed || u32(descriptor + 8) !== size)
        fail('ZIP 데이터 설명자가 일치하지 않습니다.');
      finish = descriptor + 12;
    }
    ranges.push([local, finish]);
    parts.set(name, { name, start, compressed, size, method, crc });
    at = next;
  }
  if (at !== end) fail('ZIP 디렉터리 크기가 일치하지 않습니다.');
  ranges.sort((a, b) => a[0] - b[0]);
  if (ranges.some((range, i) => i > 0 && range[0] < ranges[i - 1][1])) fail('ZIP 항목 영역이 겹칩니다.');
  const cache = new Map<string, Uint8Array>();
  return {
    names: [...parts.keys()],
    has: (name: string) => parts.has(name),
    release: (name: string) => { cache.delete(name); },
    async read(name: string): Promise<Uint8Array> {
      const cached = cache.get(name);
      if (cached) return cached;
      const part = parts.get(name);
      if (!part) return fail(`필수 파일이 없습니다: ${name}`);
      const source = bytes.subarray(part.start, part.start + part.compressed);
      let result: Uint8Array;
      if (part.method === 0) result = source;
      else {
        let stream: DecompressionStream;
        try { stream = new DecompressionStream('deflate-raw'); }
        catch { return fail('이 브라우저는 HWPX 압축 해제를 지원하지 않습니다. 최신 Chrome 또는 Edge를 사용해 주세요.'); }
        const reader = new Blob([Uint8Array.from(source).buffer]).stream().pipeThrough(stream).getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            length += next.value.length;
            if (length > part.size || length > LIMIT.entry) {
              await reader.cancel();
              fail('실제 압축 해제 크기가 허용 범위를 넘습니다.');
            }
            chunks.push(next.value);
          }
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('HWPX')) throw error;
          return fail(`압축 데이터가 손상되었습니다: ${name}`);
        } finally { reader.releaseLock(); }
        result = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
      }
      if (result.length !== part.size || crc32(result) !== part.crc) fail(`파일 검증 값이 일치하지 않습니다: ${name}`);
      cache.set(name, result);
      return result;
    },
  };
}

type XmlNode = { name: string; attrs: Record<string, string>; children: Array<XmlNode | string> };
const localName = (name: string) => name.split(':').at(-1)!;
const elements = (node: XmlNode): XmlNode[] => node.children.filter((child): child is XmlNode => typeof child !== 'string');
const child = (node: XmlNode, name: string) => elements(node).find((item) => localName(item.name) === name);
const content = (node: XmlNode): string => node.children.map((item) => typeof item === 'string' ? item : content(item)).join('');
function descendants(node: XmlNode, name: string): XmlNode[] {
  const result: XmlNode[] = [];
  for (const item of elements(node)) {
    if (localName(item.name) === name) result.push(item);
    result.push(...descendants(item, name));
  }
  return result;
}
function validXmlChars(value: string) {
  for (const char of value) {
    const cp = char.codePointAt(0)!;
    if (cp < 32 && ![9, 10, 13].includes(cp) || cp >= 0xd800 && cp <= 0xdfff || cp === 0xfffe || cp === 0xffff)
      fail('잘못된 XML 문자입니다.');
  }
}
function xmlEntities(value: string) {
  const result = value.replace(/&([^;]*);|&/g, (_whole, entity: string | undefined) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (entity && Object.hasOwn(named, entity)) return named[entity];
    if (entity && /^(?:#[0-9]+|#x[0-9a-fA-F]+)$/.test(entity)) {
      const code = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (code <= 0x10ffff) return String.fromCodePoint(code);
    }
    return fail('알 수 없거나 외부 XML 문자 참조입니다.');
  });
  validXmlChars(result);
  return result;
}
/** No DOM, DTD, entity expansion, network access or HTML interpretation. */
function parseXml(source: string): XmlNode {
  if (source.length > LIMIT.xml) fail('XML 본문이 너무 큽니다.');
  validXmlChars(source);
  const root: XmlNode = { name: '', attrs: Object.create(null), children: [] }, stack = [root];
  const namePattern = '[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?';
  let at = 0, nodes = 0;
  while (at < source.length) {
    if (++nodes > LIMIT.nodes || stack.length > LIMIT.depth) fail('XML 구조가 너무 복잡합니다.');
    if (source[at] !== '<') {
      const next = source.indexOf('<', at), end = next < 0 ? source.length : next;
      const text = source.slice(at, end);
      if (text.includes(']]>')) fail('잘못된 XML 본문입니다.');
      stack.at(-1)!.children.push(xmlEntities(text)); at = end; continue;
    }
    if (source.startsWith('<!--', at)) {
      const end = source.indexOf('-->', at + 4);
      if (end < 0 || source.slice(at + 4, end).includes('--')) fail('XML 주석이 손상되었습니다.');
      at = end + 3; continue;
    }
    if (source.startsWith('<![CDATA[', at)) {
      const end = source.indexOf(']]>', at + 9);
      if (end < 0 || stack.length === 1) fail('XML CDATA가 손상되었습니다.');
      stack.at(-1)!.children.push(source.slice(at + 9, end)); at = end + 3; continue;
    }
    if (source.startsWith('<?', at)) {
      const end = source.indexOf('?>', at + 2);
      if (end < 0 || source.slice(0, at).replace(/^\ufeff/, '').trim() || !/^<\?xml\s[^?]*\?>$/.test(source.slice(at, end + 2)))
        fail('지원하지 않는 XML 처리 명령입니다.');
      const encoding = source.slice(at, end).match(/\bencoding\s*=\s*['"]([^'"]+)['"]/i)?.[1];
      if (encoding && !/^utf-8$/i.test(encoding)) fail('UTF-8 XML 문서만 지원합니다.');
      at = end + 2; continue;
    }
    if (source.startsWith('<!', at)) fail('DTD·외부 엔터티 선언은 허용하지 않습니다.');
    let end = at + 1, quote = '';
    for (; end < source.length; end++) {
      const c = source[end];
      if (quote) { if (c === quote) quote = ''; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    if (end === source.length) fail('닫히지 않은 XML 태그입니다.');
    const token = source.slice(at, end + 1);
    const closing = new RegExp(`^</(${namePattern})\\s*>$`).exec(token);
    if (closing) {
      if (stack.length < 2 || stack.pop()!.name !== closing[1]) fail('XML 닫는 태그가 맞지 않습니다.');
    } else {
      const opening = new RegExp(`^<(${namePattern})([\\s\\S]*?)(/?)>$`).exec(token);
      if (!opening) fail('잘못된 XML 태그입니다.');
      const node: XmlNode = { name: opening[1], attrs: Object.create(null), children: [] };
      let rest = opening[2];
      const attr = new RegExp(`^\\s+(${namePattern})\\s*=\\s*(?:"([^"<]*)"|'([^'<]*)')`);
      while (rest.trim()) {
        const match = attr.exec(rest);
        if (!match || Object.hasOwn(node.attrs, match[1])) fail('잘못되었거나 중복된 XML 속성입니다.');
        node.attrs[match[1]] = xmlEntities(match[2] ?? match[3]); rest = rest.slice(match[0].length);
      }
      stack.at(-1)!.children.push(node);
      if (!opening[3]) stack.push(node);
    }
    at = end + 1;
  }
  const roots = elements(root);
  if (stack.length !== 1 || roots.length !== 1 || root.children.some((item) => typeof item === 'string' && item.replace(/^\ufeff/, '').trim()))
    fail('XML 문서 구조가 올바르지 않습니다.');
  return roots[0];
}

const MATH_SYMBOLS: Record<string, string> = {
  TIMES: '\\times', CDOT: '\\cdot', DIVIDE: '\\div', LEQ: '\\le', GEQ: '\\ge', NEQ: '\\ne',
  INF: '\\infty', IN: '\\in', NOTIN: '\\notin', SUBSET: '\\subset', SUBSETEQ: '\\subseteq',
  SUPSET: '\\supset', SUPSETEQ: '\\supseteq', SMALLINTER: '\\cap', CUP: '\\cup',
  EMPTYSET: '\\emptyset', APPROX: '\\approx', SIM: '\\sim', PROPTO: '\\propto',
  PARTIAL: '\\partial', NABLA: '\\nabla', SUM: '\\sum', PROD: '\\prod', INT: '\\int',
  DINT: '\\iint', TINT: '\\iiint', OINT: '\\oint', UNION: '\\bigcup', INTER: '\\bigcap',
  rarrow: '\\to', larrow: '\\leftarrow', lrarrow: '\\leftrightarrow',
  RARROW: '\\Rightarrow', LARROW: '\\Leftarrow', LRARROW: '\\Leftrightarrow',
  CDOTS: '\\cdots', LDOTS: '\\ldots', VDOTS: '\\vdots', DDOTS: '\\ddots',
  prime: '\\prime', DEG: '{}^{\\circ}', CENTIGRADE: '{}^{\\circ}\\mathrm{C}', ANGLE: '\\angle', BOT: '\\perp', BULLET: '\\bullet', AST: '\\ast', '*': '\\ast',
  TRIANGLE: '\\triangle',
  THEREFORE: '\\therefore', '＝': '=', '＋': '+', '－': '-', '–': '-',
  '·': '\\cdot', '˚': '{}^{\\circ}',
};
const LOWER_GREEK = 'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho sigma varsigma tau upsilon phi varphi chi psi omega'.split(' ');
const UPPER_GREEK = 'GAMMA DELTA THETA LAMBDA XI PI SIGMA UPSILON PHI PSI OMEGA'.split(' ');
const GREEK_SYMBOLS = new Set([...LOWER_GREEK, ...UPPER_GREEK]);
for (const name of LOWER_GREEK) MATH_SYMBOLS[name] = `\\${name}`;
for (const name of UPPER_GREEK) MATH_SYMBOLS[name] = `\\${name[0]}${name.slice(1).toLowerCase()}`;
const MATH_FUNCTIONS = new Set('sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh coth log ln exp max min lim det gcd mod arg dim ker'.split(' '));
const MATH_ACCENTS: Record<string, string> = { BAR: 'overline', VEC: 'vec', HAT: 'hat', DOT: 'dot', DDOT: 'ddot', TILDE: 'tilde', UNDER: 'underline' };
const MATH_FONTS: Record<string, string> = { rm: 'mathrm', it: 'mathit', bold: 'boldsymbol', rmbold: 'mathbf' };
// Common adjacent variable/unit letters. Only this explicit subset is split;
// unknown word-like native commands remain unconverted.
const MATH_LETTERS = new Set('xy mv mg mgh mgd mgH mgx hc mE kL gh hf kg cm vt kd ct gd at ma Fd kx km al mal vx Ft aL kF eV hv pv He MeV Me Li Ba Kr Hz PQ BC AC QS BS'.split(' '));
// Roman font declarations are lexical scope, not permission to accept an
// arbitrary native command as text. Accept bounded element sequences and a
// small vocabulary of units/state labels, preserving case and atom counts.
const CHEMICAL_ELEMENTS = new Set('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og A X Z D T'.split(' '));
const ROMAN_LABELS = new Set('mol mmol kmol atm Pa kPa MPa hPa mmHg mL dL kg mg cm mm nm km ms min MeV keV eV Hz kHz MHz kJ J W kW N m s g L K V A C cal kcal aq pH pOH ATP ADP AMP NAD NADP NADH NADPH FAD FADH DNA RNA'.split(' '));
const UNSUPPORTED_MATH_COMMANDS = new Set('BOX ROOT MATRIX PMATRIX BMATRIX DMATRIX CASES PILE LPILE RPILE EQALIGN ATOP CHOOSE COLOR PHANTOM'.split(' '));
const romanLiteral = (token: string) => {
  if (UNSUPPORTED_MATH_COMMANDS.has(token.toUpperCase())) return false;
  if (ROMAN_LABELS.has(token) || /^[A-Za-z]$/.test(token)) return true;
  const atoms = token.match(/[A-Z][a-z]?/g);
  return !!atoms && atoms.length <= 6 && atoms.join('') === token && atoms.every((item) => CHEMICAL_ELEMENTS.has(item));
};
const scriptBaseToken = (token: string) => token === '{' || token === 'LEFT'
  || /^[A-Za-z]$|^\d+(?:\.\d+)?$/.test(token) || MATH_LETTERS.has(token)
  || MATH_FUNCTIONS.has(token) || GREEK_SYMBOLS.has(token)
  || ['SUM', 'PROD', 'INT', 'DINT', 'TINT', 'OINT', 'UNION', 'INTER', ')', ']'].includes(token);

/** Explicit native-equation subset. Unknown commands preserve the source, never guess. */
export function hwpxEquationToLatex(script: string): string | undefined {
  if (!script.trim() || script.length > 20_000) return undefined;
  const tokens: string[] = [];
  const scan = /\s+|"[^"\r\n]*"|[A-Za-z]+|[0-9]+(?:\.[0-9]+)?|!=|\+-|-\+|<=|>=|[{}_^*()+\-=/.,:;!?<>|[\]`~]|[\u0080-\uffff]/gy;
  let at = 0;
  while (at < script.length) {
    scan.lastIndex = at;
    const match = scan.exec(script);
    if (!match) return undefined;
    at = scan.lastIndex;
    if (!/^\s+$/.test(match[0])) {
      const token = match[0];
      // Hancom permits adjacent font switches (rmNaCl, itaq), but an unknown
      // word such as rmMATRIX must not become harmless-looking roman letters.
      const fontWord = /^(rmbold|bold|rm|it)([A-Za-z]+)$/.exec(token);
      if (fontWord && romanLiteral(fontWord[2])) tokens.push(fontWord[1], fontWord[2]);
      else tokens.push(token);
    }
    if (tokens.length > 4000) return undefined;
  }
  let position = 0, depth = 0;
  const bad = () => { throw new Error('unsupported native equation'); };
  const expression = (stop?: string, inheritedFont = ''): string => {
    if (++depth > 64) return bad();
    const parts: string[] = [];
    let font = inheritedFont;
    let previousCompound = false, previousSpacing = false, previousScriptBase = false, previousRomanChemical = false;
    const scripts = new Set<string>();
    let leftBase = '', leftSub = '', leftSup = '';
    while (position < tokens.length && tokens[position] !== stop) {
      const token = tokens[position];
      if (token === '}' || token === 'RIGHT') return bad();
      if (/^over$/i.test(token)) return bad();
      if (token === 'LSUB' || token === 'LSUP') {
        if (!parts.length || !previousScriptBase || previousCompound || previousSpacing || scripts.size || (token === 'LSUB' ? leftSub : leftSup)) return bad();
        if (!leftBase) leftBase = parts.at(-1)!;
        if (leftBase === '{}') return bad(); // An empty native anchor is ambiguous.
        position++;
        if (tokens[position] !== '{') return bad();
        const value = atom(font);
        if (token === 'LSUB') leftSub = value; else leftSup = value;
        parts[parts.length - 1] = `{}${leftSub ? `_{${leftSub}}` : ''}${leftSup ? `^{${leftSup}}` : ''} ${leftBase}`;
        continue;
      }
      if (token === '^' || token === '_') {
        if (!previousScriptBase) {
          // Native scripts after a binary operator (or at the expression's
          // beginning) have no right-hand base. A complete numeric pair can
          // precede the next atom, as in Y + _{0}^{1} rm n. Never attach it to +.
          if (previousCompound || previousSpacing || scripts.size) return bad();
          const prefix: Record<string, string> = {};
          while (tokens[position] === '^' || tokens[position] === '_') {
            const mark = tokens[position++];
            if (prefix[mark] || tokens[position] !== '{') return bad();
            const begin = position;
            const value = atom('');
            const raw = tokens.slice(begin + 1, position - 1).join('');
            if (!/^[+\-−]?\d+$/.test(raw)) return bad();
            prefix[mark] = value;
          }
          if (!prefix._ || !prefix['^']) return bad();
          while (Object.hasOwn(MATH_FONTS, tokens[position] ?? '')) font = MATH_FONTS[tokens[position++]];
          const next = tokens[position];
          if (!next || !/^[A-Za-z]$/.test(next) && !(font === 'mathrm' && romanLiteral(next))) return bad();
          const base = atom(font);
          parts.push(`{}_{${prefix._}}^{${prefix['^']}} ${base}`);
          previousScriptBase = true; leftBase = ''; leftSub = ''; leftSup = '';
          continue;
        }
        if (!parts.length || scripts.has(token) || previousCompound || previousSpacing || leftBase) return bad();
        const next = tokens[position + 1], after = tokens[position + 2];
        const terminalCharge = token === '^' && previousRomanChemical && /^[+-]$/.test(next ?? '')
          && (!after || after === stop || /^[)\]+\-=]$/.test(after) || /^(?:rarrow|larrow|lrarrow)$/.test(after));
        if (!next || !terminalCharge && next !== '{' && !/^[A-Za-z]$|^\d+(?:\.\d+)?$/.test(next) && !Object.hasOwn(MATH_SYMBOLS, next)) return bad();
        // A lone built-in function in a script (e.g. E_{max}) makes KaTeX
        // emit three MathML children for msub, which cannot round-trip through
        // the document converters. Preserve native source instead of replacing
        // the function with a guessed ordinary-text label.
        if (next === '{' && MATH_FUNCTIONS.has(tokens[position + 2]) && tokens[position + 3] === '}') return bad();
        scripts.add(token);
        position++;
        parts[parts.length - 1] += `${token}{${atom(font)}}`; continue;
      }
      if (Object.hasOwn(MATH_FONTS, token)) {
        position++; font = MATH_FONTS[token];
        if (position === tokens.length || tokens[position] === stop) return bad();
        continue;
      }
      let value = atom(font);
      previousCompound = /^sqrt$/i.test(token) || Object.hasOwn(MATH_ACCENTS, token);
      previousSpacing = token === '`' || token === '~';
      previousScriptBase = scriptBaseToken(token) || !!font && romanLiteral(token);
      previousRomanChemical = font === 'mathrm' && romanLiteral(token);
      leftBase = ''; leftSub = ''; leftSup = '';
      scripts.clear();
      if (/^over$/i.test(tokens[position] ?? '')) {
        // Hancom's unbraced OVER scope is layout-dependent. Both operands
        // must be explicit groups; this also preserves chained equalities.
        if (token !== '{' || tokens[position + 1] !== '{') return bad();
        position++;
        value = `\\frac{${value}}{${atom(font)}}`;
        previousCompound = true;
      }
      parts.push(value);
    }
    depth--;
    const body = parts.join(' ');
    return body;
  };
  const fence = () => {
    const value = tokens[position++];
    const fences: Record<string, string> = { '(': '(', ')': ')', '[': '[', ']': ']', '{': '\\{', '}': '\\}', '|': '|', '.': '.', DLINE: '\\Vert', LCEIL: '\\lceil', RCEIL: '\\rceil', LFLOOR: '\\lfloor', RFLOOR: '\\rfloor', '<': '\\langle', '>': '\\rangle' };
    if (!Object.hasOwn(fences, value)) return bad();
    return fences[value];
  };
  const atom = (font = ''): string => {
    const token = tokens[position++];
    if (!token) return bad();
    if (token === '{') {
      const body = expression('}', font);
      if (tokens[position++] !== '}') return bad();
      return `{${body}}`;
    }
    if (/^sqrt$/i.test(token)) {
      if (tokens[position] !== '{') return bad();
      return `\\sqrt{${atom(font)}}`;
    }
    if (token === 'LEFT') {
      const left = fence(), body = expression('RIGHT', font);
      if (tokens[position++] !== 'RIGHT') return bad();
      return `\\left${left} ${body} \\right${fence()}`;
    }
    if (Object.hasOwn(MATH_ACCENTS, token)) {
      if (tokens[position] !== '{') return bad();
      return `\\${MATH_ACCENTS[token]}{${atom(font)}}`;
    }
    if (Object.hasOwn(MATH_SYMBOLS, token)) return MATH_SYMBOLS[token];
    if (MATH_FUNCTIONS.has(token)) return `\\${token}`;
    if (token.startsWith('"')) return `\\text{${token.slice(1, -1).replace(/([{}%$&#_])/g, '\\$1').replace(/\\(?![{}%$&#_])/g, '\\textbackslash{}')}}`;
    if (token === '`' || token === '~') return '\\,';
    if (token === '!=') return '\\ne';
    if (token === '+-') return '\\pm';
    if (token === '-+') return '\\mp';
    if (token === '<=') return '\\le';
    if (token === '>=') return '\\ge';
    if (/^[A-Za-z]$|^\d+(?:\.\d+)?$/.test(token)) return font ? `\\${font}{${token}}` : token;
    if ((font === 'mathrm' || font === 'mathbf' || font === 'mathit') && romanLiteral(token)) return `\\${font}{${token}}`;
    if (MATH_LETTERS.has(token)) return token.split('').map((letter) => font ? `\\${font}{${letter}}` : letter).join(' ');
    if (/^[()+\-=/.,:;!?<>|[\]]$/.test(token)) return token;
    if (/^[가-힣ㄱ-ㅎㅏ-ㅣ①-⑳㉠-㉿Ⅰ-Ⅻ]$/.test(token)) return `\\text{${token}}`;
    // Native identifiers with several letters, matrices, ROOT/OF, and layout
    // commands need a full Hancom grammar; keep their original script instead.
    return bad();
  };
  try { const result = expression(); return position === tokens.length && result ? result : undefined; }
  catch { return undefined; }
}

const joinText = (blocks: HwpxBlock[]) => blocks.map((block) => block.text).join('\n');
const joinPlain = (blocks: HwpxBlock[]) => blocks.map((block) => block.plainText).join('\n');
type CharStyle = { bold: boolean; underline: boolean };
const plainStyle: CharStyle = { bold: false, underline: false };
const numberAttr = (value: string | undefined, fallback: number) => value !== undefined && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : fallback;

/** Losslessly repack common opaque BI_RGB bitmaps without a canvas or service. */
async function bmpToPng(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  if (bytes.length < 54 || bytes[0] !== 66 || bytes[1] !== 77) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = view.getUint32(10, true), dib = view.getUint32(14, true);
  if (dib < 40 || 14 + dib > bytes.length || start < 14 + dib || view.getUint16(26, true) !== 1 || view.getUint32(30, true) !== 0) return undefined;
  const width = view.getInt32(18, true), signedHeight = view.getInt32(22, true), height = Math.abs(signedHeight), bits = view.getUint16(28, true);
  if (width <= 0 || !height || width > 16384 || height > 16384 || width * height > 8_000_000 || ![1, 4, 8, 24, 32].includes(bits)) return undefined;
  const stride = Math.ceil(width * bits / 32) * 4;
  if (start + stride * height > bytes.length) return undefined;
  const paletteCount = bits <= 8 ? view.getUint32(46, true) || 2 ** bits : 0;
  if (paletteCount > 256 || paletteCount && 14 + dib + paletteCount * 4 > start) return undefined;
  const scanlines = new Uint8Array((width * 3 + 1) * height);
  for (let row = 0; row < height; row++) {
    const sourceRow = start + (signedHeight > 0 ? height - 1 - row : row) * stride;
    const outputRow = row * (width * 3 + 1);
    scanlines[outputRow] = 1; // PNG Sub filter makes line drawings compact.
    let previousR = 0, previousG = 0, previousB = 0;
    for (let column = 0; column < width; column++) {
      let offset: number;
      if (paletteCount) {
        const value = bytes[sourceRow + Math.floor(column * bits / 8)];
        const index = bits === 8 ? value : bits === 4 ? (value >> (column % 2 ? 0 : 4)) & 15 : (value >> (7 - column % 8)) & 1;
        if (index >= paletteCount) return undefined;
        offset = 14 + dib + index * 4;
      } else offset = sourceRow + column * (bits / 8);
      const b = bytes[offset], g = bytes[offset + 1], r = bytes[offset + 2], target = outputRow + 1 + column * 3;
      scanlines[target] = r - previousR; scanlines[target + 1] = g - previousG; scanlines[target + 2] = b - previousB;
      previousR = r; previousG = g; previousB = b;
    }
  }
  const compressed = new Uint8Array(await new Response(new Blob([scanlines.buffer]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const chunk = (name: string, data: Uint8Array) => {
    const result = new Uint8Array(data.length + 12), chunkView = new DataView(result.buffer);
    chunkView.setUint32(0, data.length);
    result.set(new TextEncoder().encode(name), 4); result.set(data, 8);
    chunkView.setUint32(result.length - 4, crc32(result.subarray(4, result.length - 4)));
    return result;
  };
  const ihdr = new Uint8Array(13), header = new DataView(ihdr.buffer);
  header.setUint32(0, width); header.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 2;
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', new Uint8Array())];
  const result = new Uint8Array(chunks.reduce((size, part) => size + part.length, 0));
  let at = 0;
  for (const part of chunks) { result.set(part, at); at += part.length; }
  return result;
}

export async function parseHwpx(input: ArrayBuffer | Uint8Array | Blob): Promise<HwpxImportDocument> {
  if (input instanceof Blob && input.size > LIMIT.archive) fail('압축 파일은 64 MB 이하여야 합니다.');
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input instanceof Blob ? await input.arrayBuffer() : input);
  const zip = openZip(bytes), warnings = new Set<string>();
  if (!zip.has('mimetype') || decode(await zip.read('mimetype')).trim() !== 'application/hwp+zip')
    fail('HWPX 형식이 아닙니다. .hwp 파일은 한글에서 .hwpx로 저장해 주세요.');
  if (zip.names.some((name) => /(?:^|\/)(?:encryption|encrypted).*\.xml$/i.test(name))) fail('암호화된 문서는 지원하지 않습니다.');
  const xml = async (path: string) => {
    const data = await zip.read(path);
    if (data.length > LIMIT.xml) fail('XML 본문이 너무 큽니다.');
    return parseXml(decode(data));
  };
  const manifest = await xml('Contents/content.hpf');
  if (localName(manifest.name) !== 'package') fail('HWPX 문서 목록이 올바르지 않습니다.');
  const items = new Map<string, { path?: string; mime: string }>();
  for (const item of descendants(manifest, 'item')) {
    const id = item.attrs.id, href = item.attrs.href;
    if (!id || items.has(id)) fail('HWPX 문서 목록의 식별자가 중복되거나 없습니다.');
    const path = href && safePath(href) ? [href, `Contents/${href}`].find((candidate) => zip.has(candidate)) : undefined;
    items.set(id, { path, mime: item.attrs['media-type'] ?? '' });
  }
  const allSections = zip.names.filter((name) => /^Contents\/section\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+(?=\.xml$)/)![0]) - Number(b.match(/\d+(?=\.xml$)/)![0]));
  const sectionPaths: string[] = [];
  for (const ref of descendants(manifest, 'itemref')) {
    const path = items.get(ref.attrs.idref)?.path;
    if (path && allSections.includes(path) && !sectionPaths.includes(path)) sectionPaths.push(path);
  }
  for (const path of allSections) if (!sectionPaths.includes(path)) sectionPaths.push(path);
  if (!sectionPaths.length || sectionPaths.length > 256) fail('본문 구역이 없거나 너무 많습니다.');
  const styles = new Map<string, CharStyle>();
  const borders = new Map<string, NonNullable<HwpxTableCell['borders']>>();
  const numbering = new Map<string, NonNullable<HwpxParagraph['numbering']>>();
  if (zip.has('Contents/header.xml')) {
    const header = await xml('Contents/header.xml');
    for (const fill of descendants(header, 'borderFill')) {
      const sides = ['left', 'right', 'top', 'bottom'] as const;
      const values = sides.map((side) => child(fill, `${side}Border`));
      if (values.every((value) => value?.attrs.type)) {
        borders.set(fill.attrs.id, Object.fromEntries(sides.map((side, index) =>
          [side, !['NONE', '0'].includes(values[index]!.attrs.type)])) as NonNullable<HwpxTableCell['borders']>);
      }
    }
    for (const style of descendants(header, 'charPr')) {
      const underline = child(style, 'underline');
      styles.set(style.attrs.id, { bold: Boolean(child(style, 'bold')), underline: Boolean(underline && !['NONE', '0'].includes(underline.attrs.type ?? 'NONE')) });
    }
    for (const style of descendants(header, 'paraPr')) {
      const heading = child(style, 'heading');
      if (heading && ['NUMBER', 'OUTLINE', 'BULLET'].includes(heading.attrs.type))
        numbering.set(style.attrs.id, { type: heading.attrs.type, idRef: heading.attrs.idRef, level: numberAttr(heading.attrs.level, 0) });
    }
  } else warnings.add('글자 스타일 정보가 없어 굵게·밑줄 서식을 복원하지 못했습니다.');
  const images: HwpxImage[] = [], imageIds = new Set<string>();
  // Only raster image signatures are accepted. SVG, external links, WMF/EMF,
  // scripts and attachments are never executed or fetched.
  for (const [id, item] of items) {
    if (!item.mime.startsWith('image/')) continue;
    if (!item.path) { warnings.add('외부 링크 또는 누락된 그림은 가져오지 않았습니다.'); continue; }
    let data = await zip.read(item.path);
    const bitmap = data[0] === 66 && data[1] === 77;
    if (bitmap) {
      const png = await bmpToPng(data);
      if (png) data = png;
    }
    const signature = (prefix: number[]) => prefix.every((byte, index) => data[index] === byte);
    const mimeType = signature([137, 80, 78, 71, 13, 10, 26, 10]) ? 'image/png'
      : signature([255, 216, 255]) ? 'image/jpeg'
      : signature([71, 73, 70, 56]) && [55, 57].includes(data[4]) && data[5] === 97 ? 'image/gif'
      : signature([82, 73, 70, 70]) && [87, 69, 66, 80].every((byte, i) => data[i + 8] === byte) ? 'image/webp' : undefined;
    if (!mimeType) { warnings.add('지원하지 않는 그림 형식이 있습니다. 원문 그림을 확인해 주세요.'); zip.release(item.path); continue; }
    let binary = '';
    for (let offset = 0; offset < data.length; offset += 8192) binary += String.fromCharCode(...data.subarray(offset, offset + 8192));
    images.push({ id, path: item.path, mimeType, dataUrl: `data:${mimeType};base64,${btoa(binary)}` }); imageIds.add(id);
    zip.release(item.path);
  }
  const notes: HwpxImportDocument['notes'] = [];
  let sectionPath = '';
  const saveNote = (node: XmlNode, nesting: number, anchorParagraphId?: string) => {
    const blocks = parseBlocks(node, nesting + 1), counter = descendants(node, 'autoNum')[0]?.attrs.num;
    notes.push({ kind: localName(node.name) === 'footNote' ? 'footnote' : 'endnote', sectionPath, anchorParagraphId,
      number: counter && /^\d+$/.test(counter) ? Number(counter) : undefined,
      blocks, text: joinText(blocks), plainText: joinPlain(blocks) });
    warnings.add('각주·미주는 본문 문항에서 분리해 보존했습니다. 정답·해설이 있는지 확인해 주세요.');
  };
  const parseBlocks = (node: XmlNode, nesting = 0): HwpxBlock[] => {
    if (nesting > 16) fail('표 또는 문단 중첩이 너무 깊습니다.');
    const result: HwpxBlock[] = [];
    for (const item of elements(node)) {
      const name = localName(item.name);
      if (name === 'p') result.push(...paragraph(item, nesting));
      else if (name === 'tbl') result.push(table(item, nesting + 1));
      else if (['footNote', 'endNote'].includes(name)) saveNote(item, nesting);
      else if (['header', 'footer', 'masterPage'].includes(name))
        warnings.add('머리말·꼬리말 내용은 본문 문항에서 제외했습니다. 원문과 대조해 주세요.');
      else result.push(...parseBlocks(item, nesting));
    }
    return result;
  };
  const paragraph = (node: XmlNode, nesting: number): HwpxBlock[] => {
    const result: HwpxBlock[] = [];
    let runs: HwpxInline[] = [];
    const paragraphNumbering = numbering.get(node.attrs.paraPrIDRef);
    if (paragraphNumbering && paragraphNumbering.type !== 'BULLET')
      warnings.add('문단 스타일의 자동 번호는 번호 정보만 보존했습니다. 본문에 없는 문항 번호는 직접 확인해 주세요.');
    const flush = () => {
      if (!runs.length) return;
      let trailingBackslashes = 0;
      const values = runs.map((run) => {
        // Preserve literal source backslashes without letting a trailing one
        // escape the generated native-equation opener and shift every $ pair.
        const boundary = trailingBackslashes % 2 ? ' ' : '';
        const value = run.kind === 'text' ? run
          // Native source line breaks are whitespace, not prose/table bounds.
          // Exact raw scripts stay in runs; visible fallbacks stay one marker.
          : run.kind === 'equation' ? { text: run.latex ? `${boundary}$${run.latex}$` : `[한글 수식: ${run.script.replace(/\r\n?|\n/g, ' ')}]`, bold: run.bold, underline: run.underline }
          : { text: `[삽입 그림: ${run.imageId || '식별자 없음'}]`, ...plainStyle };
        if (value.text) {
          const tail = /\\+$/.exec(value.text)?.[0].length ?? 0;
          trailingBackslashes = tail === value.text.length ? trailingBackslashes + tail : tail;
        }
        return value;
      });
      result.push({ kind: 'paragraph', text: formatRuns(values), plainText: values.map((run) => run.text).join(''), runs,
        paragraphId: node.attrs.id, pageBreak: node.attrs.pageBreak === '1', numbering: paragraphNumbering });
      runs = [];
    };
    const visit = (item: XmlNode, style: CharStyle, styleId?: string) => {
      const name = localName(item.name);
      if (name === 'run') {
        const id = item.attrs.charPrIDRef;
        for (const next of elements(item)) visit(next, styles.get(id) ?? plainStyle, id);
      } else if (name === 't') {
        for (const next of item.children) {
          if (typeof next === 'string') runs.push({ kind: 'text', text: next, ...style, charPrIDRef: styleId });
          else visit(next, style, styleId);
        }
      } else if (name === 'lineBreak' || name === 'tab' || name === 'fwSpace' || name === 'nbSpace')
        runs.push({ kind: 'text', text: name === 'lineBreak' ? '\n' : name === 'tab' ? '\t' : name === 'fwSpace' ? '\u3000' : '\u00a0', ...style, charPrIDRef: styleId });
      else if (name === 'equation') {
        const script = content(child(item, 'script') ?? { name: '', attrs: {}, children: [] }), latex = hwpxEquationToLatex(script);
        runs.push({ kind: 'equation', script, latex, ...style });
        if (!latex) warnings.add('일부 한글 수식은 자동 변환하지 않고 [한글 수식: 원문]으로 보존했습니다. 수식을 확인해 주세요.');
      } else if (name === 'tbl') { flush(); result.push(table(item, nesting + 1)); }
      else if (name === 'pic') {
        const image = descendants(item, 'img')[0], id = image?.attrs.binaryItemIDRef ?? '';
        const alt = item.attrs.description ?? content(child(item, 'shapeComment') ?? { name: '', attrs: {}, children: [] });
        runs.push({ kind: 'image', imageId: id, alt });
        if (!imageIds.has(id)) warnings.add('일부 삽입 그림을 읽지 못했습니다. 원문과 대조해 주세요.');
        else warnings.add('삽입 그림은 개별 이미지로 보존했습니다. 배치·자르기·회전은 원문과 다를 수 있습니다.');
      } else if (name === 'autoNum') {
        // A body marker explicitly supplies a number. Do not infer numbering
        // from paragraph styles or treat page/table/equation counters as questions.
        if (['PARA', 'PARAGRAPH'].includes(item.attrs.numType) && /^\d{1,3}$/.test(item.attrs.num ?? '')) {
          const format = child(item, 'autoNumFormat');
          runs.push({ kind: 'text', text: `${format?.attrs.prefixChar ?? ''}${item.attrs.num}${format?.attrs.suffixChar || '.'} `, ...style, charPrIDRef: styleId });
        }
      } else if (['footNote', 'endNote'].includes(name)) saveNote(item, nesting, node.attrs.id);
      else if (['header', 'footer', 'masterPage'].includes(name))
        warnings.add('머리말·꼬리말 내용은 본문 문항에서 제외했습니다. 원문과 대조해 주세요.');
      else if (['rect', 'ellipse', 'arc', 'polygon', 'curve', 'connectLine', 'container', 'ole', 'chart'].includes(name)) {
        warnings.add('그리기 개체·차트의 모양은 복원하지 못했습니다. 개체 내부 텍스트와 원문을 확인해 주세요.');
        const nested = parseBlocks(item, nesting + 1);
        if (nested.length) { flush(); result.push(...nested); }
      } else if (name === 'p') { flush(); result.push(...paragraph(item, nesting + 1)); }
      else if (!['secPr', 'colPr', 'linesegarray', 'script'].includes(name))
        for (const next of elements(item)) visit(next, style, styleId);
    };
    for (const item of elements(node)) visit(item, plainStyle);
    flush();
    return result;
  };
  const table = (node: XmlNode, nesting: number): HwpxBlock => {
    if (nesting > 16) fail('표 중첩이 너무 깊습니다.');
    const rowNodes = elements(node).filter((item) => localName(item.name) === 'tr');
    const rows = numberAttr(node.attrs.rowCnt, rowNodes.length), columns = numberAttr(node.attrs.colCnt, Math.max(0, ...rowNodes.map((row) => elements(row).filter((item) => localName(item.name) === 'tc').length)));
    if (!rows || !columns || rows * columns > LIMIT.cells || rowNodes.length > LIMIT.cells) fail('표 크기가 허용 범위를 넘습니다.');
    const cells: HwpxTableCell[] = [], occupied = new Set<string>();
    for (const [r, rowNode] of rowNodes.entries()) {
      let nextColumn = 0;
      for (const cell of elements(rowNode).filter((item) => localName(item.name) === 'tc')) {
        while (occupied.has(`${r}:${nextColumn}`)) nextColumn++;
        const address = child(cell, 'cellAddr'), span = child(cell, 'cellSpan');
        const row = numberAttr(address?.attrs.rowAddr, r), column = numberAttr(address?.attrs.colAddr, nextColumn);
        const rowSpan = numberAttr(span?.attrs.rowSpan, 1), colSpan = numberAttr(span?.attrs.colSpan, 1);
        if (!rowSpan || !colSpan || row + rowSpan > rows || column + colSpan > columns) fail('표 병합 셀 범위가 올바르지 않습니다.');
        for (let y = row; y < row + rowSpan; y++) for (let x = column; x < column + colSpan; x++) {
          const key = `${y}:${x}`;
          if (occupied.has(key)) fail('표 셀 범위가 겹칩니다.');
          occupied.add(key);
        }
        const blocks = parseBlocks(cell, nesting);
        const borderFillIDRef = cell.attrs.borderFillIDRef ?? node.attrs.borderFillIDRef;
        cells.push({ row, column, rowSpan, colSpan, blocks, text: joinText(blocks), plainText: joinPlain(blocks),
          borderFillIDRef, borders: borderFillIDRef ? borders.get(borderFillIDRef) : undefined });
        nextColumn = column + colSpan;
      }
    }
    const merged = cells.some((cell) => cell.rowSpan > 1 || cell.colSpan > 1);
    const nested = cells.some((cell) => cell.blocks.some((block) => block.kind === 'table'));
    const viewBox = hwpxViewBox(cells);
    if (merged && !viewBox) warnings.add('병합 셀 정보는 보존했지만 편집 본문의 표에서는 병합 모양을 재현하지 못합니다. 원문과 대조해 주세요.');
    if (viewBox) warnings.add('보기 표의 투명 배치 셀을 하나의 보기 상자로 정리했습니다. 원본 셀·문자·수식 정보는 보존했습니다.');
    if (nested || rows > 80 || columns > 16) warnings.add('중첩 표 또는 큰 표는 셀별 텍스트로 표시했습니다. 원문과 대조해 주세요.');
    const grid = Array.from({ length: rows }, () => Array.from({ length: columns }, () => ''));
    for (const cell of cells) grid[cell.row][cell.column] = cell.text;
    const text = viewBox ? `:::box ${viewBox.title}\n${viewBox.text}\n:::` : nested || rows > 80 || columns > 16
      ? cells.map((cell) => `[표 ${cell.row + 1}행 ${cell.column + 1}열]\n${cell.text}`).join('\n')
      : `:::table\n${grid.map((row) => `| ${row.map((value) => value.replace(/\r\n?/g, '\n').replace(/\n/g, '<br>').replace(/\|/g, '\\|')).join(' | ')} |`).join('\n')}\n:::`;
    const plainGrid = Array.from({ length: rows }, () => Array.from({ length: columns }, () => ''));
    for (const cell of cells) plainGrid[cell.row][cell.column] = cell.plainText;
    return { kind: 'table', rows, columns, cells, text, plainText: plainGrid.map((row) => row.join('\t')).join('\n'),
      ...(viewBox ? { presentation: { kind: 'box' as const, title: viewBox.title, reason: 'layout-view' as const } } : {}) };
  };
  const sections: HwpxImportDocument['sections'] = [];
  for (const [index, path] of sectionPaths.entries()) {
    sectionPath = path;
    const source = await xml(path);
    if (localName(source.name) !== 'sec') fail('본문 구역 XML 형식이 올바르지 않습니다.');
    const blocks = parseBlocks(source);
    sections.push({ index: index + 1, path, blocks, text: joinText(blocks) });
  }
  const blocks = sections.flatMap((section) => section.blocks);
  if (!joinPlain(blocks).trim()) fail('가져올 수 있는 본문 텍스트가 없습니다.');
  warnings.add('HWPX는 원문 페이지 캡처·쪽수·정확한 배치를 복원하지 않습니다. 한글 원문과 대조해 주세요.');
  return { format: 'hwpx', blocks, sections, text: joinText(blocks), plainText: joinPlain(blocks), images, notes,
    warnings: [...warnings], hasOriginalPageCaptures: false };
}
