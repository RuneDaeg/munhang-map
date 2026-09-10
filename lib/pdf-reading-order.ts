import type { PageText } from './pdf-layout';
import type { PdfStructure } from './pdf-structures';

const median = (ns: number[]) =>
  [...ns].sort((a, b) => a - b)[Math.floor(ns.length / 2)] || 8;
const bounds = (items: PageText[]) => ({
  x: Math.min(...items.map((i) => i.x)),
  y: Math.min(...items.map((i) => i.y)),
  right: Math.max(...items.map((i) => i.x + i.width)),
  bottom: Math.max(...items.map((i) => i.y + i.height)),
});
function rows(items: PageText[]) {
  const out: PageText[][] = [];
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = out.find(
      (r) => Math.abs(r[0].y - item.y) < Math.max(2.5, item.height * 0.32),
    );
    if (row) row.push(item);
    else out.push([item]);
  }
  return out.map((r) => r.sort((a, b) => a.x - b.x));
}
const textOf = (items: PageText[]) =>
  rows(items)
    .map((row) => row.map((i) => i.text).join(' '))
    .join('\n');

/** Components stop at the white gutters between adjacent speech bubbles. */
function paragraphs(items: PageText[]) {
  const parent = items.map((_, i) => i);
  const root = (i: number): number =>
    parent[i] === i ? i : (parent[i] = root(parent[i]));
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i],
        b = items[j],
        h = Math.min(a.height, b.height);
      const dx = Math.max(a.x - b.x - b.width, b.x - a.x - a.width, 0),
        dy = Math.max(a.y - b.y - b.height, b.y - a.y - a.height, 0);
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
        oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (
        (oy >= h * 0.5 && dx <= h * 0.9) ||
        (ox >= Math.min(a.width, b.width) * 0.2 && dy <= h * 0.7)
      )
        parent[root(j)] = root(i);
    }
  const components = new Map<number, PageText[]>();
  items.forEach((item, n) => {
    const key = root(n);
    if (!components.has(key)) components.set(key, []);
    components.get(key)!.push(item);
  });
  return [...components.values()];
}

/** Preserve whole speakers' paragraphs. Only consume explicitly matched items. */
export function detectDialogue(items: PageText[]): PdfStructure[] {
  if (!items.length) return [];
  const h = median(items.map((i) => i.height)),
    area = bounds(items);
  const labels: Array<
    ReturnType<typeof bounds> & { text: string; items: PageText[] }
  > = [];
  for (const item of items) {
    if (item.text === '교사')
      labels.push({ text: '교사', items: [item], ...bounds([item]) });
    if (item.text !== '학생') continue;
    const next = items.find(
      (i) =>
        /^[A-E]$/.test(i.text) &&
        Math.abs(i.y - item.y) < h * 0.7 &&
        i.x >= item.x + item.width - 1 &&
        i.x < item.x + item.width + h,
    );
    if (next)
      labels.push({
        text: `학생 ${next.text}`,
        items: [item, next],
        ...bounds([item, next]),
      });
  }
  if (labels.filter((l) => l.text.startsWith('학생')).length < 2) return [];
  const labelItems = new Set(labels.flatMap((l) => l.items));
  const blocks = paragraphs(items.filter((i) => !labelItems.has(i)))
    .map((part) => ({ part, ...bounds(part) }))
    .filter(
      (b) =>
        rows(b.part).length >= 2 &&
        b.right - b.x < (area.right - area.x) * 0.8 &&
        (textOf(b.part).match(/[가-힣]{2,}/g)?.length || 0) >= 3,
    );
  const orientations = new Map<(typeof labels)[number], 'left' | 'right'>();
  for (const label of labels) {
    const column = labels.filter(
      (l) => Math.abs(l.x - label.x) < h && l.text.startsWith('학생'),
    );
    if (column.length < 2) continue;
    const count = (dir: string) =>
      column.filter((l) =>
        blocks.some(
          (b) =>
            Math.abs((l.y + l.bottom) / 2 - (b.y + b.bottom) / 2) <
              (b.bottom - b.y) / 2 + h * 2 &&
            (dir === 'right'
              ? b.x > l.right && b.x - l.right < h * 9
              : b.right < l.x && l.x - b.right < h * 9),
        ),
      ).length;
    const right = count('right'),
      left = count('left');
    if (right >= 2 && right > left) orientations.set(label, 'right');
    else if (left >= 2 && left > right) orientations.set(label, 'left');
  }
  const matches: Array<PdfStructure & { textTop: number; textBottom: number }> =
      [],
    used = new Set<(typeof blocks)[number]>();
  for (const label of labels) {
    const candidates = blocks
      .filter((b) => !used.has(b))
      .flatMap((b) => {
        const cx = (label.x + label.right) / 2,
          cy = (label.y + label.bottom) / 2,
          orientation = orientations.get(label);
        const dy = Math.max(b.y - cy, cy - b.bottom, 0),
          dx = Math.max(b.x - label.right, label.x - b.right, 0);
        const below =
          label.y >= b.bottom - h * 0.6 &&
          label.y - b.bottom < h * 10 &&
          cx >= b.x - h &&
          cx <= b.right + h;
        const beside =
          dy < h * 1.4 &&
          dx < h * 9 &&
          (orientation !== 'right' || b.x >= label.right) &&
          (orientation !== 'left' || b.right <= label.x);
        return below || beside
          ? [
              {
                b,
                score: below
                  ? label.y -
                    b.bottom +
                    Math.abs(cx - (b.x + b.right) / 2) * 0.5
                  : dx + dy * 2,
              },
            ]
          : [];
      })
      .sort((a, b) => a.score - b.score);
    if (!candidates.length) continue;
    const b = candidates[0].b;
    used.add(b);
    const bb = bounds([...b.part, ...label.items]);
    matches.push({
      kind: 'box',
      title: label.text,
      text: textOf(b.part),
      rows: [],
      header: false,
      x: bb.x,
      y: bb.y,
      width: bb.right - bb.x,
      height: bb.bottom - bb.y,
      sourceItems: [...b.part, ...label.items],
      textTop: b.y,
      textBottom: b.bottom,
    });
  }
  if (matches.length < 2) return [];
  for (const b of blocks.filter((b) => !used.has(b))) {
    if (
      matches.some(
        (m) =>
          Math.min(m.textBottom, b.bottom) - Math.max(m.textTop, b.y) >
          Math.min(m.textBottom - m.textTop, b.bottom - b.y) * 0.5,
      )
    )
      matches.push({
        kind: 'box',
        title: '',
        text: textOf(b.part),
        rows: [],
        header: false,
        x: b.x,
        y: b.y,
        width: b.right - b.x,
        height: b.bottom - b.y,
        sourceItems: b.part,
        textTop: b.y,
        textBottom: b.bottom,
      });
  }
  for (const b of matches) {
    const peers = matches.filter(
      (a) =>
        Math.min(a.textBottom, b.textBottom) - Math.max(a.textTop, b.textTop) >
        Math.min(a.textBottom - a.textTop, b.textBottom - b.textTop) * 0.5,
    );
    b.orderY =
      peers.length >= 2 ? Math.min(...peers.map((p) => p.textTop)) : b.textTop;
  }
  return matches.sort((a, b) => a.orderY! - b.orderY! || a.x - b.x);
}

/** Two side-by-side choice panels become one table only with matching headers. */
export function detectChoicePanels(
  items: PageText[],
): PdfStructure | undefined {
  const markers = items.filter((i) => /^[①②③④⑤]$/.test(i.text));
  if (markers.length !== 5 || new Set(markers.map((i) => i.text)).size !== 5)
    return;
  const h = median(markers.map((i) => i.height)),
    columns: PageText[][] = [];
  for (const marker of [...markers].sort((a, b) => a.x - b.x)) {
    const column = columns.find((c) => Math.abs(c[0].x - marker.x) < h);
    if (column) column.push(marker);
    else columns.push([marker]);
  }
  if (columns.length !== 2 || columns.some((c) => c.length < 2)) return;
  columns.sort((a, b) => a[0].x - b[0].x);
  if (
    Math.abs(
      Math.min(...columns[0].map((i) => i.y)) -
        Math.min(...columns[1].map((i) => i.y)),
    ) > h
  )
    return;
  const panels: Array<{
    headers: string[];
    values: string[][];
    source: PageText[];
  }> = [];
  for (let ci = 0; ci < columns.length; ci++) {
    const markers = columns[ci].sort((a, b) => a.y - b.y),
      left = markers[0].x - 2,
      right =
        ci + 1 < columns.length
          ? columns[ci + 1][0].x - h * 0.5
          : Math.max(...items.map((i) => i.x + i.width)) + 1;
    if (markers.some((m, i) => i && m.y - markers[i - 1].y > h * 4)) return;
    const top = Math.min(...markers.map((i) => i.y)),
      bottom = Math.max(...markers.map((i) => i.y + i.height));
    const header = items.filter(
      (i) =>
        i.x >= left &&
        i.x + i.width / 2 < right &&
        i.y >= top - h * 2.5 &&
        i.y + i.height < top + 1 &&
        !/^[①②③④⑤]$/.test(i.text),
    );
    const groups: PageText[][] = [];
    for (const item of header.sort((a, b) => a.x - b.x)) {
      const prev = groups.at(-1)?.at(-1);
      if (prev && item.x - prev.x - prev.width < h * 0.65)
        groups.at(-1)!.push(item);
      else groups.push([item]);
    }
    if (
      groups.length < 2 ||
      groups.length > 5 ||
      groups.some((g) => textOf(g).replace(/\s/g, '').length < 2)
    )
      return;
    const centers = groups.map((g) => {
      const b = bounds(g);
      return (b.x + b.right) / 2;
    });
    const boundaries = [
      markers[0].x + markers[0].width + 1,
      ...centers.slice(0, -1).map((x, i) => (x + centers[i + 1]) / 2),
      right,
    ];
    const source = [...header, ...markers];
    const values = markers.map((m, r) => {
      const lo = r
          ? (markers[r - 1].y + markers[r - 1].height + m.y) / 2
          : top - h * 0.5,
        hi =
          r + 1 < markers.length
            ? (m.y + m.height + markers[r + 1].y) / 2
            : bottom + h * 0.6;
      const cells = centers.map((_, c) =>
        items.filter(
          (i) =>
            i.x + i.width / 2 >= boundaries[c] &&
            i.x + i.width / 2 < boundaries[c + 1] &&
            i.y + i.height / 2 >= lo &&
            i.y + i.height / 2 < hi,
        ),
      );
      if (cells.some((cell) => !cell.length)) return null;
      source.push(...cells.flat());
      return [m.text, ...cells.map((cell) => textOf(cell).replace(/\n/g, ' '))];
    });
    if (values.some((v) => !v)) return;
    panels.push({
      headers: ['', ...groups.map(textOf)],
      values: values as string[][],
      source,
    });
  }
  if (JSON.stringify(panels[0].headers) !== JSON.stringify(panels[1].headers))
    return;
  const sourceItems = [...new Set(panels.flatMap((p) => p.source))],
    bb = bounds(sourceItems);
  return {
    kind: 'table',
    title: '',
    text: '',
    header: true,
    rows: [
      panels[0].headers,
      ...panels
        .flatMap((p) => p.values)
        .sort((a, b) => '①②③④⑤'.indexOf(a[0]) - '①②③④⑤'.indexOf(b[0])),
    ],
    sourceItems,
    x: bb.x,
    y: bb.y,
    width: bb.right - bb.x,
    height: bb.bottom - bb.y,
  };
}
