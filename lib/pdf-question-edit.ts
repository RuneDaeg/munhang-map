import type { AnalyzedQuestion } from './pdf-analysis';
import { splitFormattedText } from './text-formatting';

// PDF review files and the question bank support at most 200 questions.
// Reuse a free ID after a merge, including when ID 200 is already occupied.
export function freePdfQuestionId(used: ReadonlySet<number>, preferred: number): number {
  if (preferred >= 1 && preferred <= 200 && !used.has(preferred)) return preferred;
  for (let id = 1; id <= 200; id++) {
    if (!used.has(id)) return id;
  }
  throw new Error('PDF는 최대 200문항까지 나눌 수 있습니다.');
}

export function splitPdfQuestion(question: AnalyzedQuestion, position: number, questions: AnalyzedQuestion[]): [AnalyzedQuestion, AnalyzedQuestion] {
  const [left, right] = splitFormattedText(question.text, position);
  const rightText = right.trim();
  const marker = rightText.match(/^([1-9]\d{0,3})\s*(?:\.(?!\d)|\))\s*/);
  const sourceNumber = marker ? Number(marker[1]) : (question.sourceQuestionNumber ?? question.number) + 1;
  const number = freePdfQuestionId(new Set(questions.map(item => item.number)), sourceNumber);
  const common = {
    ...question, assessmentText: undefined, validationFlags: undefined,
    // A split creates a new region identity even while the original crops are retained.
    questionCaptures: question.questionCaptures?.slice(),
    captureWarning: '텍스트를 수동으로 나눴습니다. 캡처에는 분리 전 영역이 보존되어 있으므로 범위를 확인해 주세요.',
    captureReviewed: false, textEdited: true, visualChoices: undefined, analysisWarning: undefined,
    figureImage: undefined, visionEnhanced: false,
  };
  return [
    { ...common, text: left.trim() },
    { ...common, number, sourceQuestionNumber: sourceNumber, answer: undefined, answerSource: undefined,
      text: marker ? rightText : `${sourceNumber}. ${rightText}`, type: question.type.replace('자동 추출', '수동 분리') },
  ];
}
