import type { CaptureBox, PageText } from './pdf-layout';
import { questionTextFromBlocks } from './question-content';
import { detectChoicePanels, detectDialogue } from './pdf-reading-order';

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
    .map((row) => row.map((item) => item.text).join(' '))
    .join('\n');
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

/** Conservative geometry recovery, including a split top border around a 보기 heading. */
export function detectPdfStructures(
  items: PageText[],
  rules: Rule[],
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
  const found: PdfStructure[] = [];
  for (const group of groups) {
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
      xs.at(-1)! - xs[0] < 30 ||
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
    const content = items.filter((i) => inside(i, area));
    const ys = unique([
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
      xs.length >= 3 &&
      ys.length >= 3 &&
      xs.length <= 17 &&
      ys.length <= 81
    ) {
      const rows = ys.slice(0, -1).map((y, r) =>
        xs.slice(0, -1).map((x, c) =>
          textOf(
            content.filter((i) =>
              inside(i, {
                x,
                y,
                width: xs[c + 1] - x,
                height: ys[r + 1] - y,
              }),
            ),
          ).replace(/\n/g, ' '),
        ),
      );
      if (rows.flat().filter(Boolean).length >= 4) {
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
      if (text.replace(/\s/g, '').length >= 30 && prose)
        found.push({
          ...area,
          kind: 'box',
          text,
          title: isView ? '<보기>' : '',
          rows: [],
          header: false,
        });
    }
  }
  // Keep enclosing boxes as well as their child grids. Serialization assigns
  // each source item to the innermost owner, so content is emitted only once.
  return found;
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
    headers.slice(1).every((cell, i) => cell.length >= 2 || connector(i + 1));
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
) {
  const area = {
    x: box[0] * width,
    y: box[1] * height,
    width: box[2] * width,
    height: box[3] * height,
  };
  const selected = items.filter((i) => inside(i, area));
  const structures = detectPdfStructures(selected, rules).filter(
    (s) =>
      s.x >= area.x - 2 &&
      s.x + s.width <= area.x + area.width + 2 &&
      s.y >= area.y - 2 &&
      s.y + s.height <= area.y + area.height + 2,
  );
  const choice = detectChoiceTable(selected) ?? detectChoicePanels(selected);
  if (choice && !structures.some((s) => inside(choice, s)))
    structures.push(choice);
  structures.push(...detectDialogue(selected));
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
            questionTextFromBlocks([{ ...s, text }]) ??
            textOf(content.filter((i) => inside(i, s))),
        };
      });
    const outside = content.filter((i) => !children.some((s) => owns(s, i)));
    events.push(
      ...rowsOf(outside).map((row) => ({
        x: Math.min(...row.map((i) => i.x)),
        y: Math.min(...row.map((i) => i.y)),
        width:
          Math.max(...row.map((i) => i.x + i.width)) -
          Math.min(...row.map((i) => i.x)),
        height:
          Math.max(...row.map((i) => i.y + i.height)) -
          Math.min(...row.map((i) => i.y)),
        text: textOf(row),
      })),
    );
    events.sort((a, b) => (a.orderY ?? a.y) - (b.orderY ?? b.y) || a.x - b.x);
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
      if (beside.length >= 2) {
        const e = events[at];
        events.splice(at, 1);
        const last = Math.max(...beside.map((line) => events.indexOf(line)));
        events.splice(last + 1, 0, e);
      }
    }
    return events.map((e) => e.text).join('\n');
  }
  return {
    text: serialize(
      selected,
      accepted.filter((s) => !parents.get(s)),
    ),
    structures: accepted,
  };
}
