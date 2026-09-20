import type { PageText } from './pdf-layout';
import type { PdfStructure } from './pdf-structures';
import { styledItemText } from './pdf-source-formatting';

type Area = { x: number; y: number; width: number; height: number };

const rowsOf = (items: PageText[]) => {
  const rows: PageText[][] = [];
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find(row => Math.abs(row[0].y - item.y) < Math.max(2.5, item.height * .32));
    if (row) row.push(item); else rows.push([item]);
  }
  return rows.map(row => row.sort((a, b) => a.x - b.x));
};

/** Recover actual enclosed light interiors, not a guessed rectangular template.
 * Text is supplied by the PDF; this is boundary detection, never OCR. Removing
 * the text strokes lets a speech bubble remain one connected interior while
 * its outline keeps neighbouring speakers separate. Only prose-heavy interiors
 * become boxes. Photographs, chart labels, and an unbounded page stay images.
 */
export function detectMaterialFrames(
  data: Uint8ClampedArray, width: number, height: number,
  pageWidth: number, pageHeight: number, items: PageText[],
): PdfStructure[] {
  if (width < 20 || height < 20 || width * height > 8_000_000 || data.length !== width * height * 4) return [];
  const sx = width / pageWidth, sy = height / pageHeight;
  const light = new Uint8Array(width * height);
  for (let i = 0; i < light.length; i++) light[i] = data[i * 4 + 3] > 200 &&
    Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) >= 220 ? 1 : 0;
  for (const item of items) {
    const left = Math.max(0, Math.floor(item.x * sx)), right = Math.min(width, Math.ceil((item.x + item.width) * sx));
    const top = Math.max(0, Math.floor(item.y * sy)), bottom = Math.min(height, Math.ceil((item.y + item.height) * sy));
    for (let y = top; y < bottom; y++) light.fill(1, y * width + left, y * width + right);
  }
  // Close only sub-glyph raster gaps (antialiasing and text/border contact), not
  // white gutters between cards. Two separable passes keep page scans linear.
  const radius = Math.max(1, Math.min(3, Math.ceil(Math.min(sx, sy) * 1.1)));
  const horizontal = light.slice(), original = light.slice();
  for (let y = radius; y < height - radius; y++) {
    let dark = 0;
    for (let x = 0; x < radius * 2; x++) dark += 1 - original[y * width + x];
    for (let x = radius; x < width - radius; x++) {
      dark += 1 - original[y * width + x + radius];
      horizontal[y * width + x] = dark ? 0 : 1;
      dark -= 1 - original[y * width + x - radius];
    }
  }
  for (let x = radius; x < width - radius; x++) {
    let dark = 0;
    for (let y = 0; y < radius * 2; y++) dark += 1 - horizontal[y * width + x];
    for (let y = radius; y < height - radius; y++) {
      dark += 1 - horizontal[(y + radius) * width + x];
      light[y * width + x] = dark ? 0 : 1;
      dark -= 1 - horizontal[(y - radius) * width + x];
    }
  }
  const labels = new Int32Array(light.length), queue = new Int32Array(light.length);
  const regions: Array<Area & { id: number; size: number; edge: boolean }> = [];
  let id = 0;
  for (let at = 0; at < light.length; at++) {
    if (!light[at] || labels[at]) continue;
    id++;
    let read = 0, end = 1, left = width, right = 0, top = height, bottom = 0, edge = false;
    queue[0] = at; labels[at] = id;
    while (read < end) {
      const p = queue[read++], x = p % width, y = Math.floor(p / width);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      if (!x || !y || x === width - 1 || y === height - 1) edge = true;
      for (const n of [x ? p - 1 : -1, x + 1 < width ? p + 1 : -1, y ? p - width : -1, y + 1 < height ? p + width : -1]) {
        if (n >= 0 && light[n] && !labels[n]) { labels[n] = id; queue[end++] = n; }
      }
    }
    if (!edge && right - left > sx * 28 && bottom - top > sy * 18 && end > 600 &&
      right - left < width * .8 && bottom - top < height * .85)
      regions.push({ id, x: left / sx, y: top / sy, width: (right - left + 1) / sx, height: (bottom - top + 1) / sy, size: end, edge });
  }
  const owned = new Map<number, PageText[]>();
  for (const item of items) {
    const x = Math.max(0, Math.min(width - 1, Math.floor((item.x + item.width / 2) * sx)));
    const y = Math.max(0, Math.min(height - 1, Math.floor((item.y + item.height / 2) * sy)));
    const key = labels[y * width + x];
    if (!owned.has(key)) owned.set(key, []);
    owned.get(key)!.push(item);
  }
  const result: PdfStructure[] = [];
  for (const region of regions) {
    const content = owned.get(region.id) ?? [], rows = rowsOf(content);
    const text = rows.map(row => row.map(styledItemText).join(' ')).join('\n');
    // Multiple whole prose lines are evidence of a material paragraph. Sparse
    // place names, axes, legends and isolated answer labels are not enough.
    const proseRows = rows.filter(row => (row.map(i => i.text).join('').match(/[가-힣A-Za-z\u3400-\u9fff]/g)?.length ?? 0) >= 9);
    if (content.length < 4 || proseRows.length < 2 || text.replace(/\s|<\/?[bu]>/g, '').length < 24 ||
      rows.some(row => /^\s*(?:[①-⑤]|\d{1,2}\s*[.)])/.test(row.map(i=>i.text).join(' ')))) continue;
    // Solid photo texture can leave small white islands. Real document interiors
    // are predominantly light, even when a picture is nested inside the card.
    if (region.size / (region.width * sx * region.height * sy) < .36) continue;
    result.push({ x: region.x, y: region.y, width: region.width, height: region.height,
      kind: 'box', title: '', text, rows: [], header: false, sourceItems: content });
  }
  // A shaded heading or text over an embedded image is part of its enclosing
  // card even when it belongs to a different light component. Prefer an actual
  // smaller material interior first, so parallel callouts keep separate owners.
  const contains = (area: Area, item: PageText) => item.x + item.width / 2 >= area.x &&
    item.x + item.width / 2 <= area.x + area.width && item.y + item.height / 2 >= area.y &&
    item.y + item.height / 2 <= area.y + area.height;
  const sorted = [...result].sort((a,b)=>a.width*a.height-b.width*b.height);
  const owners = new Map<PageText, PdfStructure>();
  for (const item of items) {
    const owner = sorted.find(area=>contains(area,item));
    if (owner) owners.set(item, owner);
  }
  for (const frame of result) {
    frame.sourceItems = items.filter(item=>owners.get(item)===frame);
    frame.text = rowsOf(frame.sourceItems).map(row=>row.map(styledItemText).join(' ')).join('\n');
  }
  return result.sort((a,b)=>a.y-b.y || a.x-b.x);
}
