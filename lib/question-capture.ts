import type { CaptureBox } from './pdf-layout';

export type QuestionCapture = { page: number; box: CaptureBox; image: string };

export async function cropPage(image: string, box: CaptureBox) {
  const source = await loadImage(image);
  const [x, y, width, height] = box;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.naturalWidth * width));
  canvas.height = Math.max(1, Math.round(source.naturalHeight * height));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('문항 전체 캡처를 만들지 못했습니다.');
  context.drawImage(source, x * source.naturalWidth, y * source.naturalHeight, width * source.naturalWidth, height * source.naturalHeight, 0, 0, canvas.width, canvas.height);
  const result = canvas.toDataURL('image/jpeg', 0.94);
  canvas.width = canvas.height = 1;
  return result;
}

export async function joinCaptures(captures: QuestionCapture[]) {
  if (captures.length === 1) return captures[0].image;
  const sources = await Promise.all(captures.map((capture) => loadImage(capture.image)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(...sources.map((source) => source.naturalWidth));
  const heights = sources.map((source) => Math.round(source.naturalHeight * canvas.width / source.naturalWidth));
  canvas.height = heights.reduce((sum, height) => sum + height + 16, 0);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('이어지는 문항 캡처를 만들지 못했습니다.');
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  let y = 0;
  sources.forEach((source, index) => { context.drawImage(source, 0, y, canvas.width, heights[index]); y += heights[index] + 16; });
  const result = canvas.toDataURL('image/jpeg', 0.94);
  canvas.width = canvas.height = 1;
  return result;
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('PDF 원문 이미지를 읽지 못했습니다.'));
    image.src = source;
  });
}
