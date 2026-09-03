import type { AnalyzedQuestion } from './pdf-analysis';

type VisionItem = {
  number: number;
  latexText: string;
  hasFigure: boolean;
  figureBox: [number, number, number, number] | null;
};

type DesktopBridge = {
  isDesktop: true;
  platform: string;
  getVisionStatus: () => Promise<{ available: boolean; model: string; desktop?: boolean }>;
  recognize: (body: { image: string; questions: Array<{ number: number; text: string }> }) => Promise<{ questions?: VisionItem[]; error?: string }>;
};

function desktopBridge() {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { munhangDesktop?: DesktopBridge }).munhangDesktop;
}

export async function getVisionStatus(): Promise<{ available: boolean; model: string; desktop?: boolean }> {
  const desktop = desktopBridge();
  if (desktop) return desktop.getVisionStatus();
  const response = await fetch('/api/recognize');
  if (!response.ok) return { available: false, model: '', desktop: false };
  const status = await response.json() as { available: boolean; model: string };
  return { ...status, desktop: false };
}

export async function enhanceQuestionsWithVision(
  questions: AnalyzedQuestion[],
  onProgress?: (completed: number, total: number) => void,
) {
  const groups = new Map<string, Array<{ index: number; question: AnalyzedQuestion }>>();
  questions.forEach((question, index) => {
    if (!question.sourcePageImage) return;
    const group = groups.get(question.sourcePageImage) ?? [];
    group.push({ index, question });
    groups.set(question.sourcePageImage, group);
  });

  const enhanced = [...questions];
  const failures: string[] = [];
  let completed = 0;
  for (const [image, group] of groups) {
    try {
      const requestBody = { image, questions: group.map(({ question }) => ({ number: question.number, text: question.text })) };
      const desktop = desktopBridge();
      let result: { questions?: VisionItem[]; error?: string };
      if (desktop) {
        result = await desktop.recognize(requestBody);
      } else {
        const response = await fetch('/api/recognize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });
        result = await response.json() as { questions?: VisionItem[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? '비전 분석에 실패했습니다.');
      }
      if (!result.questions) throw new Error(result.error ?? '비전 분석에 실패했습니다.');
      await Promise.all(group.map(async ({ index, question }) => {
        const recognized = result.questions?.find((item) => item.number === question.number);
        if (!recognized) return;
        const figureImage = recognized.hasFigure && recognized.figureBox
          ? await cropImage(image, recognized.figureBox)
          : undefined;
        enhanced[index] = {
          ...question,
          text: recognized.latexText.trim() || question.text,
          figureImage,
          visionEnhanced: true,
        };
      }));
    } catch (reason) {
      failures.push(reason instanceof Error ? reason.message : '비전 분석에 실패했습니다.');
    }
    completed += 1;
    onProgress?.(completed, groups.size);
  }
  return { questions: enhanced, failures };
}

async function cropImage(dataUrl: string, box: [number, number, number, number]) {
  const source = await loadImage(dataUrl);
  const [rawX, rawY, rawWidth, rawHeight] = box;
  const padding = 0.012;
  const x = Math.max(0, rawX - padding);
  const y = Math.max(0, rawY - padding);
  const width = Math.min(1 - x, rawWidth + padding * 2);
  const height = Math.min(1 - y, rawHeight + padding * 2);
  if (width < 0.03 || height < 0.03) return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.naturalWidth * width));
  canvas.height = Math.max(1, Math.round(source.naturalHeight * height));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return undefined;
  context.drawImage(
    source,
    Math.round(source.naturalWidth * x),
    Math.round(source.naturalHeight * y),
    Math.round(source.naturalWidth * width),
    Math.round(source.naturalHeight * height),
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas.toDataURL('image/jpeg', 0.9);
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('그림자료를 잘라내지 못했습니다.'));
    image.src = source;
  });
}
