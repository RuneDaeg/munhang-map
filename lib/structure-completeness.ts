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

const unresolved =
  /[\uE000-\uF8FF\uFFFD\uFFFF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u;
const numberToken = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi;
const scriptDigits = '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻';
const normalDigits = '0123456789+-';

/** Comparison evidence only: never rewrite the candidate's saved text. */
function cellEvidence(value: string) {
  const text = unformattedText(value)
    .replace(
      /[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g,
      (run) =>
        `^{${Array.from(run)
          .map((c) => normalDigits[scriptDigits.indexOf(c)])
          .join('')}}`,
    )
    .normalize('NFKC')
    .replace(/[−–]/g, '-')
    // Formatting lengths are not values from the source cell.
    .replace(/\\(?:hspace|vspace|kern|mkern)\*?\s*\{[^{}]*\}/g, '')
    .replace(/\\(?:circ|degree)\b/g, '°')
    .replace(/\\(?:mu|micro)\b/g, 'μ')
    .replace(/\\Omega\b/g, 'Ω')
    // Ordinary and scientific notation can express the same measurement.
    .replace(
      /([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(?:\\times|\\cdot|×|·|\*)\s*10\s*\^\s*\{?\s*([+-]?\d+)\s*\}?/g,
      (source, coefficient: string, exponent: string) => {
        const result = Number(coefficient) * 10 ** Number(exponent);
        return Number.isFinite(result) ? String(result) : source;
      },
    )
    .replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g, (n) => n.replace(/,/g, ''))
    .replace(
      /\\(?:mathrm|mathbf|mathit|mathsf|mathtt|text|textrm|textbf|operatorname|overline|underline|left|right|displaystyle|textstyle)\b/g,
      '',
    )
    .replace(/\\(?:quad|qquad|enspace|thinspace|medspace|thickspace)\b/g, ' ')
    // Keep unknown/semantic command names as content (e.g. \\alpha). A
    // formatting-only cell, however, must not hide that its value vanished.
    .replace(/\\([A-Za-z]+)/g, '$1')
    .replace(/\\[^A-Za-z]|[${}^_]/g, ' ');
  const numbers = [...text.matchAll(numberToken)].map((match) => ({
    raw: match[0],
    value: Number(match[0]),
  }));
  return {
    text: text.replace(/\s/g, ''),
    numbers,
    reliable: !unresolved.test(value) && /[\p{L}\p{N}]/u.test(text),
    context: text
      .replace(numberToken, '')
      .replace(/[^\p{L}]/gu, '')
      .toLowerCase(),
  };
}

const subsequence = (short: string, long: string) => {
  let at = 0;
  for (const char of long) if (char === short[at]) at++;
  return at === short.length;
};

/** Reject observable deletion, not every changed OCR value or unit spelling. */
function cellWasDeleted(source: string, candidate: string) {
  const before = cellEvidence(source),
    after = cellEvidence(candidate);
  if (!before.reliable) return false; // PUA/unknown glyphs must remain repairable.
  if (!/[\p{L}\p{N}]/u.test(after.text)) return true;
  if (!before.numbers.length || !subsequence(after.context, before.context))
    return false;
  if (after.numbers.length < before.numbers.length) {
    let at = 0;
    for (const number of before.numbers)
      if (number.value === after.numbers[at]?.value) at++;
    // Removing one or more unchanged values is deletion evidence. Substituting
    // values (including unit conversion or OCR correction) is not proof of loss.
    return at === after.numbers.length;
  }
  if (after.numbers.length !== before.numbers.length) return false;
  let deleted = false;
  for (let i = 0; i < before.numbers.length; i++) {
    const a = before.numbers[i],
      b = after.numbers[i];
    if (a.value === b.value) continue; // 030, 30.0 and 3e1 are formatting changes.
    if (b.raw.length >= a.raw.length || !subsequence(b.raw, a.raw))
      return false;
    deleted = true;
  }
  return deleted;
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
                  (cell, c) =>
                    !compact(cell) ||
                    unresolved.test(cell) ||
                    cellEvidence(b.rows[0][c]).text === cellEvidence(cell).text,
                )),
          )
        : sameKind.find(
            (b) =>
              b.kind === 'box' &&
              (key(b) === key(source) || similar(source.text, b.text)),
          );
    if (matched) {
      if (
        source.kind === 'table' &&
        matched.kind === 'table' &&
        source.rows.some((row, r) =>
          row.some((cell, c) => cellWasDeleted(cell, matched.rows[r][c])),
        )
      ) {
        return {
          text: original,
          warning:
            'AI 판독에서 기존 표 셀의 내용 또는 수치가 누락되어 기존 구조를 보존했습니다. 원문과 비교해 주세요.',
        };
      }
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
