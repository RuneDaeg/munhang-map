import type { CaptureBox, PageText } from './pdf-layout';

type Area = { x: number; y: number; width: number; height: number };
export type PdfImageArea = Area & { id: string };
type Operators = { fnArray: number[]; argsArray: unknown[][] };
const mul = (a: number[], b: number[]) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

/** Image XObjects may be blank grids with separate text painted above them. */
export function pdfImageAreas(
  list: Operators,
  ops: Record<string, number>,
  viewport: number[],
): PdfImageArea[] {
  let matrix = [...viewport];
  const stack: number[][] = [],
    result: PdfImageArea[] = [];
  list.fnArray.forEach((op, index) => {
    const args = list.argsArray[index];
    if (op === ops.save) stack.push([...matrix]);
    else if (op === ops.restore) matrix = stack.pop() ?? [...viewport];
    else if (op === ops.transform) matrix = mul(matrix, args as number[]);
    else if (
      op === ops.paintImageXObject ||
      op === ops.paintInlineImageXObject
    ) {
      const points = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([x, y]) => [
        matrix[0] * x + matrix[2] * y + matrix[4],
        matrix[1] * x + matrix[3] * y + matrix[5],
      ]);
      const x = Math.min(...points.map((p) => p[0])),
        y = Math.min(...points.map((p) => p[1]));
      result.push({
        id: typeof args[0] === 'string' ? args[0] : `inline-${index}`,
        x,
        y,
        width: Math.max(...points.map((p) => p[0])) - x,
        height: Math.max(...points.map((p) => p[1])) - y,
      });
    }
  });
  return result;
}

/** Require all five markers and one distinct image per marker; never guess cells. */
export function locateVisualChoices(
  items: PageText[],
  images: PdfImageArea[],
  box: CaptureBox,
  width: number,
  height: number,
) {
  const [x, y, w, h] = [
    box[0] * width,
    box[1] * height,
    box[2] * width,
    box[3] * height,
  ];
  const within = (r: Area) =>
    r.x >= x - 1 &&
    r.y >= y - 1 &&
    r.x + r.width <= x + w + 1 &&
    r.y + r.height <= y + h + 1;
  const markers = items.filter((r) => within(r) && /^[①②③④⑤]$/.test(r.text));
  if (markers.length !== 5 || new Set(markers.map((r) => r.text)).size !== 5)
    return [];
  const candidates = images.filter(
    (r) =>
      within(r) &&
      r.width > w * 0.12 &&
      r.width < w * 0.75 &&
      r.height > 10 &&
      r.height < h * 0.5,
  );
  const used = new Set<PdfImageArea>();
  const result: Array<{ label: string; box: CaptureBox }> = [];
  for (const marker of markers.sort((a, b) => a.text.localeCompare(b.text))) {
    const near = candidates
      .filter(
        (r) =>
          !used.has(r) &&
          r.x >= marker.x + marker.width - 3 &&
          r.x - marker.x - marker.width < marker.height * 3 &&
          marker.y + marker.height / 2 >= r.y - marker.height &&
          marker.y < r.y + r.height,
      )
      .sort((a, b) => Math.abs(a.y - marker.y) - Math.abs(b.y - marker.y));
    if (!near.length || (near[1] && Math.abs(near[0].y - near[1].y) < 1))
      return [];
    const image = near[0];
    used.add(image);
    const left = Math.max(x, marker.x - 2),
      top = Math.max(y, Math.min(marker.y, image.y) - 2);
    const right = Math.min(x + w, image.x + image.width + 3),
      bottom = Math.min(
        y + h,
        Math.max(marker.y + marker.height, image.y + image.height) + 3,
      );
    result.push({
      label: marker.text,
      box: [
        left / width,
        top / height,
        (right - left) / width,
        (bottom - top) / height,
      ],
    });
  }
  return result;
}
