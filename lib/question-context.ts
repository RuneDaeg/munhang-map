import type { AnalyzedQuestion } from './pdf-analysis';
import { normalizeQuestionText } from './math-normalization';

type Context = Pick<
  AnalyzedQuestion,
  | 'assessmentText'
  | 'sharedPassage'
  | 'mappingArea'
  | 'mappingReason'
  | 'validationFlags'
>;
/** Untrusted review JSON: explicit fields only; never spread imported objects. */
export function readQuestionContext(
  value: Record<string, unknown>,
  maxPages = 200,
): Context {
  const result: Context = {};
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
