import type { AnalyzedQuestion } from './pdf-analysis';
import { joinCaptures } from './question-capture';
import { normalizeQuestionText } from './math-normalization';
import { countUnresolvedGlyphs, glyphWarning } from './pdf-text';
import { overlayQuestionBoxes, parseQuestionContent, questionPlainText, questionTextFromBlocks, restoreQuestionStructure } from './question-content';
import { hasDuplicatedStem, includesRecognizedChoices, numberedApiChoices, preserveQuestionParts } from './question-completeness';
import { preserveSourceStructures } from './structure-completeness';
import { hasMissingSourcePrescripts, hasMisplacedSourceScripts, mathQualityIssues } from './math-quality';
import { preserveSourceTextFormatting } from './source-text-formatting';

type NormalizedBox = [number, number, number, number];

type VisionItem = {
  number: number;
  latexText: string;
  blocks?: unknown;
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
  const warnings: string[] = [];
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
      const completion = completeQuestionText(question.text, recognized);
      if (completion.warning) warnings.push(`${question.number}번: ${completion.warning}`);
      // Diagnostics contain no exam text, images, provider URLs, or credentials.
      console.info('[recognition-structure]', { number: question.number, source: completion.source, warning: Boolean(completion.warning) });
      let assessmentText = completion.source === 'original' ? question.assessmentText : question.sharedPassage
        ? preserveSourceTextFormatting(normalizeQuestionText([recognized.indirectStem,recognized.directStem,...numberedApiChoices(recognized.choices)].filter(s=>typeof s==='string').join('\n')), question.assessmentText ?? question.text)
        : completion.text;
      const keptAssessment = completion.source !== 'original' && Boolean(question.assessmentText) && (hasMissingSourcePrescripts(assessmentText ?? '', question.assessmentText!) || hasMisplacedSourceScripts(assessmentText ?? '', question.assessmentText!));
      if (keptAssessment) {
        assessmentText = question.assessmentText;
        warnings.push(`${question.number}번 개별 발문: 원자핵의 왼쪽 위·아래 첨자 또는 일반 변수의 오른쪽 첨자가 누락되거나 바뀌어 기존 발문을 보존했습니다. 원문 이미지와 비교해 주세요.`);
      }
      const assessmentIssues = mathQualityIssues(assessmentText ?? '');
      if (assessmentIssues.length) warnings.push(`${question.number}번 개별 발문: ${assessmentIssues.map(issue=>issue.message).join(' ')}`);
      enhanced[index] = {
        ...question,
        text: completion.text,
        assessmentText,
        mappingReason: undefined,
        validationFlags: undefined,
        // PDF-coordinate captures are authoritative; AI boxes never overwrite them.
        visionEnhanced: completion.source !== 'original' && !keptAssessment && !countUnresolvedGlyphs(completion.text) && !mathQualityIssues(completion.text).length && !hasDuplicatedStem(completion.text) && !assessmentIssues.length,
      };
    } catch (reason) {
      failures.push(reason instanceof Error ? reason.message : '비전 분석에 실패했습니다.');
    }
    completed += 1;
    onProgress?.(completed, questions.length);
  }
  return { questions: enhanced, failures, warnings };
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
  const normalizedOriginal = normalizeQuestionText(original);
  const labeledChoices = numberedApiChoices(recognized.choices);
  const stemText = [
    (typeof recognized.indirectStem === 'string' ? recognized.indirectStem : '').trim(),
    (typeof recognized.directStem === 'string' ? recognized.directStem : '').trim(),
    ...(labeledChoices.length ? labeledChoices : (Array.isArray(recognized.choices) ? recognized.choices : []).filter((choice) => typeof choice === 'string').map((choice) => choice.trim())),
  ].filter(Boolean).map(normalizeQuestionText).join('\n');
  const full = normalizeQuestionText((typeof recognized.latexText === 'string' ? recognized.latexText : '').trim());
  const hasStructure = (text: string) => parseQuestionContent(text).some((block) => block.kind !== 'text');
  const baseline = readableLength(full) >= readableLength(stemText) ? full : stemText;
  const structured = questionTextFromBlocks(recognized.blocks);
  const canUseBlocks = structured !== undefined && readableLength(structured) >= readableLength(baseline) * 0.9 && coversText(structured, baseline) && !hasMissingSourcePrescripts(structured, baseline) && !hasMisplacedSourceScripts(structured, baseline) && includesRecognizedChoices(questionPlainText(structured), recognized.choices);
  const overlay = !canUseBlocks ? overlayQuestionBoxes(baseline, structured ?? (hasStructure(full) ? full : '')) : undefined;
  let candidate = canUseBlocks ? structured : overlay ?? baseline;
  let source = canUseBlocks ? 'blocks' : overlay ? 'anchored-boxes' : 'text';
  let warning = recognized.blocks !== undefined && !canUseBlocks ? 'AI의 표·상자 구조가 불완전해 전체 판독문을 보존했습니다. 원문과 비교해 주세요.' : '';
  if (!candidate) return { text: restoreQuestionStructure(normalizedOriginal), source: 'original', warning: '판독문이 비어 기존 내용을 보존했습니다.' };
  if (countUnresolvedGlyphs(candidate) > countUnresolvedGlyphs(normalizedOriginal)) {
    candidate = normalizedOriginal;
    source = 'original';
    warning = '이미지 판독 결과에 깨진 문자가 늘어 기존 내용을 보존했습니다. 원문과 비교해 주세요.';
  }

  const originalLength = readableLength(normalizedOriginal);
  const candidateLength = readableLength(candidate);
  if (originalLength >= 50 && candidateLength < originalLength * 0.62) {
    candidate = normalizedOriginal;
    source = 'original';
    warning = '발문·자료·선택지 누락이 의심되어 기존 내용을 보존했습니다. 원문과 비교해 주세요.';
  }
  const parts = preserveQuestionParts(candidate, normalizedOriginal, recognized.choices, typeof recognized.directStem === 'string' ? recognized.directStem : '');
  if (parts.keptOriginal) source = 'original';
  warning = [warning, parts.warning].filter(Boolean).join(' ');
  const protectedStructure = preserveSourceStructures(restoreQuestionStructure(parts.text), normalizedOriginal);
  if(protectedStructure.text===normalizedOriginal && protectedStructure.warning) source='original';
  warning=[warning,protectedStructure.warning].filter(Boolean).join(' ');
  let text = normalizeQuestionText(restoreQuestionStructure(protectedStructure.text));
  const mathIssues=mathQualityIssues(text);
  if(mathIssues.length || hasDuplicatedStem(text)) {
    if(normalizedOriginal.trim() && !mathQualityIssues(normalizedOriginal).length && !hasDuplicatedStem(normalizedOriginal)) {
      text=restoreQuestionStructure(normalizedOriginal);
      source='original';
      warning=[warning,'AI 판독문에 수식·중복 오류가 있어 기존 추출문을 보존했습니다. 원문과 비교해 주세요.'].filter(Boolean).join(' ');
    } else warning=[warning,...mathIssues.map(issue=>issue.message),hasDuplicatedStem(text)?'발문 전체가 반복되어 있습니다. 원문과 비교해 주세요.':''].filter(Boolean).join(' ');
  }
  warning = [warning, glyphWarning(text)].filter(Boolean).join(' ');
  text = preserveSourceTextFormatting(text, normalizedOriginal);
  return { text, source, warning };
}

function coversText(candidate: string, reference: string) {
  const compact = (text: string) => questionPlainText(text).replace(/[\s\p{P}\p{S}]/gu, '');
  const source = compact(reference);
  if (!source) return true;
  const counts = new Map<string, number>();
  for (const char of compact(candidate)) counts.set(char, (counts.get(char) ?? 0) + 1);
  let matched = 0;
  for (const char of source) if (counts.get(char)) { matched += 1; counts.set(char, counts.get(char)! - 1); }
  return matched / source.length >= 0.9;
}

function readableLength(value: string) {
  return questionPlainText(value).replace(/\s|\\(?:text|quad|mathrm)|[${}]/g, '').length;
}
