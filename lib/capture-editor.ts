import type { CaptureBox } from './pdf-layout';

export type Point = [number, number];
export type DragMode = 'draw' | 'move' | 'nw' | 'ne' | 'sw' | 'se';
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

export function validCaptureBox(value: unknown): value is CaptureBox {
  return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number' && Number.isFinite(n)) && value[0] >= 0 && value[1] >= 0 && value[2] >= 0.005 && value[3] >= 0.005 && value[0] + value[2] <= 1.000001 && value[1] + value[3] <= 1.000001;
}

export function dragCaptureBox(box: CaptureBox, origin: Point, point: Point, mode: DragMode): CaptureBox {
  const px = clamp(point[0]), py = clamp(point[1]);
  if (mode === 'draw') return [Math.min(origin[0], px), Math.min(origin[1], py), Math.abs(origin[0] - px), Math.abs(origin[1] - py)];
  if (mode === 'move') return [clamp(box[0] + px - origin[0], 0, 1 - box[2]), clamp(box[1] + py - origin[1], 0, 1 - box[3]), box[2], box[3]];
  let [left, top, width, height] = box;
  let right = left + width, bottom = top + height;
  if (mode.includes('w')) left = clamp(px, 0, right - 0.005);
  if (mode.includes('e')) right = clamp(px, left + 0.005, 1);
  if (mode.includes('n')) top = clamp(py, 0, bottom - 0.005);
  if (mode.includes('s')) bottom = clamp(py, top + 0.005, 1);
  width = right - left; height = bottom - top;
  return [left, top, width, height];
}

export function setCaptureEdge(box: CaptureBox, edge: 'left' | 'top' | 'right' | 'bottom', value: number): CaptureBox {
  const [x, y, w, h] = box;
  const point: Point = edge === 'left' ? [value, y] : edge === 'top' ? [x, value] : edge === 'right' ? [value, y + h] : [x + w, value];
  return dragCaptureBox(box, [x, y], point, edge === 'left' || edge === 'top' ? 'nw' : 'se');
}
