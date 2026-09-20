import type { PageText } from './pdf-layout';
import type { PdfImageArea } from './pdf-visual-choices';
import type { PdfStructure } from './pdf-structures';
import { styledItemText } from './pdf-source-formatting';
import { detectMaterialFrames } from './pdf-material-frames';

/** Some writers tile one illustration into touching strips. This joins only
 * aligned, gap-free rectangles; detection still has to prove the outer frame. */
export function joinImageTiles(images: PdfImageArea[]): PdfImageArea[] {
  const result = images.filter(a=>a.width>0 && a.height>0).map(a=>({...a}));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i=0; i<result.length && !changed; i++) for (let j=i+1; j<result.length; j++) {
      const a=result[i], b=result[j];
      const vertical = Math.abs(a.x-b.x)<.5 && Math.abs(a.width-b.width)<.5 &&
        Math.min(Math.abs(a.y+a.height-b.y),Math.abs(b.y+b.height-a.y))<.5;
      const horizontal = Math.abs(a.y-b.y)<.5 && Math.abs(a.height-b.height)<.5 &&
        Math.min(Math.abs(a.x+a.width-b.x),Math.abs(b.x+b.width-a.x))<.5;
      if (!vertical && !horizontal) continue;
      const x=Math.min(a.x,b.x), y=Math.min(a.y,b.y);
      result[i]={id:`${a.id}+${b.id}`,x,y,width:Math.max(a.x+a.width,b.x+b.width)-x,height:Math.max(a.y+a.height,b.y+b.height)-y};
      result.splice(j,1);changed=true;break;
    }
  }
  return result;
}

const inside = (i: PageText, a: PdfImageArea) =>
  i.x + i.width / 2 > a.x &&
  i.x + i.width / 2 < a.x + a.width &&
  i.y + i.height / 2 > a.y &&
  i.y + i.height / 2 < a.y + a.height;
const textOf = (items: PageText[]) => {
  const rows: PageText[][] = [];
  for (const i of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find(
      (r) => Math.abs(r[0].y - i.y) < Math.max(2.5, i.height * 0.32),
    );
    if (row) row.push(i);
    else rows.push([i]);
  }
  return rows
    .map((r) =>
      r
        .sort((a, b) => a.x - b.x)
        .map(styledItemText)
        .join(' '),
    )
    .join('\n');
};

/** Read straight raster borders after masking the separate PDF text layer.
 * Text is never OCR-guessed. The image must supply all four outer borders;
 * a graph/photograph or an unbounded paragraph is not promoted to a table.
 */
export function detectRasterStructure(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  area: PdfImageArea,
  items: PageText[],
): PdfStructure | undefined {
  const content = items.filter((i) => inside(i, area));
  if (
    content.length < 8 ||
    content.filter((i) => /[가-힣A-Za-z]{2}/.test(i.text)).length < 5 ||
    w < 30 ||
    h < 20
  )
    return;
  const mask = new Uint8Array(w * h);
  for (const i of content) {
    const x0 = Math.max(0, Math.floor(((i.x - area.x) / area.width) * w) - 1),
      x1 = Math.min(
        w,
        Math.ceil(((i.x + i.width - area.x) / area.width) * w) + 1,
      );
    const y0 = Math.max(0, Math.floor(((i.y - area.y) / area.height) * h) - 1),
      y1 = Math.min(
        h,
        Math.ceil(((i.y + i.height - area.y) / area.height) * h) + 1,
      );
    for (let y = y0; y < y1; y++) mask.fill(1, y * w + x0, y * w + x1);
  }
  const dark = (x: number, y: number) =>
    !mask[y * w + x] &&
    data[(y * w + x) * 4 + 3] > 200 &&
    Math.max(
      data[(y * w + x) * 4],
      data[(y * w + x) * 4 + 1],
      data[(y * w + x) * 4 + 2],
    ) < 180;
  const lines = (vertical: boolean) => {
    const n = vertical ? w : h,
      length = vertical ? h : w,
      found: number[] = [];
    for (let a = 0; a < n; a++) {
      let hits = 0,
        first = -1,
        last = -1,
        gap = 0,
        longestGap = 0;
      for (let b = 0; b < length; b++) {
        if (vertical ? dark(a, b) : dark(b, a)) {
          hits++;
          if (first < 0) first = b;
          last = b;
          longestGap = Math.max(longestGap, gap);
          gap = 0;
        } else if (first >= 0) gap++;
      }
      if (
        hits >= length * 0.55 ||
        (hits >= length * 0.18 &&
          last - first >= length * 0.85 &&
          longestGap < length * 0.06)
      )
        found.push(a);
    }
    const clusters: number[][] = [];
    for (const p of found) {
      if (clusters.length && p - clusters.at(-1)!.at(-1)! <= 3)
        clusters.at(-1)!.push(p);
      else clusters.push([p]);
    }
    return clusters.map((c) => c[Math.floor(c.length / 2)]);
  };
  const xs = lines(true),
    ys = lines(false);
  if (xs.length < 2 || ys.length < 2 || xs.length > 12 || ys.length > 40)
    return;
  if (
    xs[0] > w * 0.15 ||
    xs.at(-1)! < w * 0.85 ||
    ys[0] > h * 0.15 ||
    ys.at(-1)! < h * 0.85
  )
    return;
  const columns = [0, ...xs.slice(1, -1), w],
    rows = [0, ...ys.slice(1, -1), h];
  const cells = rows.slice(0, -1).map((y, r) =>
    columns.slice(0, -1).map((x, c) =>
      textOf(
        content.filter((i) => {
          const cx = ((i.x + i.width / 2 - area.x) / area.width) * w,
            cy = ((i.y + i.height / 2 - area.y) / area.height) * h;
          return cx >= x && cx < columns[c + 1] && cy >= y && cy < rows[r + 1];
        }),
      ),
    ),
  );
  if (cells.flat().some((c) => !c.trim())) return;
  const isBox = cells.length === 1 && cells[0].length === 1;
  return {
    ...area,
    kind: isBox ? 'box' : 'table',
    title: '',
    text: isBox ? textOf(content) : '',
    rows: isBox
      ? []
      : cells.map((row) => row.map((cell) => cell.replace(/\n/g, ' '))),
    header: false,
    sourceItems: content,
  };
}

export async function imageTextStructures(
  pageImage: string,
  pageWidth: number,
  pageHeight: number,
  images: PdfImageArea[],
  items: PageText[],
) {
  const candidates = [...images, ...joinImageTiles(images)].filter(
    (a) =>
      a.width > 30 &&
      a.height > 20 &&
      a.width < pageWidth * 0.8 &&
      a.height < pageHeight * 0.8 &&
      items.filter((i) => inside(i, a)).length >= 8,
  ).filter((area,index,all)=>!all.slice(0,index).some(prior=>
    Math.abs(prior.x-area.x)<.1 && Math.abs(prior.y-area.y)<.1 &&
    Math.abs(prior.width-area.width)<.1 && Math.abs(prior.height-area.height)<.1));
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () =>
      reject(new Error('원문 이미지의 표 경계를 읽지 못했습니다.'));
    image.src = pageImage;
  });
  const fullCanvas = document.createElement('canvas');
  const scale = Math.min(2, 1600 / pageWidth, 2200 / pageHeight);
  fullCanvas.width = Math.ceil(pageWidth * scale);
  fullCanvas.height = Math.ceil(pageHeight * scale);
  const fullContext = fullCanvas.getContext('2d');
  const result: PdfStructure[] = [];
  if (fullContext) {
    fullContext.drawImage(image,0,0,fullCanvas.width,fullCanvas.height);
    result.push(...detectMaterialFrames(fullContext.getImageData(0,0,fullCanvas.width,fullCanvas.height).data,
      fullCanvas.width,fullCanvas.height,pageWidth,pageHeight,items));
  }
  fullCanvas.width = fullCanvas.height = 1;
  const confirmed: PdfImageArea[] = [];
  for (const area of candidates) {
    // Already complete adjacent cards are not fragments of a larger table.
    if (confirmed.some(prior=>prior.x>=area.x-.5 && prior.y>=area.y-.5 &&
      prior.x+prior.width<=area.x+area.width+.5 && prior.y+prior.height<=area.y+area.height+.5)) continue;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(area.width * 2);
    canvas.height = Math.ceil(area.height * 2);
    const context = canvas.getContext('2d');
    if (!context) continue;
    context.drawImage(
      image,
      (area.x / pageWidth) * image.width,
      (area.y / pageHeight) * image.height,
      (area.width / pageWidth) * image.width,
      (area.height / pageHeight) * image.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const structure = detectRasterStructure(
      context.getImageData(0, 0, canvas.width, canvas.height).data,
      canvas.width,
      canvas.height,
      area,
      items,
    );
    if (structure) {
      confirmed.push(area);
      // A straight grid has stronger cell evidence than the material fallback.
      // Avoid duplicate boxes around exactly the same source paragraph.
      const contents = new Set(structure.sourceItems);
      const duplicate = result.findIndex(frame=>frame.sourceItems?.length &&
        frame.sourceItems.length >= contents.size * .9 && frame.sourceItems.every(item=>contents.has(item)));
      if (duplicate >= 0) result.splice(duplicate,1,structure);
      else result.push(structure);
    }
    canvas.width = canvas.height = 1;
  }
  return result;
}
