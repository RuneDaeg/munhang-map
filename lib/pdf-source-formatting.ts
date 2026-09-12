// Candidate module. No source-PDF names, question numbers or character repairs.
type Matrix = number[];
type Font = {
  name?: string;
  data?: Uint8Array;
  bold?: boolean;
  black?: boolean;
};
type Operators = { fnArray: number[]; argsArray: unknown[][] };
type Rule = { x1: number; y1: number; x2: number; y2: number };
type Item = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  baseline?: number;
  fontName?: string;
  equation?: boolean;
  bold?: boolean;
  underline?: boolean;
  sourceBounds?: { x: number; y: number; width: number; height: number };
};
const identity = () => [1, 0, 0, 1, 0, 0];
const mul = (a: Matrix, b: Matrix) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const point = (m: Matrix, x: number, y: number) => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

/** OS/2 weight/selection and head flags supplement, rather than infer from, font family. */
export function fontIsBold(font?: Font): boolean {
  if (!font) return false;
  if (
    font.bold ||
    font.black ||
    /(?:bold|black|heavy|demi)/i.test(font.name ?? '')
  )
    return true;
  const data = font.data;
  if (!data || data.length < 12) return false;
  try {
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const count = v.getUint16(4);
    if (12 + count * 16 > data.length) return false;
    for (let n = 0; n < count; n++) {
      const at = 12 + n * 16,
        offset = v.getUint32(at + 8),
        length = v.getUint32(at + 12);
      if (offset + length > data.length) continue;
      const tag = String.fromCharCode(...data.subarray(at, at + 4));
      if (
        tag === 'OS/2' &&
        length >= 64 &&
        (v.getUint16(offset + 4) >= 600 || v.getUint16(offset + 62) & 32)
      )
        return true;
      if (tag === 'head' && length >= 46 && v.getUint16(offset + 44) & 1)
        return true;
    }
  } catch {
    /* malformed or unsupported font: retain ordinary text */
  }
  return false;
}

/** Painted fill+stroke text can be bold even when the embedded font is Regular. */
export function syntheticBoldAreas(
  list: Operators,
  ops: Record<string, number>,
  viewport: Matrix,
  includePlain = false,
) {
  let state = {
    matrix: [...viewport],
    font: '',
    size: 0,
    mode: 0,
    lineWidth: 1,
    hScale: 1,
    charSpace: 0,
    wordSpace: 0,
    rise: 0,
    leading: 0,
  };
  const stack: (typeof state)[] = [];
  let tm = identity(),
    line = identity();
  const result: Array<{
    x: number;
    right: number;
    baseline: number;
    height: number;
    fontName: string;
    text: string;
    bold?: boolean;
    glyphs?: Array<{ text: string; x: number; right: number }>;
  }> = [];
  const move = (x: number, y: number) => {
    line = mul(line, [1, 0, 0, 1, x, y]);
    tm = [...line];
  };
  for (let i = 0; i < list.fnArray.length; i++) {
    const op = list.fnArray[i],
      args = list.argsArray[i] ?? [];
    if (op === ops.save) stack.push({ ...state, matrix: [...state.matrix] });
    else if (op === ops.restore) state = stack.pop() ?? state;
    else if (op === ops.transform)
      state.matrix = mul(state.matrix, args as number[]);
    else if (op === ops.setFont) {
      state.font = String(args[0]);
      state.size = Number(args[1]);
    } else if (op === ops.setTextRenderingMode) state.mode = Number(args[0]);
    else if (op === ops.setLineWidth) state.lineWidth = Number(args[0]);
    else if (op === ops.setHScale) state.hScale = Number(args[0]) / 100;
    else if (op === ops.setCharSpacing) state.charSpace = Number(args[0]);
    else if (op === ops.setWordSpacing) state.wordSpace = Number(args[0]);
    else if (op === ops.setTextRise) state.rise = Number(args[0]);
    else if (op === ops.setLeading) state.leading = Number(args[0]);
    else if (op === ops.beginText) tm = line = identity();
    else if (op === ops.setTextMatrix) tm = line = [...args] as number[];
    else if (op === ops.moveText) move(Number(args[0]), Number(args[1]));
    else if (op === ops.setLeadingMoveText) {
      state.leading = -Number(args[1]);
      move(Number(args[0]), Number(args[1]));
    } else if (op === ops.nextLine) move(0, -state.leading);
    else if (
      [
        ops.showText,
        ops.showSpacedText,
        ops.nextLineShowText,
        ops.nextLineSetSpacingShowText,
      ].includes(op)
    ) {
      if (op === ops.nextLineShowText || op === ops.nextLineSetSpacingShowText)
        move(0, -state.leading);
      if (op === ops.nextLineSetSpacingShowText) {
        state.wordSpace = Number(args[0]);
        state.charSpace = Number(args[1]);
      }
      const glyphs = args.find(Array.isArray) as
        | Array<
            number | { unicode?: string; width?: number; isSpace?: boolean }
          >
        | undefined;
      if (!glyphs) continue;
      let advance = 0,
        text = '';
      const glyphAdvances: Array<{ text: string; left: number; right: number }> = [];
      for (const glyph of glyphs) {
        if (typeof glyph === 'number') advance -= (glyph * state.size) / 1000;
        else {
          text += glyph.unicode ?? '';
          const left = advance;
          advance +=
            ((glyph.width ?? 0) * state.size) / 1000 +
            state.charSpace +
            (glyph.isSpace ? state.wordSpace : 0);
          glyphAdvances.push({ text: glyph.unicode ?? '', left, right: advance });
        }
      }
      advance *= state.hScale;
      const m = mul(state.matrix, tm),
        a = point(m, 0, state.rise),
        b = point(m, advance, state.rise);
      const height = Math.abs(state.size) * Math.hypot(m[2], m[3]);
      // Outline-only or invisible text is not sufficient evidence of bold emphasis.
      const bold = [2, 6].includes(state.mode) &&
        state.lineWidth > 0 &&
        state.lineWidth / Math.abs(state.size) <= 0.12;
      if (
        (bold || (includePlain && [0, 1, 2, 4, 5, 6].includes(state.mode))) &&
        Math.abs(a[1] - b[1]) < 0.1 &&
        height > 0
      )
        result.push({
          x: Math.min(a[0], b[0]),
          right: Math.max(a[0], b[0]),
          baseline: a[1],
          height,
          fontName: state.font,
          text,
          ...(includePlain ? { bold, glyphs: glyphAdvances.map(glyph => ({
            text: glyph.text,
            x: point(m, glyph.left * state.hScale, state.rise)[0],
            right: point(m, glyph.right * state.hScale, state.rise)[0],
          })) } : {}),
        });
      tm = mul(tm, [1, 0, 0, 1, advance, 0]);
    }
  }
  return result;
}

function openUnderlines(rules: Rule[]) {
  const vertical = rules.filter(
    (r) => Math.abs(r.x1 - r.x2) < 1 && r.y2 - r.y1 > 3,
  );
  const horizontal = rules.filter(
    (r) => Math.abs(r.y1 - r.y2) < 0.7 && r.x2 - r.x1 > 3,
  );
  return horizontal.filter((r) => {
    const joins = vertical.filter(
      (v) =>
        v.y1 <= r.y1 + 1.5 &&
        v.y2 >= r.y1 - 1.5 &&
        v.x1 >= r.x1 - 1.5 &&
        v.x1 <= r.x2 + 1.5,
    );
    // Cell/box edges have two vertical junctions; a text underline is open-ended.
    return !joins.some((a, n) =>
      joins
        .slice(n + 1)
        .some((b) => Math.abs(a.x1 - b.x1) > (r.x2 - r.x1) * 0.7),
    );
  });
}

function coversUnderline(item: Item, rule: Rule, baseline = item.baseline ?? item.y + item.height) {
  const dy = rule.y1 - baseline;
  const overlap = Math.min(item.x + item.width, rule.x2) - Math.max(item.x, rule.x1);
  // Some writers position a rule below the descender, roughly one third of an em.
  return dy >= -0.02 * item.height && dy <= 0.36 * item.height && overlap >= item.width * 0.85;
}

/** Attach metadata to raw-text items. Serialization, not geometry matching, emits tags. */
export function inferPdfTextStyles<T extends Item>(
  items: T[],
  rules: Rule[],
  list: Operators,
  ops: Record<string, number>,
  viewport: Matrix,
  getFont: (id: string) => Font | undefined,
): T[] {
  const painted = syntheticBoldAreas(list, ops, viewport, true);
  const fontCache = new Map<string, boolean>();
  const underlines = openUnderlines(rules);
  return items.flatMap((item) => {
    if (item.equation) return [{ ...item }];
    const fontName = item.fontName ?? '';
    if (!fontCache.has(fontName)) {
      let font;
      try {
        font = getFont(fontName);
      } catch {}
      fontCache.set(fontName, fontIsBold(font));
    }
    const baseline = item.baseline ?? item.y + item.height;
    const bold =
      fontCache.get(fontName) ||
      painted.some(
        (a) =>
          a.bold && a.fontName === fontName &&
          Math.abs(a.baseline - baseline) < Math.max(0.7, item.height * 0.1) &&
          item.x >= a.x - 0.8 &&
          item.x + item.width <= a.right + 1.2,
      );
    const underline = underlines.some((r) => coversUnderline(item, r));
    const styled = {
      ...item,
      ...(bold ? { bold: true } : {}),
      ...(underline ? { underline: true } : {}),
    };
    if (underline || item.underline) return [styled];
    const partial = underlines.filter(r => coversUnderline({ ...item, width: 0 }, r) &&
      r.x2 > item.x && r.x1 < item.x + item.width);
    if (!partial.length) return [styled];
    // PDF text runs often contain both the underlined word and its unmarked
    // particle/sentence. Split only with verified glyph advances from the same
    // paint operation; do not estimate character widths or extend the underline.
    const glyphs = painted.filter(a => a.fontName === fontName &&
      Math.abs(a.baseline - baseline) < Math.max(.7, item.height * .1))
      .flatMap(a => a.glyphs ?? []).filter(g =>
        g.x >= item.x - .8 && g.x < item.x + item.width - .5)
      .sort((a, b) => a.x - b.x).map((g, index, all) => ({ ...g,
        // TJ kerning adjusts the next origin, so the advance before that
        // adjustment can exceed the next glyph or the source run's edge.
        right: Math.min(g.right, all[index + 1]?.x ?? Infinity, item.x + item.width),
      }));
    const exact = glyphs.map(g => g.text).join('').trim();
    if (exact !== item.text.trim()) return [styled];
    const pieces: Array<{ text: string; x: number; right: number; underline: boolean }> = [];
    for (const glyph of glyphs) {
      const marked = partial.some(r =>
        Math.min(r.x2, glyph.right) - Math.max(r.x1, glyph.x) >= (glyph.right - glyph.x) * .8);
      const previous = pieces.at(-1);
      if (previous?.underline === marked) {
        previous.text += glyph.text;
        previous.right = glyph.right;
      } else pieces.push({ ...glyph, underline: marked });
    }
    if (!pieces.some(p => p.underline) || pieces.length < 2) return [styled];
    return pieces.filter(p => p.text.trim()).map(p => ({ ...styled,
      text: p.text.trim(), x: p.x, width: p.right - p.x,
      ...(p.underline ? { underline: true } : {}),
    }));
  });
}

/** Underline a complete formula only when it continues a proven prose underline. */
export function inferPdfMathUnderlines<T extends Item>(items: T[], rules: Rule[]): T[] {
  const underlines = openUnderlines(rules);
  return items.map((item) => {
    if (!item.equation) return item;
    const bounds = item.sourceBounds ?? item;
    const bottom = bounds.y + bounds.height;
    const underline = underlines.some((rule) =>
      coversUnderline(item, rule, bottom) &&
      items.some((neighbor) =>
        !neighbor.equation && neighbor.underline && coversUnderline(neighbor, rule) &&
        Math.min(Math.abs(neighbor.x + neighbor.width - item.x), Math.abs(item.x + item.width - neighbor.x)) <= Math.max(item.height, neighbor.height) * 1.6,
      ),
    );
    return underline ? { ...item, underline: true } : item;
  });
}

/** Preserve exact item text; expose a serializer that does not contaminate marker matching. */
export function styledItemText(item: Item) {
  return `${item.bold ? '<b>' : ''}${item.underline ? '<u>' : ''}${item.text}${item.underline ? '</u>' : ''}${item.bold ? '</b>' : ''}`;
}

/** A split bracket around [A]/[B] is a named range, not a glyph in the paragraph. */
export function detectRangeBrackets<T extends Item>(items: T[], rules: Rule[]) {
  const vertical = rules.filter(
    (r) => Math.abs(r.x1 - r.x2) < 1 && r.y2 - r.y1 > 5,
  );
  const horizontal = rules.filter((r) => Math.abs(r.y1 - r.y2) < 1);
  const result: Array<{
    kind: 'box';
    title: string;
    text: string;
    rows: string[][];
    header: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
    sourceItems: T[];
    orderY: number;
  }> = [];
  for (const label of items.filter((i) => /^\[[A-Z]\]$/.test(i.text.trim()))) {
    const cx = label.x + label.width / 2,
      h = label.height;
    const above = vertical.filter(
      (r) =>
        Math.abs(r.x1 - cx) < h * 0.55 &&
        r.y2 <= label.y + 1 &&
        label.y - r.y2 < h,
    );
    const below = vertical.filter(
      (r) =>
        Math.abs(r.x1 - cx) < h * 0.55 &&
        r.y1 >= label.y + h - 1 &&
        r.y1 - label.y - h < h,
    );
    const pairs = above.flatMap((a) =>
      below.filter((b) => Math.abs(a.x1 - b.x1) < 1).map((b) => ({ a, b })),
    );
    if (pairs.length !== 1) continue;
    const { a, b } = pairs[0],
      top = a.y1,
      bottom = b.y2,
      x = a.x1;
    const tips = (y: number) =>
      horizontal.filter(
        (r) =>
          Math.abs(r.y1 - y) < 1 &&
          r.x2 - r.x1 >= h * 0.35 &&
          r.x2 - r.x1 <= h * 2 &&
          (Math.abs(r.x1 - x) < 1 || Math.abs(r.x2 - x) < 1),
      );
    const upper = tips(top),
      lower = tips(bottom);
    if (upper.length !== 1 || lower.length !== 1) continue;
    const direction = (upper[0].x1 + upper[0].x2) / 2 > x ? 1 : -1;
    if (((lower[0].x1 + lower[0].x2) / 2 > x ? 1 : -1) !== direction) continue;
    const opposite = vertical
      .filter(
        (v) =>
          v.y1 <= top + 2 &&
          v.y2 >= bottom - 2 &&
          direction * (v.x1 - x) > h * 3,
      )
      .sort((a, b) => Math.abs(a.x1 - x) - Math.abs(b.x1 - x))[0];
    // Without a geometric opposite boundary, leave the uncertain range unchanged.
    if (!opposite) continue;
    const left = Math.min(x, opposite.x1),
      right = Math.max(x, opposite.x1);
    const content = items.filter(
      (i) =>
        i !== label &&
        i.y + i.height >= top &&
        i.y <= bottom &&
        i.x + i.width / 2 > left + 1 &&
        i.x + i.width / 2 < right - 1,
    );
    if (
      content.length < 4 ||
      !content.some((i) => /[가-힣A-Za-z]{2}/.test(i.text))
    )
      continue;
    const rows: T[][] = [];
    for (const i of [...content].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const row = rows.find(
        (r) => Math.abs(r[0].y - i.y) < Math.max(2.5, i.height * 0.32),
      );
      if (row) row.push(i);
      else rows.push([i]);
    }
    const actualTop = Math.min(top, ...content.map((i) => i.y)),
      actualBottom = Math.max(bottom, ...content.map((i) => i.y + i.height));
    result.push({
      kind: 'box',
      title: label.text,
      text: rows
        .map((row) =>
          row
            .sort((a, b) => a.x - b.x)
            .map(styledItemText)
            .join(' '),
        )
        .join('\n'),
      rows: [],
      header: false,
      x: Math.min(left, label.x),
      y: actualTop,
      width: Math.max(right, label.x + label.width) - Math.min(left, label.x),
      height: actualBottom - actualTop,
      sourceItems: [label, ...content],
      orderY: actualTop,
    });
  }
  return result;
}
