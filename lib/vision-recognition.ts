import type { AnalyzedQuestion } from './pdf-analysis';
import { joinCaptures } from './question-capture';

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

export type VisionStatus = {
  available: boolean;
  model: string;
  desktop?: boolean;
  local?: boolean;
  provider?: string;
  providerLabel?: string;
  keyHint?: string;
  storageLabel?: string;
  usage?: { requests: number; inputTokens: number; outputTokens: number; estimatedUsd: number };
  budgetUsd?: number | null;
  estimatedRemainingUsd?: number | null;
  balanceSource?: 'local_estimate';
  settingsUrl?: string;
};

type DesktopBridge = {
  isDesktop: true;
  platform: string;
  getVisionStatus: () => Promise<VisionStatus>;
  recognize: (body: { image: string; questions: VisionRequestQuestion[] }) => Promise<VisionResponse>;
  openApiKeySettings: () => Promise<{ ok: boolean }>;
};

function desktopBridge() {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { munhangDesktop?: DesktopBridge }).munhangDesktop;
}

export async function getVisionStatus(): Promise<VisionStatus> {
  const desktop = desktopBridge();
  if (desktop) return desktop.getVisionStatus();
  const response = await fetch('/api/recognize');
  if (!response.ok) return { available: false, model: '', desktop: false };
  const status = await response.json() as { available: boolean; model: string };
  return { ...status, desktop: false };
}

export async function openApiConnectionSettings() {
  const desktop = desktopBridge();
  if (desktop) {
    const result = await desktop.openApiKeySettings();
    return result.ok;
  }
  if (typeof window !== 'undefined') {
    window.location.assign('/settings.html');
    return true;
  }
  return false;
}

export async function enhanceQuestionsWithVision(
  questions: AnalyzedQuestion[],
  onProgress?: (completed: number, total: number) => void,
) {
  const enhanced = [...questions];
  const failures: string[] = [];
  let completed = 0;
  for (const [index, question] of questions.entries()) {
    try {
      const captures = question.questionCaptures;
      const image = captures?.length ? await joinCaptures(captures) : question.sourcePageImage;
      if (!image) throw new Error(`${question.number}번 원문 캡처가 없습니다.`);
      const subject = question.examSubject ? `시험지 상단 과목: ${question.examSubject.label}\n` : '';
      const result = await recognizeImage(image, [{ number: question.number, text: `${subject}${question.text}` }]);
      const recognized = result.questions?.find((item) => item.number === question.number);
      if (!recognized) throw new Error(`${question.number}번 문항의 판독 결과가 없습니다.`);
      enhanced[index] = {
        ...question,
        text: completeQuestionText(question.text, recognized),
        // PDF-coordinate captures are authoritative; AI boxes never overwrite them.
        visionEnhanced: true,
      };
    } catch (reason) {
      failures.push(reason instanceof Error ? reason.message : '비전 분석에 실패했습니다.');
    }
    completed += 1;
    onProgress?.(completed, questions.length);
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
    (recognized.indirectStem ?? '').trim(),
    (recognized.directStem ?? '').trim(),
    ...(Array.isArray(recognized.choices) ? recognized.choices : []).filter((choice) => typeof choice === 'string').map((choice) => choice.trim()),
  ].filter(Boolean).join('\n');
  const full = (recognized.latexText ?? '').trim();
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
