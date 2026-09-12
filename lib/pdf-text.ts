import type { PageText } from './pdf-layout';
import type { Rule } from './pdf-structures';
import { reconstructMathRuns } from './pdf-math-layout';
import { inferPdfMathUnderlines, inferPdfTextStyles } from './pdf-source-formatting';

type TextItem = {
  str: string;
  fontName: string;
  transform: number[];
  width: number;
};
type Font = { name?: string; data?: Uint8Array };
type Operators = { fnArray: number[]; argsArray: unknown[][] };
type Glyph = { unicode: string; fontChar: string };

// These are semantic values, NOT PDF.js's remapped fontChar codes. Each entry
// is additionally gated by the embedded glyph outline (see below); font names
// alone are not sufficient because private-use mappings vary by font version.
const equationCharacters: Record<number, string> = {
  0xe000: 'A', 0xe001: 'B', 0xe012: 'S', 0xe04b: '{', 0xe04c: '}',
  0xe04d: '|', 0xe052: ',', 0xe055: '<', 0xe067: 'Σ',
  0xe078: '⎧', 0xe079: '⎨', 0xe07a: '⎩', 0xe07b: '⎪',
  0xe09d: 'α', 0xe0a4: 'θ', 0xe0ac: 'π', 0xe0ea: 'f', 0xe101: '|',
  0xe002: 'C',
  0xe003: 'D',
  0xe004: 'E',
  0xe005: 'F',
  0xe007: 'H',
  0xe008: 'I',
  0xe00a: 'K',
  0xe00b: 'L',
  0xe00c: 'M',
  0xe00d: 'N',
  0xe00f: 'P',
  0xe010: 'Q',
  0xe013: 'T',
  0xe015: 'V',
  0xe016: 'W',
  0xe034: '1',
  0xe035: '2',
  0xe036: '3',
  0xe037: '4',
  0xe038: '5',
  0xe039: '6',
  0xe03a: '7',
  0xe03b: '8',
  0xe03c: '9',
  0xe03d: '0',
  0xe042: '%',
  0xe044: '(',
  0xe045: ')',
  0xe046: '−',
  0xe047: '=',
  0xe048: '+',
  0xe049: '[',
  0xe04a: ']',
  0xe04f: ':',
  0xe053: '.',
  0xe054: '/',
  0xe056: '>',
  0xe05c: '√',
  0xe06d: '─', // structural fraction/radical rule, never a minus sign
  0xe06e: '→', // vector accent: geometry must attach it to its source base
  0xe088: 'Δ',
  0xe099: 'Φ',
  0xe09e: 'β',
  0xe09f: 'γ',
  0xe0a0: 'δ',
  0xe0a7: 'λ',
  0xe0a8: 'μ',
  0xe0ad: 'ρ',
  0xe10e: 'ε',
  0xe0e5: 'a',
  0xe0e6: 'b',
  0xe0e7: 'c',
  0xe0e8: 'd',
  0xe0eb: 'g',
  0xe0ec: 'h',
  0xe0ed: 'i',
  0xe0ef: 'k',
  0xe0f0: 'l',
  0xe0f1: 'm',
  0xe0f2: 'n',
  0xe0f4: 'p',
  0xe0f5: 'q',
  0xe0f7: 's',
  0xe0f8: 't',
  0xe0fa: 'v',
  0xe0fb: 'w',
  0xe0fc: 'x',
  0xe0fd: 'y',
};

// Only fingerprints are distributed, never the copyrighted embedded font.
// Generated from the supplied PDF and visually checked against its glyphs.
const verifiedOutlines: Record<string, string> = {
  // Additional outlines visually checked in the supplied 2026 math/Korean PDFs.
  '220:73785a1f:a94d1faf':'A', '378:73792c2c:83222c0':'B',
  '426:a6e70dc:419b064a':'S', '136:34306c36:c05db9cc':'{',
  '138:512054d3:d4f3eaa3':'}', '32:5fec15ba:77427be8':'|',
  '154:fe7d052d:fdc1fea9':',', '110:adb6aaa2:215e0110':'<',
  '144:7a325ba3:f19732d9':'Σ', '78:fd421b43:220c7d95':'⎧',
  '132:8f158381:51b09431':'⎨', '78:9a1a2c94:60de1206':'⎩',
  '32:917c28e4:76e4613a':'⎪', '374:e892a092:14211932':'α',
  '204:510e6a71:a326d73f':'θ', '242:fb35844:fb6d7b32':'π',
  '312:27313dee:d2991da4':'f', '32:f631fa37:79e53b63':'|',
  '496:bc05111:b75fc567':'ᄒᆡ', '668:47cabd9:799a0671':'ᄅᆞᆯ',
  '204:2190d32e:c80f4134':'ᄂᆞ', '402:185b67a1:15912f3':'ᄆᆞᆫ',
  '34:92f9a4f6:697a4d7a':'−',
  // Filled down arrow, visually checked in the English summary question.
  '40:758002b2:ef3efa66':'⬇',
  // 2021 science sample outlines, inspected as glyph images. No font is bundled.
  '280:98248289:90ccde63': 'C',
  '278:97201fc:9165c32c': 'F',
  '244:b96342f6:77067050': 'N',
  '210:8977c779:24724423': 'T',
  '208:95f306bd:1488438d': 'V',
  '332:ace900eb:16c56327': 'W',
  '508:cfa726fa:c41cc34c': '2',
  '436:c4011d9d:cf924c39': '0',
  '880:d732edbe:ddf6e2fe': '%',
  '110:89b086dd:9b37beb5': '>',
  '62:f62b459:99fc4b95': '√',
  '34:4be8b961:b80e6aa9': '─',
  '302:f4d233a2:53b3e7e0': 'a',
  '320:85a7c807:2a651103': 'b',
  '230:5c2eb981:fdbc65d5': 'c',
  '336:266d1745:ec480b0b': 'g',
  '338:a98c4df1:b554c1db': 'i',
  '410:7f6a9f0:fe659540': 'k',
  '162:b613f735:67e30bbd': 'l',
  '120:7e7ae5db:a11c7611': 'l',
  '396:aab9cb36:e994c59a': 'n',
  '372:beb0f8cc:4f4e57d4': 'p',
  '392:52b9b8b0:4720817e': 'p',
  '308:8721e010:68f15606': 'q',
  '338:c1910d38:8fc0d924': 's',
  '442:b582f127:e24eaa43': 'w',
  '446:a24af275:545a2171': 'x',
  '348:cba7f1c6:dacc503a': 'y',
  '342:56e1de49:2cdc0101': '6',
  '244:8527b053:27a4aa33': '0',
  '74:d5e2ba68:8305bc74': '/',
  '140:7cfdbafa:80968350': '1',
  '214:4fbd2d57:449d5e5b': 'L',
  '392:4f670e9a:a9aecca8': '5',
  '70:462db4d5:d6f86f25': '.',
  '160:ac32513d:5675248b': '7',
  '250:25363e0b:6a247bcb': '2',
  '426:8ff27c67:b36657ad': '8',
  '156:ebad924e:57cb454': '4',
  '292:3d18a6cf:8f75f36f': 'μ',
  '418:385b7be0:f76a9fd6': '3',
  '154:722be970:a570ae40': '+',
  '138:d7c6735f:9035f3cf': '(',
  '142:e2a3f437:22bc0faf': ')',
  '70:27dab61:3ba3fe2f': '−',
  '292:f59e6245:6de39f23': 'E',
  '322:35a9615d:ac7c8b11': '9',
  '528:cd383352:ec9a2a8c': '%',
  '122:3ed761b5:95d4fb83': '=',
  '376:864d63ec:893d2da4': 'h',
  '232:999358b9:17b44ff9': 't',
  '124:2882d474:bc34b636': ':',
  '510:619ae292:2a421c3c': 'm',
  '336:5844f015:e9dffa2b': 'v',
  '322:e483d96c:83631500': 'd',
  // Eight science-exam glyph sheets were rendered from their embedded fonts
  // and visually checked. Each semantic code still requires this exact outline;
  // the same PUA in an unknown font/version remains unresolved.
  '268:7153a6b8:e73725f0': 'D',
  '386:59265a18:38c60f06': 'H',
  '194:9dd03ed1:1c40f239': 'I',
  '372:aee0b616:3c566050': 'K',
  '320:4e1fad7d:a629c1cf': 'M',
  '300:d0297d58:c85afc52': 'P',
  '472:8dca3b8c:64972b5a': 'Q',
  '52:e699f21e:71de6b8e': '[',
  '50:55acdae3:ba577353': ']',
  '150:cafef31:ac4184cb': '→',
  '94:428858e7:be30fc67': 'Δ',
  '438:13d546b5:70287bcf': 'Φ',
  '430:e2ac64e5:b07828eb': 'β',
  '288:f35ddafd:f38cffc3': 'γ',
  '338:a4ee5ce1:7748f601': 'δ',
  '168:71d1d16a:2acaa4c': 'λ',
  '234:7880c6ed:ab830c3f': 'ρ',
  '236:127681cc:9abbef34': 'ε',
};

// Source font roles were checked as rendered glyph sheets for the eight science
// PDFs. ASCII and private-use letters in the same EQ font are not interchangeable:
// the former are upright atoms/units, while lowercase PUA variables are italic.
// Uppercase PUA outlines are upright and may be slanted by their PDF text matrix.
// An unrecognized outline gets no font-role correction, even in a known font.
const verifiedRomanOutlines: Record<string, string> = {
  '128:48267647:5f7b0ed': 'A', '220:6b1d7578:19e97e30': 'B',
  '136:afb9b30b:16b25e35': 'C', '156:812e9832:7f0d948c': 'D',
  '194:288d0390:85bad866': 'H', '118:8b544954:a4da7aa6': 'L',
  '190:d30c66de:da7d2fee': 'M', '132:2c018e68:1a722932': 'O',
  '168:59dd22cd:aa440249': 'P', '270:60dd86fd:16af6287': 'Q',
  '194:c181a2b5:1ec2bc45': 'R', '110:d4d2ecad:70a4dfdf': 'V',
  '186:1af9acba:1716a2fa': 'X', '152:f780f3f5:f0733d0b': 'Y',
  '248:5f3b599f:4c4b7af3': 'a', '178:6cf16ed6:61f62c46': 'b',
  '150:8f7fe8d6:46972252': 'c', '160:523b8d47:4e82949b': 'e',
  '392:6af66612:dceedb0c': 'g', '170:e1651a48:8a8176d2': 'k',
  '270:e105d94f:9cb85563': 'm', '208:24f7fe25:8310ecf': 'p',
  '190:11c716ce:b1715562': 'q', '216:6ffc20e2:754f8d90': 's',
  '164:b59048e1:79422cd1': 'F', '152:b7e19484:893cb37c': 'N',
  '224:e9de156e:250bc962': 'S', '164:54c7748a:e05d0306': 'W',
  '90:362d5955:f9099f9f': 'Z', '86:4fa4aa2a:199941d4': 'l',
  '180:bc21e2e5:60c146a3': 'n', '130:8563c388:c2c6a02e': 'o',
  '162:afd3d35e:60d7ef74': 'w', '184:4e0dbaf0:a9e58372': 'E',
  '188:c69c09c:38f746be': 'G', '190:78d614c2:941a0bc6': 'K',
  '142:6dabc9d:b7c77939': 'i', '144:40ee5dba:51bc234e': 'u',
  '180:97b71154:44422018': 'x', '140:a9f9c3e3:ba4a9579': 'J',
  '162:221b9923:e6e6d5ef': 'r', '118:f913e52c:347e29a0': 't',
  '180:4948b8da:c0003ba6': 'h',
};
const verifiedItalicOutlines = new Set([
  '302:f4d233a2:53b3e7e0', '230:5c2eb981:fdbc65d5',
  '322:e483d96c:83631500', '312:27313dee:d2991da4',
  '336:266d1745:ec480b0b', '376:864d63ec:893d2da4',
  '410:7f6a9f0:fe659540', '510:619ae292:2a421c3c',
  '396:aab9cb36:e994c59a', '232:999358b9:17b44ff9',
  '336:5844f015:e9dffa2b', '446:a24af275:545a2171',
  '348:cba7f1c6:dacc503a', '320:85a7c807:2a651103',
  '162:b613f735:67e30bbd', '392:52b9b8b0:4720817e',
  '308:8721e010:68f15606', '338:c1910d38:8fc0d924',
  '442:b582f127:e24eaa43',
  '430:e2ac64e5:b07828eb', // source italic beta, including an isolated biology label
]);
const verifiedMatrixOutlines = new Set([
  '378:73792c2c:83222c0', '292:f59e6245:6de39f23',
  '194:9dd03ed1:1c40f239', '214:4fbd2d57:449d5e5b',
  '372:aee0b616:3c566050', '208:95f306bd:1488438d',
  '320:4e1fad7d:a629c1cf', '210:8977c779:24724423',
  '268:7153a6b8:e73725f0', '278:97201fc:9165c32c',
  '472:8dca3b8c:64972b5a', '386:59265a18:38c60f06',
  '300:d0297d58:c85afc52',
]);
type SourceFontRole = 'roman' | 'italic' | 'matrix' | '';

export function countUnresolvedGlyphs(text: string) {
  return (
    Array.from(text).filter((char) => {
      const code = char.codePointAt(0)!;
      return (
        (code >= 0xe000 && code <= 0xf8ff) ||
        (code >= 0xf0000 && code <= 0xffffd) ||
        (code >= 0x100000 && code <= 0x10fffd) ||
        code === 0xfffd ||
        code === 0xffff
      );
    }).length +
    [...text.matchAll(/[▤▥▦▧▨▩▒▓]{2,}/gu)].reduce(
      (n, match) => n + match[0].length,
      0,
    )
  );
}

export function glyphWarning(text: string) {
  const count = countUnresolvedGlyphs(text);
  return count
    ? `숫자·수식 등 ${count}개 문자를 복원하지 못했습니다. 원문 캡처와 비교해 수정하거나 이미지 판독을 다시 실행해 주세요. 이전 버전의 추출문이면 원본 PDF를 다시 넣어 주세요. 성취기준 일치율은 문자 인식 정확도가 아닙니다.`
    : '';
}

// Inspect a bounded TrueType glyph through PDF.js's sanitized Unicode cmap.
// Unsupported CFF/composite/cmap formats deliberately remain unresolved.
export function glyphOutlineFingerprint(
  data: Uint8Array,
  charCode: number,
): string | undefined {
  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const tables = new Map<string, { offset: number; length: number }>();
    const u16 = (offset: number) => view.getUint16(offset);
    const u32 = (offset: number) => view.getUint32(offset);
    for (let i = 0; i < u16(4); i++) {
      const offset = 12 + i * 16;
      const tag = String.fromCharCode(...data.subarray(offset, offset + 4));
      const start = u32(offset + 8),
        length = u32(offset + 12);
      if (start + length > data.length) return;
      tables.set(tag, { offset: start, length });
    }
    const cmap = tables.get('cmap'),
      head = tables.get('head'),
      loca = tables.get('loca'),
      glyf = tables.get('glyf');
    if (!cmap || !head || !loca || !glyf || charCode > 0xffff) return;
    let glyphId: number | undefined;
    for (let t = 0; t < u16(cmap.offset + 2) && glyphId === undefined; t++) {
      const entry = cmap.offset + 4 + 8 * t,
        platform = u16(entry),
        encoding = u16(entry + 2);
      if (platform !== 0 && !(platform === 3 && encoding === 1)) continue;
      const sub = cmap.offset + u32(entry + 4);
      if (u16(sub) !== 4) continue;
      const segments = u16(sub + 6) / 2;
      const ends = sub + 14,
        starts = ends + 2 * segments + 2,
        deltas = starts + 2 * segments,
        ranges = deltas + 2 * segments;
      for (let i = 0; i < segments; i++) {
        const start = u16(starts + 2 * i),
          end = u16(ends + 2 * i);
        if (charCode < start || charCode > end) continue;
        const range = u16(ranges + 2 * i),
          delta = u16(deltas + 2 * i);
        const raw = range
          ? u16(ranges + 2 * i + range + 2 * (charCode - start))
          : charCode;
        glyphId = range && raw === 0 ? 0 : (raw + delta) & 0xffff;
        break;
      }
    }
    if (!glyphId) return;
    const longOffsets = u16(head.offset + 50) === 1,
      stride = longOffsets ? 4 : 2;
    if ((glyphId + 2) * stride > loca.length) return;
    const start = longOffsets
      ? u32(loca.offset + glyphId * stride)
      : 2 * u16(loca.offset + glyphId * stride);
    const end = longOffsets
      ? u32(loca.offset + (glyphId + 1) * stride)
      : 2 * u16(loca.offset + (glyphId + 1) * stride);
    if (
      end <= start ||
      end > glyf.length ||
      view.getInt16(glyf.offset + start) < 0
    )
      return;
    let a = 2166136261,
      b = 5381;
    for (const byte of data.subarray(glyf.offset + start, glyf.offset + end)) {
      a = Math.imul(a ^ byte, 16777619) >>> 0;
      b = (Math.imul(b, 33) ^ byte) >>> 0;
    }
    return `${end - start}:${a.toString(16)}:${b.toString(16)}`;
  } catch {
    return undefined;
  }
}

function fontDecoders(
  operators: Operators,
  ops: Record<string, number>,
  getFont: (id: string) => Font | undefined,
) {
  const fonts = new Map<string, Map<string, string>>(),
    styles = new Map<string, Map<string, SourceFontRole>>(),
    stack: string[] = [];
  const fingerprints = new Map<Font, Map<number, string | undefined>>();
  let current = '';
  for (let i = 0; i < operators.fnArray.length; i++) {
    const fn = operators.fnArray[i],
      args = operators.argsArray[i];
    if (fn === ops.save) stack.push(current);
    else if (fn === ops.restore) current = stack.pop() ?? '';
    else if (fn === ops.setFont) current = String(args[0]);
    if (
      fn !== ops.showText &&
      fn !== ops.showSpacedText &&
      fn !== ops.nextLineShowText &&
      fn !== ops.nextLineSetSpacingShowText
    )
      continue;
    let font: Font | undefined;
    try {
      font = getFont(current);
    } catch {
      continue;
    }
    if (
      !font?.data ||
      !/^(?:[A-Z]{6}\+)?(?:HyhwpEQ|HancomEQN|Haansoft Batang)$/i.test(font.name ?? '')
    )
      continue;
    const decoder = fonts.get(current) ?? new Map<string, string>();
    fonts.set(current, decoder);
    const roles = styles.get(current) ?? new Map<string, SourceFontRole>();
    styles.set(current, roles);
    for (const arg of args) {
      if (!Array.isArray(arg)) continue;
      for (const entry of arg) {
        if (!entry || typeof entry !== 'object') continue;
        const glyph = entry as Glyph;
        if (
          typeof glyph.unicode !== 'string' ||
          Array.from(glyph.unicode).length !== 1 ||
          typeof glyph.fontChar !== 'string' ||
          Array.from(glyph.fontChar).length !== 1
        )
          continue;
        const proseCharacters: Record<number,string | string[]> = {0xf550:'ᄒᆡ',0xe470:'ᄅᆞᆯ',0xe283:'ᄂᆞ',0xe563:'ᄆᆞᆫ',0xf000:['−','⬇']};
        const allowed = (/Haansoft Batang$/i.test(font.name ?? '') ? proseCharacters : equationCharacters)[glyph.unicode.codePointAt(0)!];
        const isEquation = /(?:HyhwpEQ|HancomEQN)$/i.test(font.name ?? '');
        const asciiLetter = isEquation && /^[A-Za-z]$/.test(glyph.unicode);
        if (!allowed && !asciiLetter) continue;
        const code = glyph.fontChar.codePointAt(0)!;
        const cache =
          fingerprints.get(font) ?? new Map<number, string | undefined>();
        if (!fingerprints.has(font)) fingerprints.set(font, cache);
        if (!cache.has(code))
          cache.set(code, glyphOutlineFingerprint(font.data, code));
        const fingerprint = cache.get(code);
        const replacement = fingerprint ? verifiedOutlines[fingerprint] : undefined;
        const verified = replacement && (Array.isArray(allowed) ? allowed.includes(replacement) : allowed === replacement);
        const role: SourceFontRole = fingerprint && asciiLetter && verifiedRomanOutlines[fingerprint] === glyph.unicode
          ? 'roman'
          : fingerprint && isEquation && verified && verifiedItalicOutlines.has(fingerprint)
            ? 'italic'
            : fingerprint && isEquation && verified && verifiedMatrixOutlines.has(fingerprint)
              ? 'matrix' : '';
        if (!role || (roles.has(glyph.unicode) && roles.get(glyph.unicode) !== role)) roles.set(glyph.unicode, '');
        else roles.set(glyph.unicode, role);
        if (!allowed) continue;
        // A conflicting/unrecognized outline for the same code invalidates it.
        if (!verified || (decoder.has(glyph.unicode) && decoder.get(glyph.unicode) !== replacement))
          decoder.set(glyph.unicode, '');
        else decoder.set(glyph.unicode, replacement!);
      }
    }
  }
  return { fonts, styles };
}

type PositionedRun = PageText & {
  fontName: string;
  sourceFontName?: string;
  sourceMathLatex?: string;
  baseline: number;
  equation: boolean;
};
export function joinEquationRuns(
  items: PositionedRun[],
  rules: Rule[] = [],
): PageText[] {
  const result: PositionedRun[] = [];
  // Only nearby equation glyphs on the same baseline join. Never join across
  // table cells, columns, font changes, or superscript/fraction baselines.
  for (const item of items) {
    const previous = result.at(-1),
      size = previous ? Math.min(item.height, previous.height) : 0;
    const gap = previous ? item.x - previous.x - previous.width : Infinity;
    const crossesCell =
      previous &&
      rules.some(
        (rule) =>
          Math.abs(rule.x1 - rule.x2) < 0.5 &&
          rule.x1 > previous.x + previous.width - 0.1 &&
          rule.x1 < item.x + 0.1 &&
          Math.max(rule.y1, rule.y2) > item.y &&
          Math.min(rule.y1, rule.y2) < item.baseline,
      );
    if (
      previous?.equation &&
      item.equation &&
      previous.fontName === item.fontName &&
      !crossesCell &&
      Math.abs(previous.baseline - item.baseline) <= size * 0.12 &&
      Math.abs(previous.height - item.height) <= size * 0.12 &&
      gap >= -size * 0.1 &&
      gap <= size * 0.2
    ) {
      previous.text += item.text;
      previous.width = item.x + item.width - previous.x;
      const bottom = Math.max(
        previous.y + previous.height,
        item.y + item.height,
      );
      previous.y = Math.min(previous.y, item.y);
      previous.height = bottom - previous.y;
    } else result.push({ ...item });
  }
  return result.map(({ text, x, y, width, height }) => ({
    text,
    x,
    y,
    width,
    height,
  }));
}

export function extractPositionedText(
  items: unknown[],
  viewport: number[],
  operators: Operators,
  ops: Record<string, number>,
  getFont: (id: string) => Font | undefined,
  rules: Rule[] = [],
) {
  const { fonts: decoders, styles } = fontDecoders(operators, ops, getFont);
  let recoveredGlyphs = 0;
  const positioned: PositionedRun[] = [];
  for (const candidate of items) {
    const item = candidate as Partial<TextItem>;
    if (
      typeof item.str !== 'string' ||
      !item.str.trim() ||
      !item.transform ||
      !item.fontName
    )
      continue;
    const decoder = decoders.get(item.fontName);
    let equation = false,
      sourceFontName: string | undefined;
    try {
      sourceFontName = getFont(item.fontName)?.name;
      equation = /(?:HyhwpEQ|HancomEQN)$/i.test(sourceFontName ?? '');
    } catch { /* retain as prose */ }
    const sourceChars = Array.from(item.str.trim());
    const text = sourceChars
      .map((char) => {
        const value = decoder?.get(char);
        if (value) recoveredGlyphs++;
        return value || char;
      })
      .join('');
    const [a, b, c, d, e, f] = viewport,
      t = item.transform;
    // A rotation is not italics. Detect only shear between the two text axes.
    const slanted = Math.abs(t[0] * t[2] + t[1] * t[3]) /
      Math.max(0.001, Math.hypot(t[0], t[1]) * Math.hypot(t[2], t[3])) > 0.12;
    const roles = styles.get(item.fontName);
    const styledChars = sourceChars.map(char => {
      const role = roles?.get(char);
      return { text: decoder?.get(char) || char,
        role: role === 'matrix' ? slanted ? 'italic' : 'roman' : role };
    });
    let sourceMathLatex: string | undefined;
    if (equation && styledChars.some(char => char.role)) {
      const chunks: Array<{ text: string; role: string | undefined }> = [];
      for (const char of styledChars) {
        const previous = chunks.at(-1);
        if (previous && previous.role === char.role) previous.text += char.text;
        else chunks.push({ ...char });
      }
      const escape = (value: string) => value.replace(/[\\$%#&_{}]/g,
        char => char === '\\' ? '\\backslash{}' : `\\${char}`);
      sourceMathLatex = chunks.map(chunk => chunk.role
        ? `\\${chunk.role === 'italic' ? 'mathit' : 'mathrm'}{${escape(chunk.text)}}`
        : escape(chunk.text)).join('');
    }
    const height = Math.hypot(a * t[2] + c * t[3], b * t[2] + d * t[3]);
    const baseline = b * t[4] + d * t[5] + f;
    positioned.push({
      text,
      mathRole:
        equation && decoder?.get('\ue06e') === '→' && item.str.trim() === '\ue06e'
          ? 'vectorArrow'
          : equation && decoder && text === '─'
          ? 'fractionBar'
          : equation && decoder && text === '√'
            ? 'radical'
            : undefined,
      fontName: item.fontName,
      sourceFontName,
      ...(sourceMathLatex ? { sourceMathLatex } : {}),
      equation: equation && Boolean(decoder),
      baseline,
      x: a * t[4] + c * t[5] + e,
      y: baseline - height,
      height,
      width: item.width ?? 0,
    });
  }
  const styled = inferPdfTextStyles(positioned,rules,operators,ops,viewport,getFont).map(item =>
    // Short variable atoms can also be printed with an explicitly italic body
    // font. Apply after underline splitting so metadata never refers to a larger
    // original run. Prose/words and unlabelled fonts are not promoted to math.
    !item.equation && /italic|oblique/i.test(item.sourceFontName ?? '') && /^[A-Za-z\u0370-\u03ff]$/u.test(item.text)
      ? { ...item, sourceMathLatex: `\\mathit{${item.text}}` } : item);
  const math = reconstructMathRuns(styled, rules);
  // If a future geometry change violates source conservation, retain the source.
  const restored = math.sourceConserved ? math.items : styled;
  return {
    items: inferPdfMathUnderlines(restored, rules).map(
      ({ text, x, y, width, height, mathRole, sourceBounds, bold, underline }) => ({
        text,
        x,
        y,
        width,
        height,
        ...(bold ? {bold} : {}),
        ...(underline ? {underline} : {}),
        ...(mathRole ? { mathRole } : {}),
        ...(sourceBounds ? { sourceBounds } : {}),
      }),
    ),
    recoveredGlyphs,
    mathWarnings: math.warnings,
  };
}
