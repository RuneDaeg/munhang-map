import type { AnalyzedQuestion } from './pdf-analysis';

type NormalizedBox = [number, number, number, number];

type VisionItem = {
  number: number;
  latexText: string;
  indirectStem: string;
  directStem: string;
  choices: string[];
  questionBox: NormalizedBox;
  hasFigure: boolean;
  figureBox: NormalizedBox | null;
};

type VisionRequestQuestion = { number: number; text: string };
type VisionResponse = { questions?: VisionItem[]; error?: string };

type DesktopBridge = {
  isDesktop: true;
  platform: string;
  getVisionStatus: () => Promise<{ available: boolean; model: string; desktop?: boolean }>;
  recognize: (body: { image: string; questions: VisionRequestQuestion[] }) => Promise<VisionResponse>;
  openApiKeySettings: () => Promise<{ ok: boolean }>;
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

export async function openDesktopApiKeySettings() {
  const desktop = desktopBridge();
  if (!desktop) return false;
  const result = await desktop.openApiKeySettings();
  return result.ok;
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
      const result = await recognizeImage(image, group.map(({ question }) => ({ number: question.number, text: question.text })));
      for (const { index, question } of group) {
        let recognized = result.questions?.find((item) => item.number === question.number);
        if (!recognized) continue;
        let cropSource = image;

        const questionBox = normalizedBox(recognized.questionBox);
        if (recognized.hasFigure && questionBox && isUsableQuestionBox(questionBox)) {
          const questionImage = await cropImage(image, expandQuestionBox(questionBox));
          if (questionImage) {
            try {
              const refined = await recognizeImage(questionImage, [{
                number: question.number,
                text: completeQuestionText(question.text, recognized),
              }]);
              const refinedQuestion = refined.questions?.find((item) => item.number === question.number);
              if (refinedQuestion?.hasFigure && refinedQuestion.figureBox) {
                recognized = refinedQuestion;
                cropSource = questionImage;
              }
            } catch {
              // The page-level result remains usable when the focused second pass fails.
            }
          }
        }

        const figureBox = recognized.hasFigure && recognized.figureBox
          ? constrainFigureBox(recognized.figureBox, recognized.questionBox)
          : null;
        const figureImage = figureBox
          ? await cropImage(cropSource, figureBox)
          : undefined;
        enhanced[index] = {
          ...question,
          text: completeQuestionText(question.text, recognized),
          figureImage,
          visionEnhanced: true,
        };
      }
    } catch (reason) {
      failures.push(reason instanceof Error ? reason.message : '비전 분석에 실패했습니다.');
    }
    completed += 1;
    onProgress?.(completed, groups.size);
  }
  return { questions: enhanced, failures };
}

async function recognizeImage(image: string, questions: VisionRequestQuestion[]) {
  const requestBody = { image, questions };
  const desktop = desktopBridge();
  let result: VisionResponse;
  if (desktop) {
    result = await desktop.recognize(requestBody);
  } else {
    const response = await fetch('/api/recognize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    result = await response.json() as VisionResponse;
    if (!response.ok) throw new Error(result.error ?? '비전 분석에 실패했습니다.');
  }
  if (!result.questions) throw new Error(result.error ?? '비전 분석에 실패했습니다.');
  return result;
}

function completeQuestionText(original: string, recognized: VisionItem) {
  const structured = [
    recognized.indirectStem.trim(),
    recognized.directStem.trim(),
    ...recognized.choices.map((choice) => choice.trim()),
  ].filter(Boolean).join('\n');
  const full = recognized.latexText.trim();
  const candidate = readableLength(structured) > readableLength(full) ? structured : full;
  if (!candidate) return original;

  const originalLength = readableLength(original);
  const candidateLength = readableLength(candidate);
  if (originalLength >= 50 && candidateLength < originalLength * 0.62) return original;
  return candidate;
}

function readableLength(value: string) {
  return value.replace(/\s|\\(?:text|quad|mathrm)|[${}]/g, '').length;
}

function constrainFigureBox(figureBox: NormalizedBox, questionBox: NormalizedBox) {
  const figure = normalizedBox(figureBox);
  const question = normalizedBox(questionBox);
  if (!figure || !question) return null;

  const margin = 0.008;
  const questionLeft = Math.max(0, question[0] - margin);
  const questionTop = Math.max(0, question[1] - margin);
  const questionRight = Math.min(1, question[0] + question[2] + margin);
  const questionBottom = Math.min(1, question[1] + question[3] + margin);
  const left = Math.max(figure[0], questionLeft);
  const top = Math.max(figure[1], questionTop);
  const right = Math.min(figure[0] + figure[2], questionRight);
  const bottom = Math.min(figure[1] + figure[3], questionBottom);
  const width = right - left;
  const height = bottom - top;
  const figureArea = figure[2] * figure[3];
  const clippedArea = width * height;
  const questionArea = question[2] * question[3];
  if (width < 0.03 || height < 0.025 || clippedArea < figureArea * 0.72) return null;
  if (clippedArea > 0.48 || clippedArea > questionArea * 0.82) return null;
  return [left, top, width, height] as NormalizedBox;
}

function isUsableQuestionBox(box: NormalizedBox) {
  const area = box[2] * box[3];
  return box[2] >= 0.14 && box[3] >= 0.07 && area >= 0.015 && area <= 0.7;
}

function expandQuestionBox(box: NormalizedBox) {
  const horizontalPadding = 0.012;
  const verticalPadding = Math.min(0.045, Math.max(0.018, box[3] * 0.12));
  const left = Math.max(0, box[0] - horizontalPadding);
  const top = Math.max(0, box[1] - verticalPadding);
  const right = Math.min(1, box[0] + box[2] + horizontalPadding);
  const bottom = Math.min(1, box[1] + box[3] + verticalPadding);
  return [left, top, right - left, bottom - top] as NormalizedBox;
}

function normalizedBox(box: NormalizedBox) {
  if (!Array.isArray(box) || box.length !== 4 || box.some((value) => !Number.isFinite(value))) return null;
  const [rawX, rawY, rawWidth, rawHeight] = box;
  const x = Math.max(0, Math.min(1, rawX));
  const y = Math.max(0, Math.min(1, rawY));
  const width = Math.max(0, Math.min(1 - x, rawWidth));
  const height = Math.max(0, Math.min(1 - y, rawHeight));
  return [x, y, width, height] as NormalizedBox;
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
