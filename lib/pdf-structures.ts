import type { CaptureBox, PageText } from './pdf-layout';
import { questionTextFromBlocks } from './question-content';
import { detectChoicePanels, detectDialogue } from './pdf-reading-order';
import { styledItemText, detectRangeBrackets } from './pdf-source-formatting';

export type Rule = { x1: number; y1: number; x2: number; y2: number };
type Matrix = number[];
type Area = { x: number; y: number; width: number; height: number };
export type PdfStructure = Area & {
  kind: 'box' | 'table';
  text: string;
  title: string;
  rows: string[][];
  header: boolean;
  sourceItems?: PageText[];
  orderY?: number;
  inline?: boolean;
  afterText?: string;
  inlineContent?: string;
};
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

/** Read painted PDF vector rules; unpainted clipping paths are not table borders. */
export function pdfRules(
  list: { fnArray: number[]; argsArray: unknown[][] },
  ops: Record<string, number>,
  viewport: Matrix,
): Rule[] {
  let matrix = [...viewport];
  const stack: Matrix[] = [];
  const rules: Rule[] = [];
  let pending: Rule[] = [];
  let current = [0, 0],
    start = [0, 0];
  const line = (a: number[], b: number[]) => {
    const p = point(matrix, a[0], a[1]),
      q = point(matrix, b[0], b[1]);
    if (
      (Math.abs(p[0] - q[0]) < 0.7 || Math.abs(p[1] - q[1]) < 0.7) &&
      Math.hypot(p[0] - q[0], p[1] - q[1]) > 5
    )
      pending.push({
        x1: Math.min(p[0], q[0]),
        y1: Math.min(p[1], q[1]),
        x2: Math.max(p[0], q[0]),
        y2: Math.max(p[1], q[1]),
      });
  };
  list.fnArray.forEach((op, i) => {
    const args = list.argsArray[i];
    if (op === ops.save) stack.push([...matrix]);
    else if (op === ops.restore) matrix = stack.pop() ?? [...viewport];
    else if (op === ops.transform) matrix = mul(matrix, args as number[]);
    else if (op === ops.constructPath) {
      const codes = args[0] as number[],
        values = args[1] as number[];
      let at = 0;
      for (const code of codes) {
        if (code === ops.moveTo) {
          current = values.slice(at, at + 2);
          start = current;
          at += 2;
        } else if (code === ops.lineTo) {
          const next = values.slice(at, at + 2);
          line(current, next);
          current = next;
          at += 2;
        } else if (code === ops.rectangle) {
          const [x, y, w, h] = values.slice(at, at + 4);
          at += 4;
          const corners = [
            [x, y],
            [x + w, y],
            [x + w, y + h],
            [x, y + h],
            [x, y],
          ];
          for (let c = 0; c < 4; c++) line(corners[c], corners[c + 1]);
          current = start = [x, y];
        } else if (code === ops.closePath) {
          line(current, start);
          current = start;
        } else if (code === ops.curveTo) {
          current = values.slice(at + 4, at + 6);
          at += 6;
        } else if (code === ops.curveTo2 || code === ops.curveTo3) {
          current = values.slice(at + 2, at + 4);
          at += 4;
        }
      }
    } else if (
      [
        ops.stroke,
        ops.closeStroke,
        ops.fillStroke,
        ops.eoFillStroke,
        ops.closeFillStroke,
        ops.closeEOFillStroke,
      ].includes(op)
    ) {
      rules.push(...pending);
      pending = [];
    } else if ([ops.endPath, ops.fill, ops.eoFill].includes(op)) pending = [];
  });
  const unique = new Map<string, Rule>();
  for (const rule of rules)
    unique.set(
      [rule.x1, rule.y1, rule.x2, rule.y2].map((v) => Math.round(v)).join(','),
      rule,
    );
  // Some PDF writers paint a box side as one short segment per text line.
  // Join touching collinear pieces before applying any minimum-size filter.
  const merged: Rule[] = [];
  for (const rule of [...unique.values()].sort(
    (a, b) => a.x1 - b.x1 || a.y1 - b.y1,
  )) {
    const vertical = rule.x2 - rule.x1 < 0.7;
    const match = merged.find((r) =>
      vertical
        ? r.x2 - r.x1 < 0.7 &&
          Math.abs(r.x1 - rule.x1) < 0.8 &&
          rule.y1 <= r.y2 + 1 &&
          rule.y2 >= r.y1 - 1
        : r.y2 - r.y1 < 0.7 &&
          Math.abs(r.y1 - rule.y1) < 0.8 &&
          rule.x1 <= r.x2 + 1 &&
          rule.x2 >= r.x1 - 1,
    );
    if (match) {
      match.x1 = Math.min(match.x1, rule.x1);
      match.y1 = Math.min(match.y1, rule.y1);
      match.x2 = Math.max(match.x2, rule.x2);
      match.y2 = Math.max(match.y2, rule.y2);
    } else merged.push({ ...rule });
  }
  return merged;
}

function rowsOf(items: PageText[]) {
  const rows: PageText[][] = [];
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find(
      (row) => Math.abs(row[0].y - item.y) < Math.max(2.5, item.height * 0.32),
    );
    if (row) row.push(item);
    else rows.push([item]);
  }
  return rows.map((row) => row.sort((a, b) => a.x - b.x));
}
const textOf = (items: PageText[]) =>
  rowsOf(items)
    .map((row) => row.map(styledItemText).join(' '))
    .join('\n');

// Cell source is a single Markdown row. Only a new, visibly separate bullet
// starts a cell line; wrapped prose, fractions and scripts remain together.
const cellTextOf = (items: PageText[]) => textOf(items)
  .replace(/\n(?=[ \t]*(?:<b>|<u>)*[◦•∙])/g, '<br>')
  .replace(/\n/g, ' ');

/** Adjacent multi-line figure captions are read column-first, not row-first. */
function parallelProseRows(rows: PageText[][]): PageText[][] {
  const split = (row: PageText[]) => {
    const parts: PageText[][] = [];
    for (const item of row) {
      const previous = parts.at(-1)?.at(-1);
      if (!previous || item.x - previous.x - previous.width > Math.max(12, item.height * 1.6)) parts.push([item]);
      else parts.at(-1)!.push(item);
    }
    return parts;
  };
  const output: PageText[][] = [];
  for (let i = 0; i < rows.length; i++) {
    const first = split(rows[i]);
    const next = rows[i + 1] && split(rows[i + 1]);
    const height = Math.max(...rows[i].map(item => item.height));
    if (first.length >= 2 && first.length <= 4 && next?.length === first.length &&
      rows[i + 1][0].y - rows[i][0].y < height * 1.8 &&
      [...first, ...next].every(part => /[가-힣]{2}|[A-Za-z]{3}/.test(textOf(part))) &&
      first.every((part, c) => Math.abs(part[0].x - next[c][0].x) < height * 2 &&
        (!c || next[c][0].x > part[0].x - height * 2))) {
      output.push(...first.map((part, c) => [...part, ...next[c]]));
      i++;
    } else output.push(rows[i]);
  }
  return output;
}
const inside = (item: PageText, area: Area, pad = 0) =>
  item.x + item.width / 2 >= area.x - pad &&
  item.x + item.width / 2 <= area.x + area.width + pad &&
  item.y + item.height / 2 >= area.y - pad &&
  item.y + item.height / 2 <= area.y + area.height + pad;
const unique = (values: number[]) =>
  values.sort((a, b) => a - b).filter((v, i, a) => !i || v - a[i - 1] > 2);
function covered(lines: Rule[], y: number, left: number, right: number) {
  const spans = lines
    .filter((l) => Math.abs(l.y1 - y) < 2 && Math.abs(l.y2 - y) < 2)
    .map((l) => [Math.max(left, l.x1), Math.min(right, l.x2)])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let end = left,
    total = 0;
  for (const [a, b] of spans) {
    total += Math.max(0, b - Math.max(a, end));
    end = Math.max(end, b);
  }
  return total / (right - left);
}

/** Recover body rows whose rule stops at a row-spanning label cell. */
function splitBodyRows(
  content: PageText[],
  rules: Rule[],
  vertical: Rule[],
  xs: number[],
  ys: number[],
): { ys: number[]; rows: string[][] } | undefined {
  // A short divider is structural only when both ends meet established rows.
  // In-cell answer boxes and diagram strokes do not establish new boundaries.
  const shortDividers = vertical.filter(
    (v) =>
      v.x1 > xs[0] + 2 && v.x1 < xs.at(-1)! - 2 &&
      v.y1 >= ys[1] - 2 && v.y2 <= ys.at(-1)! + 2 &&
      ys.some((y) => Math.abs(y - v.y1) < 2) &&
      ys.some((y) => Math.abs(y - v.y2) < 2),
  );
  const fineXs = unique([...xs, ...shortDividers.map((v) => v.x1)]);
  const partialYs = unique(rules.filter(
    (r) =>
      Math.abs(r.y2 - r.y1) < 1 &&
      r.y1 > ys[1] + 2 && r.y1 < ys.at(-1)! - 2 &&
      !ys.some((y) => Math.abs(y - r.y1) < 2) &&
      fineXs.some((x) => Math.abs(x - r.x1) < 2) &&
      fineXs.some((x) => Math.abs(x - r.x2) < 2) &&
      // A real split crosses at least one complete existing column.
      xs.slice(0, -1).some((x, c) =>
        covered(rules, r.y1, x, xs[c + 1]) > 0.9,
      ),
  ).map((r) => r.y1));
  if (!partialYs.length) return;
  const fineYs = unique([...ys, ...partialYs]);
  if (fineXs.length > 33 || fineYs.length > 81) return;

  // Build actual cells from the fine grid. Missing boundaries join cells, so
  // a multi-line shared label is read once as a phrase, then linked to each row.
  const columns = fineXs.length - 1, rows = fineYs.length - 1;
  const parent = Array.from({ length: columns * rows }, (_, i) => i);
  const root = (i: number): number =>
    parent[i] === i ? i : (parent[i] = root(parent[i]));
  const join = (a: number, b: number) => { parent[root(b)] = root(a); };
  const transposed = rules.map((r) => ({ x1:r.y1, y1:r.x1, x2:r.y2, y2:r.x2 }));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const cell = r * columns + c;
      if (c + 1 < columns && covered(transposed, fineXs[c + 1], fineYs[r], fineYs[r + 1]) < 0.5)
        join(cell, cell + 1);
      if (r + 1 < rows && covered(rules, fineYs[r + 1], fineXs[c], fineXs[c + 1]) < 0.5)
        join(cell, cell + columns);
    }
  }
  const cellItems = new Map<number, PageText[]>();
  const interval = (bounds: number[], value: number) =>
    Math.max(0, Math.min(bounds.length - 2, bounds.findIndex((n) => n > value) - 1));
  for (const item of content) {
    const c = interval(fineXs, Math.min(item.x + item.width / 2, fineXs.at(-1)! - .01));
    const r = interval(fineYs, Math.min(item.y + item.height / 2, fineYs.at(-1)! - .01));
    const id = root(r * columns + c);
    if (!cellItems.has(id)) cellItems.set(id, []);
    cellItems.get(id)!.push(item);
  }
  const cellText = new Map(
    [...cellItems].map(([id, items]) => [id, cellTextOf(items)]),
  );
  return {
    ys: fineYs,
    rows: fineYs.slice(0, -1).map((_y, r) => xs.slice(0, -1).map((x, c) => {
      const cells = new Set<number>();
      for (let sub = 0; sub < columns; sub++) {
        const center = (fineXs[sub] + fineXs[sub + 1]) / 2;
        if (center > x && center < xs[c + 1]) cells.add(root(r * columns + sub));
      }
      return [...cells].map((id) => cellText.get(id) ?? '').filter(Boolean).join(' ');
    })),
  };
}

/** Conservative geometry recovery, including a split top border around a 보기 heading. */
export function detectPdfStructures(
  items: PageText[],
  rules: Rule[],
  imageAreas: Area[] = [],
): PdfStructure[] {
  const vertical = rules.filter((r) => r.x2 - r.x1 < 1 && r.y2 - r.y1 > 10);
  const groups: Rule[][] = [];
  for (const line of vertical) {
    const group = groups.find(
      (g) => Math.abs(g[0].y1 - line.y1) < 2 && Math.abs(g[0].y2 - line.y2) < 2,
    );
    if (group) group.push(line);
    else groups.push([line]);
  }
  // Equal heights do not make neighbouring tables one grid. A real inter-cell
  // band is closed at both ends; the white gutter between independent tables
  // has no top/bottom rule. Split there before inferring any row-spanning cell.
  const connectedGroups = groups.flatMap(group => {
    const ordered = [...group].sort((a, b) => a.x1 - b.x1);
    const parts: Rule[][] = [];
    for (const line of ordered) {
      const last = parts.at(-1)?.at(-1);
      if (!last || (line.x1 - last.x1 > 2 &&
        covered(rules, group[0].y1, last.x1, line.x1) < .15 &&
        covered(rules, group[0].y2, last.x1, line.x1) < .15)) parts.push([line]);
      else parts.at(-1)!.push(line);
    }
    return parts;
  });
  const found: PdfStructure[] = [];
  for (const group of connectedGroups) {
    const xs = unique(group.map((l) => l.x1)),
      top = group[0].y1,
      bottom = group[0].y2;
    // Open-sided grids still have repeated horizontal rules. Their endpoints
    // define the outer cells even when no outer vertical stroke was painted.
    const spanning = rules.filter(
      (r) =>
        r.y2 - r.y1 < 1 &&
        r.y1 >= top - 2 &&
        r.y1 <= bottom + 2 &&
        r.x1 <= xs[0] + 2 &&
        r.x2 >= xs.at(-1)! - 2,
    );
    if (xs.length >= 2 && spanning.length >= 3) {
      const left = Math.max(...spanning.map((r) => r.x1)),
        right = Math.min(...spanning.map((r) => r.x2));
      if (
        spanning.every(
          (r) => Math.abs(r.x1 - left) < 2 && Math.abs(r.x2 - right) < 2,
        )
      ) {
        if (left < xs[0] - 3) xs.unshift(left);
        if (right > xs.at(-1)! + 3) xs.push(right);
      }
    }
    if (
      xs.length < 2 ||
      xs.at(-1)! - xs[0] < 8 ||
      covered(rules, top, xs[0], xs.at(-1)!) < 0.7 ||
      covered(rules, bottom, xs[0], xs.at(-1)!) < 0.85
    )
      continue;
    const area = {
      x: xs[0],
      y: top,
      width: xs.at(-1)! - xs[0],
      height: bottom - top,
    };
    // A merged header often omits a separator only in its first band. Retain
    // that separator for the data columns, but don't borrow an unrelated
    // nested table's edges from the middle of an enclosing material box.
    for (const line of vertical) {
      if (line.x1 <= area.x + 2 || line.x1 >= area.x + area.width - 2) continue;
      if (Math.abs(line.y2 - bottom) > 2 || line.y1 < top - 2 || line.y2 - line.y1 < area.height * .5) continue;
      if (covered(rules, line.y1, area.x, area.x + area.width) < .15) continue;
      if (!xs.some(x => Math.abs(x - line.x1) < 2)) xs.push(line.x1);
    }
    xs.sort((a,b) => a-b);
    const content = items.filter((i) => inside(i, area));
    let ys = unique([
      top,
      ...rules
        .filter(
          (r) =>
            r.y2 - r.y1 < 1 &&
            r.y1 > top + 2 &&
            r.y1 < bottom - 2 &&
            covered(rules, r.y1, xs[0], xs.at(-1)!) > 0.9,
        )
        .map((r) => r.y1),
      bottom,
    ]);
    if (
      (xs.length >= 3 || (xs.length === 2 && !vertical.some(v =>
        v.x1 > area.x + 2 && v.x1 < area.x + area.width - 2 &&
        v.y1 >= top - 2 && v.y2 <= bottom + 2))) &&
      ys.length >= 3 &&
      xs.length <= 17 &&
      ys.length <= 81
    ) {
      const split = splitBodyRows(content, rules, vertical, xs, ys);
      if (split) ys = split.ys;
      const rows = ys.slice(0, -1).map((y, r) =>
        xs.slice(0, -1).map((x, c) =>
          r > 0 && split ? split.rows[r][c] : cellTextOf(
            content.filter((i) => {
              if (r === 0 && inside(i, {...area, y, height:ys[r+1]-y})) {
                // Flatten a multi-level heading to one label per leaf column.
                // The parent label belongs to every child under the missing
                // separator (e.g. '주차율 평일' / '주차율 주말').
                const cy = i.y + i.height / 2;
                const dividers = vertical.filter(v => v.y1 <= cy + 1 && v.y2 >= cy - 1 && xs.some(x=>Math.abs(x-v.x1)<2))
                  .map(v => v.x1).filter(v => v >= area.x - 2 && v <= area.x + area.width + 2);
                const cx = i.x + i.width / 2;
                const left = Math.max(area.x, ...dividers.filter(v => v < cx));
                const right = Math.min(area.x + area.width, ...dividers.filter(v => v > cx));
                return (x + xs[c+1]) / 2 > left - 1 && (x + xs[c+1]) / 2 < right + 1;
              }
              return inside(i, {
                x,
                y,
                width: xs[c + 1] - x,
                height: ys[r + 1] - y,
              });
            }),
          ),
        ),
      );
      // A photograph inside a grid cell is not an empty answer. Preserve an
      // explicit source-image reference, without OCR-inventing its contents or
      // filling genuinely empty cells elsewhere in the same table.
      rows.forEach((row, r) => row.forEach((value, c) => {
        if (value.trim()) return;
        const cell = { x: xs[c], y: ys[r], width: xs[c + 1] - xs[c], height: ys[r + 1] - ys[r] };
        if (imageAreas.some(image => image.width > 5 && image.height > 5 &&
          image.width <= cell.width * 1.08 && image.height <= cell.height * 1.08 &&
          image.x + image.width / 2 >= cell.x && image.x + image.width / 2 <= cell.x + cell.width &&
          image.y + image.height / 2 >= cell.y && image.y + image.height / 2 <= cell.y + cell.height &&
          image.width * image.height >= cell.width * cell.height * .1)) row[c] = '[그림: 원문 캡처 참조]';
      }));
      if (rows.flat().filter(Boolean).length >= (xs.length === 2 ? 2 : 4)) {
        // Choice numbers may be printed just outside the grid, one per data row.
        const markers = items
          .filter(
            (i) =>
              /^[①②③④⑤]$/.test(i.text) &&
              i.x + i.width <= area.x + 1 &&
              i.x >= area.x - i.height * 2 &&
              i.y >= ys[1] - 2 &&
              i.y < bottom,
          )
          .sort((a, b) => a.y - b.y);
        if (
          rows.length === 6 &&
          markers.length === 5 &&
          [...markers]
            .sort((a, b) => a.y - b.y)
            .map((i) => i.text)
            .join('') === '①②③④⑤' &&
          markers.every((m, r) =>
            inside(m, {
              x: m.x,
              y: ys[r + 1],
              width: m.width,
              height: ys[r + 2] - ys[r + 1],
            }),
          )
        ) {
          rows.forEach((row, r) => row.unshift(r ? markers[r - 1].text : ''));
          const left = Math.min(...markers.map((m) => m.x)) - 1;
          area.width += area.x - left;
          area.x = left;
        }
        found.push({
          ...area,
          kind: 'table',
          rows,
          header: true,
          title: '',
          text: '',
        });
      }
    } else {
      const heading = items.filter((i) =>
        inside(i, { ...area, y: top - 10, height: 16 }),
      );
      const isView = /<\s*보\s*기\s*>/.test(textOf(heading));
      const text = textOf(content.filter((i) => !isView || i.y > top + 4));
      // Sparse labels in diagrams/maps are not bordered prose.
      const prose =
        /[가-힣]{2}/.test(text) ||
        (text.match(/[A-Za-z]{2,}/g)?.length ?? 0) >= 7;
      const compactPhrase = /[가-힣]{2}/.test(text) && content.length > 0 &&
        area.height <= Math.max(...content.map(i=>i.height)) * 2.4;
      const symbolText = content.length === 1 ? content[0].text.trim() : '';
      const symbolMath = symbolText.match(/^\$((?:\\(?:mathrm|mathit)\{[A-Za-z]\})|[A-Za-z])\$$/);
      const symbol = content.length === 1 && (/^[A-Za-z㉠-㉻ⓐ-ⓩ]$/.test(symbolText) || symbolMath)
        ? content[0] : undefined;
      const boxedSymbol = symbol && area.width < symbol.height * 28 && area.height < symbol.height * 1.6 &&
        items.some(i => !inside(i, area) && (i.text.length > 1 || /^[◦•∙]$/.test(i.text)) &&
          ((Math.abs(i.y + i.height - symbol.y - symbol.height) < symbol.height * .6 &&
            Math.min(Math.abs(i.x + i.width - area.x), Math.abs(i.x - area.x - area.width)) < symbol.height * 2.5) ||
           (area.width > symbol.height * 6 && i.y + i.height <= area.y &&
            area.y - i.y - i.height < symbol.height * 1.8 &&
            i.x >= area.x - 2 && i.x + i.width <= area.x + area.width + 2)));
      const shortStatements = rowsOf(content).filter(row => /^\s*[◦•∙]/.test(textOf(row))).length >= 2;
      const equationMaterial = (/\(\s*[가-힣]\s*\)/.test(text) || shortStatements) && /\$[^$]+\$/.test(text) && /[+→=]/.test(text);
      if (((text.replace(/\s/g, '').length >= 30 || compactPhrase || shortStatements) && (prose || equationMaterial)) || boxedSymbol)
        found.push({
          ...area,
          kind: 'box',
          text,
          title: isView ? '<보기>' : '',
          rows: [],
          header: false,
          inline: compactPhrase || !!boxedSymbol,
          ...(boxedSymbol ? { inlineContent: `$\\boxed{${symbolMath?.[1] ?? (/^[A-Za-z]$/.test(symbolText) ? symbolText : `\\text{${symbolText}}`)}}$` } : {}),
        });
    }
  }
  // Keep enclosing boxes as well as their child grids. Serialization assigns
  // each source item to the innermost owner, so content is emitted only once.
  const result = found.filter(child => child.kind !== 'table' || !found.some(parent =>
    parent !== child && parent.kind === 'table' &&
    parent.width * parent.height > child.width * child.height + 5 &&
    child.x >= parent.x - 1 && child.y >= parent.y - 1 &&
    child.x + child.width <= parent.x + parent.width + 1 &&
    child.y + child.height <= parent.y + parent.height + 1));
  // A caption centred immediately below an independent table identifies that
  // table, not the next one. Preserve it as the table title and own it once.
  for (const table of result.filter(s => s.kind === 'table')) {
    const afterRows = rowsOf(items.filter(i =>
      i.y >= table.y + table.height - 1 && i.y < table.y + table.height + i.height * 3 &&
      i.x >= table.x - 3 && i.x + i.width <= table.x + table.width + 3));
    const captions = afterRows.filter(row =>
      /^\(\s*[가-힣A-Z]\s*\)$/.test(textOf(row)) &&
      Math.abs((row[0].x + row.at(-1)!.x + row.at(-1)!.width) / 2 - table.x - table.width / 2) < row[0].height * 1.5);
    if (captions.length === 1) {
      table.title = textOf(captions[0]);
      table.sourceItems = [...items.filter(i => inside(i, table)), ...captions[0]];
    }
    const legends = afterRows.filter(row => /^\(.*[○×].*[:：].*\)$/.test(textOf(row)) &&
      row[0].y < table.y + table.height + row[0].height * 1.8);
    if (legends.length === 1) {
      table.afterText = textOf(legends[0]);
      table.sourceItems = [...(table.sourceItems ?? items.filter(i => inside(i, table))), ...legends[0]];
    }
  }
  return result;
}

/** Borderless answer matrices: locate the five rows, then include aligned headings ABOVE ①. */
export function detectChoiceTable(items: PageText[]): PdfStructure | undefined {
  const lines = rowsOf(items);
  const choices = lines.filter((row) => /^[①②③④⑤]$/.test(row[0].text.trim()));
  if (
    choices.length !== 5 ||
    choices.map((row) => row[0].text.trim()).join('') !== '①②③④⑤'
  )
    return;
  const split = (row: PageText[]) => {
    const cells: PageText[][] = [];
    for (const item of row) {
      const last = cells.at(-1),
        prev = last?.at(-1);
      if (
        prev &&
        !/^[①②③④⑤]$/.test(prev.text) &&
        item.x - prev.x - prev.width < Math.max(7, item.height * 0.8)
      )
        last!.push(item);
      else cells.push([item]);
    }
    return cells;
  };
  const cells = choices.map(split),
    count = cells[0].length;
  if (count < 3 || count > 6 || cells.some((row) => row.length !== count))
    return;
  const centers = cells[0].map(
    (cell) => cell[0].x + (cell.at(-1)!.x + cell.at(-1)!.width - cell[0].x) / 2,
  );
  if (
    cells.some((row) =>
      row.some(
        (cell, c) =>
          Math.abs(cell[0].x - cells[0][c][0].x) > 5 &&
          Math.abs(
            (cell[0].x + cell.at(-1)!.x + cell.at(-1)!.width) / 2 - centers[c],
          ) > Math.max(12, cell[0].height),
      ),
    )
  )
    return;
  const first = choices[0][0],
    last = choices[4][0];
  if (
    choices.some(
      (row, i) =>
        i &&
        (row[0].y - choices[i - 1][0].y > first.height * 3 ||
          Math.abs(row[0].x - first.x) > 5),
    )
  )
    return;
  const boundaries = [
    first.x - 3,
    ...centers.slice(0, -1).map((v, i) => (v + centers[i + 1]) / 2),
    Math.max(...items.map((i) => i.x + i.width)),
  ];
  // A heading is wider than its single-letter answers; its left edge may extend
  // well past the midpoint to the circled-number column.
  boundaries[1] = first.x + first.width + 1;
  const preceding = lines.filter(
    (row) =>
      row[0].y < first.y &&
      row[0].y >= first.y - first.height * 3.4 &&
      !/[?？]|\[\s*[\d.]+\s*점\s*\]/.test(textOf(row)),
  );
  const headers = centers.map((_v, c) =>
    c === 0
      ? ''
      : textOf(
          preceding
            .flat()
            .filter(
              (i) =>
                i.x + i.width / 2 > boundaries[c] &&
                i.x + i.width / 2 < boundaries[c + 1],
            ),
        ).replace(/\n/g, ' '),
  );
  const connector = (c: number) =>
    cells.every((row) => /^[.…⋯·]+$/.test(textOf(row[c]).replace(/\s/g, '')));
  const hasHeader =
    headers.slice(1).filter(Boolean).length >= 2 &&
    headers.slice(1).every((cell, i) => cell.length >= 2 || /^[㉠-㉻ⓐ-ⓩA-Z]$/.test(cell.trim()) || connector(i + 1));
  if (!hasHeader) return; // No invented or arbitrarily cropped heading row.
  const top = Math.min(
    ...preceding
      .flat()
      .filter((i) => i.x > boundaries[1])
      .map((i) => i.y),
  );
  const right = Math.max(
    ...choices.flat().map((i) => i.x + i.width),
    ...preceding.flat().map((i) => i.x + i.width),
  );
  return {
    x: first.x - 3,
    y: top - 1,
    width: right - first.x + 6,
    height: last.y + last.height - top + 2,
    kind: 'table',
    title: '',
    text: '',
    header: true,
    rows: [headers, ...cells.map((row) => row.map((cell) => textOf(cell)))],
  };
}

export function structureQuestionRegion(
  items: PageText[],
  rules: Rule[],
  box: CaptureBox,
  width: number,
  height: number,
  imageStructures: PdfStructure[] = [],
  imageAreas: Area[] = [],
) {
  const area = {
    x: box[0] * width,
    y: box[1] * height,
    width: box[2] * width,
    height: box[3] * height,
  };
  const selected = items.filter((i) => inside(i, area));
  const structures = detectPdfStructures(selected, rules, imageAreas).filter(
    (s) =>
      s.x >= area.x - 2 &&
      s.x + s.width <= area.x + area.width + 2 &&
      s.y >= area.y - 2 &&
      s.y + s.height <= area.y + area.height + 2,
  );
  const choice = detectChoiceTable(selected) ?? detectChoicePanels(selected);
  for(const s of imageStructures) {
    if(s.x>=area.x-2 && s.y>=area.y-2 && s.x+s.width<=area.x+area.width+2 && s.y+s.height<=area.y+area.height+2
      && !structures.some(v=>Math.abs(v.x-s.x)<3 && Math.abs(v.y-s.y)<3 && Math.abs(v.width-s.width)<6 && Math.abs(v.height-s.height)<6)) structures.push(s);
  }
  if (choice && !structures.some((s) => inside(choice, s)))
    structures.push(choice);
  structures.push(...detectDialogue(selected));
  structures.push(...detectRangeBrackets(selected,rules));
  // If a structure cannot be serialized, keep every source item as plain text.
  const accepted = structures.filter(
    (s) => questionTextFromBlocks([s]) !== undefined,
  );
  const contains = (parent: Area, child: Area) =>
    child.x >= parent.x - 1 &&
    child.y >= parent.y - 1 &&
    child.x + child.width <= parent.x + parent.width + 1 &&
    child.y + child.height <= parent.y + parent.height + 1 &&
    parent.width * parent.height > child.width * child.height + 5;
  const parents = new Map(
    accepted.map((child) => [
      child,
      accepted
        .filter((parent) => parent.kind === 'box' && contains(parent, child))
        .sort((a, b) => a.width * a.height - b.width * b.height)[0],
    ]),
  );
  function serialize(
    content: PageText[],
    children: PdfStructure[],
    depth = 0,
  ): string {
    if (depth > 8) return textOf(content);
    const owns = (s: PdfStructure, i: PageText) =>
      s.sourceItems
        ? s.sourceItems.includes(i)
        : inside(i, s, s.kind === 'box' && s.title ? 7 : 0);
    const events: Array<Area & { text: string; orderY?: number }> =
      children.map((s) => {
        const nested = accepted.filter((child) => parents.get(child) === s);
        const text =
          s.kind === 'box' && nested.length
            ? serialize(
                content.filter(
                  (i) => inside(i, s) && (!s.title || i.y > s.y + 4),
                ),
                nested,
                depth + 1,
              )
            : s.text;
        return {
          ...s,
          text:
            (s.inlineContent ?? questionTextFromBlocks([{ ...s, text }]) ??
            textOf(content.filter((i) => inside(i, s)))) + (s.afterText ? `\n${s.afterText}` : ''),
        };
      });
    const outside = content.filter((i) => !children.some((s) => owns(s, i)));
    const inlineRowOrder = new Map<PageText[], number>();
    const outsideRows = parallelProseRows(rowsOf(outside)).flatMap(row=>{
      const small=children.filter(s=>s.inline && row.some(i=>i.y+i.height/2>=s.y && i.y+i.height/2<=s.y+s.height));
      const orderY = Math.min(...row.map(i => i.y));
      for(const s of small) {
        const event=events.find(e=>e.x===s.x && e.y===s.y);
        if(event) event.orderY=orderY;
      }
      if(!small.length) return [row];
      const cuts=small.map(s=>s.x+s.width/2).sort((a,b)=>a-b);
      const groups:PageText[][]=Array.from({length:cuts.length+1},()=>[]);
      for(const item of row) groups[cuts.filter(x=>item.x>x).length].push(item);
      groups.forEach(group => inlineRowOrder.set(group, orderY));
      return groups.filter(g=>g.length);
    });
    events.push(
      ...outsideRows.map((row) => ({
        x: Math.min(...row.map((i) => i.x)),
        y: Math.min(...row.map((i) => i.y)),
        width:
          Math.max(...row.map((i) => i.x + i.width)) -
          Math.min(...row.map((i) => i.x)),
        height:
          Math.max(...row.map((i) => i.y + i.height)) -
          Math.min(...row.map((i) => i.y)),
        text: textOf(row),
        orderY: inlineRowOrder.get(row),
      })),
    );
    events.sort((a, b) => (a.orderY ?? a.y) - (b.orderY ?? b.y) || a.x - b.x);
    // Captions under a side-by-side source image must not split the adjacent
    // paragraph. A label is moved only with measured image ownership and an
    // immediately continuing prose line; it is retained exactly once.
    for (const row of outsideRows) {
      if (!/^(?:\(\s*[가-힣A-Z]\s*\)\s*)+$/.test(textOf(row)) ||
        !row.every(i => imageAreas.some(image =>
          i.x >= image.x - 2 && i.x + i.width <= image.x + image.width + 2 &&
          i.y >= image.y + image.height - 2 &&
          i.y - image.y - image.height <= i.height * 1.5))) continue;
      const at = events.findIndex(e => e.text === textOf(row) && Math.abs(e.y - row[0].y) < 1);
      const previous = events[at - 1];
      if (!previous || previous.text.includes(':::') || /[.!?。？！]\s*$/.test(previous.text) ||
        row[0].y - previous.y > previous.height * 1.8) continue;
      let last = at;
      for (let index = at + 1; index < Math.min(events.length, at + 4); index++) {
        const line = events[index], prior = last === at ? previous : events[last];
        if (line.text.includes(':::') || !/[가-힣]{2}/.test(line.text) ||
          /^(?:[①-⑤]|\[)/.test(line.text) || Math.abs(line.x - previous.x) > previous.height * 2 ||
          line.y - prior.y > Math.max(line.height, prior.height) * 2) break;
        last = index;
        if (/[.!?。？！]\s*$/.test(line.text)) break;
      }
      if (last > at && /[.!?。？！]\s*$/.test(events[last].text)) {
        const label = events.splice(at, 1)[0];
        events.splice(last, 0, label);
      }
    }
    // A left paragraph alongside a right table must finish before that table.
    // Move the table, not the text, past its adjacent paragraph lines.
    for (const child of children) {
      const at = events.findIndex(
        (e) =>
          e.text.startsWith(':::') &&
          Math.abs(e.x - child.x) < 1 &&
          Math.abs(e.y - child.y) < 1,
      );
      if (at < 0) continue;
      const beside = events.filter(
        (e) =>
          !e.text.startsWith(':::') &&
          e.y < child.y + child.height &&
          e.y + e.height > child.y - 2 &&
          (e.x + e.width < child.x || e.x > child.x + child.width),
      );
      if (!child.inline && beside.length >= 2) {
        // Follow the adjacent paragraph to its actual final line. A table can
        // finish before the last word of a sentence, or overlap the beginning
        // of a new paragraph: neither is a reason to cut the sentence in two.
        const sameSide = events.filter(e => !e.text.startsWith(':::') &&
          e.y >= beside[0].y &&
          (e.x + e.width < child.x || e.x > child.x + child.width))
          .sort((a, b) => a.y - b.y);
        const paragraph = [sameSide[0]];
        for (const line of sameSide.slice(1)) {
          const previous = paragraph.at(-1)!;
          if (line.y - previous.y > Math.max(previous.height, line.height) * 1.8 ||
            /^\s*(?:\([가-힣]\)|\(\s*[가-힣]\s*\)|[ㄱ-ㅎ]\s*[.)]|\[)/.test(line.text)) break;
          paragraph.push(line);
          if (/[.!?。？！]\s*$/.test(line.text) && line.y >= child.y) break;
        }
        const e = events[at];
        events.splice(at, 1);
        const last = Math.max(...paragraph.map((line) => events.indexOf(line)));
        events.splice(last + 1, 0, e);
      }
    }
    return events.map((e, index) => `${index && e.orderY !== undefined &&
      events[index - 1].orderY === e.orderY && !e.text.includes(':::') &&
      !events[index - 1].text.includes(':::') ? ' ' : index ? '\n' : ''}${e.text}`).join('');
  }
  return {
    text: serialize(
      selected,
      accepted.filter((s) => !parents.get(s)),
    ),
    structures: accepted,
  };
}
