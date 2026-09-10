import {
  questionStructures,
  questionTextFromBlocks,
  type QuestionBlock,
} from './question-content';
import { unformattedText } from './text-formatting';
const compact = (value: string) => unformattedText(value).replace(/\s/g, '');
type Structured = Exclude<QuestionBlock, { kind: 'text' }>;
const key = (block: Structured) =>
  block.kind === 'box'
    ? compact(block.text)
    : block.rows.map((row) => row.map(compact).join('|')).join('\n');
function similar(a: string, b: string) {
  const pairs = (s: string) => {
    const chars = Array.from(compact(s));
    return new Set(chars.slice(1).map((c, i) => chars[i] + c));
  };
  const left = pairs(a),
    right = pairs(b);
  return (
    left.size > 8 &&
    [...left].filter((pair) => right.has(pair)).length / left.size > 0.6
  );
}

/** Geometric source structures cannot silently disappear during a later AI re-read. */
export function preserveSourceStructures(candidate: string, original: string) {
  const before = questionStructures(original);
  if (!before.length) return { text: candidate, warning: '' };
  const after = questionStructures(candidate);
  let result = candidate;
  let changed = false;
  const used = new Set<QuestionBlock>();
  for (const source of before) {
    const sameKind = after.filter(
      (b) => b.kind === source.kind && !used.has(b),
    ) as Structured[];
    const matched =
      source.kind === 'table'
        ? sameKind.find(
            (b) =>
              b.kind === 'table' &&
              b.rows.length === source.rows.length &&
              b.rows[0].length === source.rows[0].length &&
              (!source.header ||
                source.rows[0].every(
                  (cell, c) => !cell || compact(b.rows[0][c]) === compact(cell),
                )),
          )
        : sameKind.find(
            (b) =>
              b.kind === 'box' &&
              (key(b) === key(source) || similar(source.text, b.text)),
          );
    if (matched) {
      used.add(matched);
      continue;
    }
    // Missing only the header row: restore it using an exact match of the data rows.
    if (source.kind === 'table' && source.header) {
      const body = sameKind.find(
        (b) =>
          b.kind === 'table' &&
          b.rows.length === source.rows.length - 1 &&
          key(b) === key({ ...source, rows: source.rows.slice(1) }),
      );
      if (body?.kind === 'table') {
        const old = questionTextFromBlocks([{ ...body, text: '' }])!;
        const fixed = questionTextFromBlocks([
          {
            ...body,
            rows: [source.rows[0], ...body.rows],
            header: true,
            text: '',
          },
        ])!;
        if (result.includes(old)) {
          result = result.replace(old, fixed);
          used.add(body);
          changed = true;
          continue;
        }
      }
    }
    return {
      text: original,
      warning:
        'AI 판독에서 기존 표·상자 또는 표 머리글이 누락되어 기존 구조를 보존했습니다. 원문과 비교해 주세요.',
    };
  }
  return {
    text: result,
    warning: changed
      ? '누락된 표 머리글을 기존 원문 구조에서 복원했습니다.'
      : '',
  };
}
