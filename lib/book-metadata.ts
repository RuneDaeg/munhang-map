/** Explicit publisher labels, not inferred chapter/page/question numbers. */
export type BookSourceMetadata = {
  unit?: string;
  category?: string;
  page?: string;
  questionLabel: string;
};
export type BookMetadata = {
  sourceItemId: string;
  number?: number;
  sourceQuestionLabel?: string;
  sectionLabel: string;
  sourcePage?: number;
  sourceBookMetadata: BookSourceMetadata;
};

export const bookMetadataLine = /^\s*#(?:강|구분|쪽|번|문항코드)(?=\s|$)/;
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
const labelValid = (value: string) => value.length > 0 && value.length <= 80 && !/[#<>\p{Cc}\p{Cf}\uE000-\uF8FF\uFFFD]/u.test(value);

/** Whitelist for untrusted JSON/storage. Do not coerce placeholders into numbers. */
export function readBookSourceMetadata(value: unknown): BookSourceMetadata | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('도서 원문 식별정보가 올바르지 않습니다.');
  const input = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const key of ['unit', 'category', 'page', 'questionLabel'] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string' || !labelValid(input[key])) throw new Error('도서 원문 식별정보가 올바르지 않습니다.');
    result[key] = input[key];
  }
  if (!result.questionLabel || !!result.unit === !!result.category) throw new Error('도서 원문 단원·문항 라벨이 올바르지 않습니다.');
  return result as BookSourceMetadata;
}

/** One grammar is used by question extraction and answer-key imports. */
export function parseBookMetadata(text: string): BookMetadata | undefined {
  const line = clean(text);
  if (!bookMetadataLine.test(line) || line.length > 1000 || /[\p{Cc}\p{Cf}\uE000-\uF8FF\uFFFD]/u.test(line)) return undefined;
  const fields = [...line.matchAll(/#(강|구분|쪽|번|문항코드)\s+([^#]*?)(?=\s*#|$)/g)];
  const values = new Map(fields.map(field => [field[1], clean(field[2])]));
  // Unknown tags, duplicate fields, missing values and stray prefix text fail closed.
  const reconstructed = fields.map(field => field[0].trim()).join(' ');
  if (clean(reconstructed) !== line || fields.length !== values.size) return undefined;
  const unit = values.get('강'), category = values.get('구분'), page = values.get('쪽');
  const questionLabel = values.get('번'), sourceItemId = values.get('문항코드');
  if (!!unit === !!category || !questionLabel || !sourceItemId || !/^[^\s#[\]{}<>]{1,200}$/.test(sourceItemId)) return undefined;
  if ([unit, category, page, questionLabel].some(value => value !== undefined && !labelValid(value))) return undefined;
  const numeric = /^\d+$/.test(questionLabel);
  const number = numeric ? Number(questionLabel) : undefined;
  // "001x" is a damaged number, not a named practice item. Preserve genuine labels.
  if (numeric ? !number || number > 10000 : !/^[\p{L}]/u.test(questionLabel)) return undefined;
  const sourceBookMetadata: BookSourceMetadata = { ...(unit ? { unit } : { category }), ...(page ? { page } : {}), questionLabel };
  return { sourceItemId, ...(number !== undefined ? { number } : { sourceQuestionLabel: questionLabel }),
    sectionLabel: [unit ? `${unit}강` : `구분 ${category}`, page && `${page}쪽`].filter(Boolean).join(' · '),
    ...(/^[0-9]{1,6}$/.test(page ?? '') && Number(page) > 0 ? { sourcePage: Number(page) } : {}), sourceBookMetadata };
}
