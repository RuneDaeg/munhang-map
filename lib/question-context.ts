import type { AnalyzedQuestion } from './pdf-analysis';
import { normalizeQuestionText } from './math-normalization';
import { readBookSourceMetadata } from './book-metadata';

type Context = Pick<
  AnalyzedQuestion,
  | 'assessmentText'
  | 'sharedPassage'
  | 'mappingArea'
  | 'mappingReason'
  | 'validationFlags'
  | 'sourceQuestionNumber'
  | 'sourceQuestionLabel'
  | 'sourceBookMetadata'
  | 'sectionLabel'
  | 'answer'
  | 'answerSource'
  | 'sourceFormat'
  | 'sourceFingerprint'
  | 'sourceImages'
  | 'sourceItemId'
  | 'explanation'
  | 'explanationImages'
>;

export function hasHwpxIdentity(value: { sourceFormat?: unknown; sourceFingerprint?: unknown }): boolean {
  return value.sourceFormat === 'hwpx' && typeof value.sourceFingerprint === 'string' && /^[a-f0-9]{64}$/.test(value.sourceFingerprint);
}

export function sourceBasename(value: string): string {
  return (value.split(/[\\/]/).pop() || '').replace(/[\p{Cc}\p{Cf}:*?"<>|]/gu, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 500);
}

/** Reject remote/SVG images and bound memory before copying untrusted metadata. */
export function readSourceImages(value: unknown): NonNullable<AnalyzedQuestion['sourceImages']> {
  if (!Array.isArray(value) || value.length > 40) throw new Error('HWPX 삽입 그림 목록이 올바르지 않습니다.');
  let total = 0;
  const seen = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item.id !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(item.id) || item.id === '.' || item.id === '..' || seen.has(item.id)
      || typeof item.image !== 'string' || item.image.length > 15_000_000 || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(item.image)
      || item.image.slice(item.image.indexOf(',') + 1).length % 4) throw new Error('HWPX 삽입 그림 정보가 올바르지 않습니다.');
    total += item.image.length;
    if (total > 40_000_000) throw new Error('HWPX 삽입 그림은 문항당 40MB 이하로 저장해 주세요.');
    seen.add(item.id);
    return { id: item.id, image: item.image, ...(typeof item.label === 'string' ? { label: item.label.slice(0, 200) } : {}) };
  });
}
/** Untrusted review JSON: explicit fields only; never spread imported objects. */
export function readQuestionContext(
  value: Record<string, unknown>,
  maxPages = 200,
): Context {
  const result: Context = {};
  if (typeof value.answer === 'string') result.answer = value.answer.slice(0, 500);
  if (typeof value.answerSource === 'string' && sourceBasename(value.answerSource)) result.answerSource = sourceBasename(value.answerSource);
  if (typeof value.sourceItemId === 'string' && value.sourceItemId.trim() && value.sourceItemId.length <= 200) result.sourceItemId = value.sourceItemId.replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim();
  if (value.explanation !== undefined) {
    if (typeof value.explanation !== 'string' || value.explanation.length > 200000) throw new Error('해설은 20만 자 이하의 텍스트로 저장해 주세요.');
    result.explanation = value.explanation;
  }
  if (value.sourceFormat === 'pdf') result.sourceFormat = 'pdf';
  if (hasHwpxIdentity(value)) {
    result.sourceFormat = 'hwpx';
    result.sourceFingerprint = value.sourceFingerprint as string;
    if (value.sourceImages !== undefined) result.sourceImages = readSourceImages(value.sourceImages);
    if (value.explanationImages !== undefined) result.explanationImages = readSourceImages(value.explanationImages);
  }
  if (Number.isInteger(value.sourceQuestionNumber) && Number(value.sourceQuestionNumber) >= 1 && Number(value.sourceQuestionNumber) <= 10000)
    result.sourceQuestionNumber = Number(value.sourceQuestionNumber);
  if (value.sourceQuestionLabel !== undefined) {
    if (typeof value.sourceQuestionLabel !== 'string' || !/^[\p{L}][^#<>\p{Cc}\p{Cf}\uE000-\uF8FF\uFFFD]{0,79}$/u.test(value.sourceQuestionLabel)) throw new Error('도서 원문 문항 라벨이 올바르지 않습니다.');
    if (result.sourceQuestionNumber !== undefined) throw new Error('원본 문항 번호와 비숫자 라벨이 함께 지정되어 있습니다.');
    result.sourceQuestionLabel = value.sourceQuestionLabel;
  }
  if (value.sourceBookMetadata !== undefined) result.sourceBookMetadata = readBookSourceMetadata(value.sourceBookMetadata);
  if (typeof value.sectionLabel === 'string' && value.sectionLabel.trim())
    result.sectionLabel = value.sectionLabel.replace(/[\r\n\t]/g, ' ').trim().slice(0, 200);
  if (
    typeof value.assessmentText === 'string' &&
    value.assessmentText.length <= 200000
  )
    result.assessmentText = normalizeQuestionText(value.assessmentText);
  for (const key of ['mappingArea', 'mappingReason'] as const)
    if (typeof value[key] === 'string') result[key] = value[key].slice(0, 3000);
  const s = value.sharedPassage as Record<string, unknown> | undefined;
  if (
    s &&
    Array.isArray(s.range) &&
    s.range.length === 2 &&
    s.range.every((n) => Number.isInteger(n) && n >= 1 && n <= 200) &&
    s.range[0] <= s.range[1] &&
    typeof s.text === 'string' &&
    s.text.length <= 200000 &&
    Array.isArray(s.pages) &&
    s.pages.length > 0 &&
    s.pages.length <= maxPages &&
    s.pages.every((p) => Number.isInteger(p) && p >= 1 && p <= maxPages)
  )
    result.sharedPassage = {
      range: [s.range[0], s.range[1]],
      text: normalizeQuestionText(s.text),
      pages: [...new Set(s.pages as number[])],
    };
  if (Array.isArray(value.validationFlags))
    result.validationFlags = value.validationFlags
      .slice(0, 30)
      .flatMap((f) =>
        f &&
        typeof f.code === 'string' &&
        /^[a-z_]{1,60}$/.test(f.code) &&
        typeof f.message === 'string'
          ? [{ code: f.code, message: f.message.slice(0, 3000) }]
          : [],
      );
  return result;
}

/** User-facing identity, distinct from the unique internal/API selection id. */
export function questionLabel(question: { number: number; sourceQuestionNumber?: number; sourceQuestionLabel?: string; sectionLabel?: string }): string {
  return `${question.sectionLabel ? `${question.sectionLabel} · ` : ''}${question.sourceQuestionLabel || `${question.sourceQuestionNumber ?? question.number}번`}`;
}
