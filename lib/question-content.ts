import { normalizeQuestionText } from './math-normalization';
import { unformattedText } from './text-formatting';

export type QuestionBlock =
  | { kind: 'text'; text: string }
  | { kind: 'box'; title: string; text: string; inferred?: boolean }
  | { kind: 'table'; title: string; rows: string[][]; header: boolean };

const MAX_ROWS = 80;
const MAX_COLUMNS = 16;

/** Recover a labelled Korean option list, not arbitrary rectangles or prose. */
function recoverViewBoxes(text: string): QuestionBlock[] {
  if (text.includes(':::')) return [{ kind: 'text', text }];
  const title = /(?:<|〈|＜|\[)[ \t]*보[ \t]*기[ \t]*(?:>|〉|＞|\])/g;
  const blocks: QuestionBlock[] = [];
  let offset = 0;
  for (const match of text.matchAll(title)) {
    if (match.index < offset) continue;
    const start = match.index + match[0].length;
    const rest = text.slice(start);
    const nextTitle = rest.search(
      /(?:<|〈|＜|\[)[ \t]*보[ \t]*기[ \t]*(?:>|〉|＞|\])/,
    );
    const nextQuestion = rest.search(/\n\s*\d{1,3}[.)]\s/);
    const end = Math.min(
      rest.length,
      nextTitle < 0 ? rest.length : nextTitle,
      nextQuestion < 0 ? rest.length : nextQuestion,
    );
    const following = rest.slice(0, end);
    // A mention such as '<보기>에서 고른 것은?' is not a box heading.
    if (!/^\s*ㄱ\s*[.．]/.test(following)) continue;
    const choices = [...following.matchAll(/①/g)]
      .reverse()
      .find((choice) => /^①[^①]*②/.test(following.slice(choice.index)));
    if (!choices) continue; // An explicit choice boundary is needed to avoid swallowing trailing prose.
    const content = following.slice(0, choices.index).trim();
    const labels = [...content.matchAll(/(?:^|\s)([ㄱㄴㄷㄹㅁ])\s*[.．]/g)]
      .map((label) => label[1])
      .join('');
    if (labels.length < 2 || !'ㄱㄴㄷㄹㅁ'.startsWith(labels)) continue;
    if (/\n\s*\d{1,3}[.)]\s|[?？]/.test(content)) continue;
    if (match.index > offset)
      blocks.push({ kind: 'text', text: text.slice(offset, match.index) });
    blocks.push({
      kind: 'box',
      title: '<보기>',
      text: content,
      inferred: true,
    });
    offset = start + choices.index;
  }
  if (offset < text.length || !blocks.length)
    blocks.push({ kind: 'text', text: text.slice(offset) });
  return blocks;
}

/** Split only real cell separators, preserving escaped pipes and math such as $|x|$. */
export function splitTableRow(line: string): string[] | null {
  const value = line.trim();
  if (!value.startsWith('|') || !value.endsWith('|')) return null;
  const cells: string[] = [];
  let cell = '';
  let math = '';
  for (let i = 1; i < value.length - 1; i += 1) {
    const char = value[i];
    if (char === '\\' && i + 1 < value.length - 1) {
      const next = value[++i];
      cell += next === '|' ? '|' : `\\${next}`;
    } else if (char === '$') {
      // Exam price columns use literal dollars; they are not unclosed LaTeX.
      if (
        !math &&
        /^\$\d+(?:[.,]\d+)*(?:\s*[A-Z]{3})?\s*(?:\||$)/.test(value.slice(i))
      ) {
        cell += char;
        continue;
      }
      const delimiter = value[i + 1] === '$' ? '$$' : '$';
      if (delimiter === '$$') i += 1;
      math = math === delimiter ? '' : math || delimiter;
      cell += delimiter;
    } else if (char === '|' && !math) {
      cells.push(cell.trim());
      cell = '';
    } else cell += char;
  }
  cells.push(cell.trim());
  return math || cells.length > MAX_COLUMNS ? null : cells;
}

const separator = (row: string[] | null) =>
  Boolean(row?.length && row.every((cell) => /^:?-{3,}:?$/.test(cell)));

function grid(lines: string[], title = ''): QuestionBlock | null {
  const rows = lines.filter((line) => line.trim()).map(splitTableRow);
  if (!rows.length || rows.some((row) => !row) || rows.length > MAX_ROWS + 1)
    return null;
  const cells = rows as string[][];
  const header = cells.length > 1 && separator(cells[1]);
  const body = cells.filter((_row, i) => !(header && i === 1));
  if (
    body.length > MAX_ROWS ||
    body.some((row) => row.length !== body[0].length)
  )
    return null;
  return { kind: 'table', title, rows: body, header };
}

/** Text is the sole saved source of truth: edits, review files and the bank round-trip together. */
export function parseQuestionContent(
  value: string,
  depth = 0,
): QuestionBlock[] {
  // Keep the editable source compatible with older review files while allowing
  // boxes to contain other blocks. A depth limit keeps untrusted input bounded.
  if (depth > 8) return [{ kind: 'text', text: value }];
  const lines = normalizeQuestionText(value)
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const blocks: QuestionBlock[] = [];
  let prose: string[] = [];
  const flush = () => {
    if (prose.length) blocks.push(...recoverViewBoxes(prose.join('\n')));
    prose = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const fence = lines[i].trim().match(/^:::(box|table)(?:[ \t]+(.*))?$/);
    if (fence) {
      let end = i + 1,
        nesting = 1;
      while (end < lines.length) {
        if (/^:::(box|table)(?:\s|$)/.test(lines[end].trim())) nesting++;
        else if (lines[end].trim() === ':::' && --nesting === 0) break;
        end++;
      }
      const inside = lines.slice(i + 1, end);
      const nested = inside.some((line) => line.trim().startsWith(':::'));
      const valid =
        end < lines.length &&
        inside.some((line) => line.trim()) &&
        (!nested ||
          (fence[1] === 'box' &&
            depth < 8 &&
            !parseQuestionContent(inside.join('\n'), depth + 1).some(
              (b) => b.kind === 'text' && /^\s*:::/m.test(b.text),
            )));
      const block = valid
        ? fence[1] === 'box'
          ? {
              kind: 'box' as const,
              title: fence[2] ?? '',
              text: inside.join('\n'),
            }
          : grid(inside, fence[2] ?? '')
        : null;
      if (block) {
        flush();
        blocks.push(block);
        i = end;
        continue;
      }
      // Preserve malformed/unclosed structures verbatim instead of losing cells.
      prose.push(...lines.slice(i, Math.min(end + 1, lines.length)));
      i = end;
      continue;
    }
    const first = splitTableRow(lines[i]);
    if (
      first &&
      i + 1 < lines.length &&
      separator(splitTableRow(lines[i + 1]))
    ) {
      let end = i + 2;
      while (end < lines.length && lines[end].trim().startsWith('|')) end += 1;
      const block = grid(lines.slice(i, end));
      if (block) {
        flush();
        blocks.push(block);
        i = end - 1;
        continue;
      }
      prose.push(...lines.slice(i, end));
      i = end - 1;
      continue;
    }
    prose.push(lines[i]);
  }
  flush();
  return blocks;
}

/** Convert validated AI block objects to the same editable source used by reviews and exports. */
export function questionTextFromBlocks(
  value: unknown,
  depth = 0,
): string | undefined {
  if (depth > 8) return undefined;
  if (!Array.isArray(value) || !value.length || value.length > 100)
    return undefined;
  const fragments: string[] = [];
  for (const block of value) {
    if (
      !block ||
      typeof block !== 'object' ||
      typeof block.text !== 'string' ||
      typeof block.title !== 'string' ||
      !Array.isArray(block.rows) ||
      typeof block.header !== 'boolean'
    )
      return undefined;
    if (/[\r\n]/.test(block.title) || block.title.includes(':::'))
      return undefined;
    if (
      block.text.includes(':::') &&
      (block.kind !== 'box' ||
        parseQuestionContent(block.text, depth + 1).some(
          (b) => b.kind === 'text' && /^\s*:::/m.test(b.text),
        ))
    )
      return undefined;
    if (block.kind === 'text' && !block.title && !block.rows.length)
      fragments.push(block.text);
    else if (block.kind === 'box' && block.text.trim() && !block.rows.length)
      fragments.push(
        `:::box${block.title ? ` ${block.title}` : ''}\n${block.text}\n:::`,
      );
    else if (
      block.kind === 'table' &&
      !block.text &&
      block.rows.length > 0 &&
      block.rows.length <= MAX_ROWS
    ) {
      const rows: unknown[] = block.rows;
      const first = rows[0];
      if (
        !Array.isArray(first) ||
        !first.length ||
        first.length > MAX_COLUMNS ||
        rows.some(
          (row) =>
            !Array.isArray(row) ||
            row.length !== first.length ||
            row.some(
              (cell) =>
                typeof cell !== 'string' ||
                /[\r\n]/.test(cell) ||
                cell.includes(':::'),
            ),
        )
      )
        return undefined;
      // Escape literal cell separators (including math delimiters); the parser restores them once.
      const lines = (rows as string[][]).map(
        (row) =>
          `| ${row.map((cell) => cell.replace(/(?<!\\)\|/g, '\\|')).join(' | ')} |`,
      );
      if (block.header)
        lines.splice(1, 0, `| ${first.map(() => '---').join(' | ')} |`);
      fragments.push(
        `:::table${block.title ? ` ${block.title}` : ''}\n${lines.join('\n')}\n:::`,
      );
    } else return undefined;
  }
  const text = normalizeQuestionText(fragments.join('\n'));
  if (text.length > 50_000) return undefined;
  // Reject malformed math/row boundaries rather than silently losing any cell.
  const parsed = parseQuestionContent(text);
  if (
    parsed.some((block) => block.kind === 'text' && block.text.includes(':::'))
  )
    return undefined;
  return text;
}

export function restoreQuestionStructure(value: string) {
  return parseQuestionContent(value)
    .map((block) =>
      block.kind === 'box'
        ? `:::box${block.title ? ` ${block.title}` : ''}\n${block.text}\n:::`
        : block.kind === 'table'
          ? questionTextFromBlocks([{ ...block, text: '' }])!
          : block.text,
    )
    .join('\n');
}

/** Carry known boxes onto a fuller flat response without dropping its outside text. */
export function overlayQuestionBoxes(reference: string, structured: string) {
  if (reference.includes(':::')) return undefined;
  const boxes = parseQuestionContent(structured).filter(
    (block) => block.kind !== 'text',
  );
  if (!boxes.length || boxes.some((block) => block.kind !== 'box'))
    return undefined;
  const offsets: number[] = [];
  let compact = '';
  for (let i = 0; i < reference.length; i += 1)
    if (!/\s/.test(reference[i])) {
      compact += reference[i];
      offsets.push(i);
    }
  const patches: Array<{ start: number; end: number; text: string }> = [];
  for (const block of boxes) {
    if (block.kind !== 'box') return undefined;
    const body = block.text.replace(/\s/g, '');
    const at = compact.indexOf(body);
    if (body.length < 4 || at < 0 || compact.indexOf(body, at + 1) >= 0)
      return undefined;
    const title = block.title.replace(/\s/g, '');
    const start =
      title && compact.slice(0, at).endsWith(title) ? at - title.length : at;
    // Preserve the fuller response's exact body, spacing, and all surrounding text.
    const bodyText = reference.slice(
      offsets[at],
      offsets[at + body.length - 1] + 1,
    );
    patches.push({
      start: offsets[start],
      end: offsets[at + body.length - 1] + 1,
      text: `\n:::box${block.title ? ` ${block.title}` : ''}\n${bodyText}\n:::\n`,
    });
  }
  patches.sort((a, b) => a.start - b.start);
  if (
    patches.some(
      (patch, index) => index > 0 && patch.start < patches[index - 1].end,
    )
  )
    return undefined;
  let result = reference;
  for (const patch of patches.reverse())
    result =
      result.slice(0, patch.start) + patch.text + result.slice(patch.end);
  return result.trim();
}

export function questionPlainText(value: string): string {
  return unformattedText(parseQuestionContent(value)
    .map((block) =>
      block.kind === 'text'
        ? block.text
        : block.kind === 'box'
          ? [
              block.title,
              block.text.includes(':::')
                ? questionPlainText(block.text)
                : block.text,
            ]
              .filter(Boolean)
              .join('\n')
          : [block.title, ...block.rows.map((row) => row.join(' · '))]
              .filter(Boolean)
              .join('\n'),
    )
    .join('\n'));
}

/** Traverse nested containers for validation without flattening the saved source. */
export function questionStructures(
  value: string,
): Exclude<QuestionBlock, { kind: 'text' }>[] {
  return parseQuestionContent(value).flatMap((block) =>
    block.kind === 'text'
      ? []
      : block.kind === 'box' && block.text.includes(':::')
        ? [block, ...questionStructures(block.text)]
        : [block],
  );
}

/** Approximate CJK/Latin line width, not a font layout or text-transformation operation. */
export function approximateTextWidth(text: string, asciiWidth = 0.55) {
  let width = 0;
  for (const char of unformattedText(text))
    width += char.codePointAt(0)! > 0x7f ? 1 : asciiWidth;
  return width;
}

export function tableColumnWeights(rows: string[][]) {
  // Cap widths so one long cell cannot starve its neighbours.
  return rows[0].map((_cell, col) => {
    let longest = 4;
    for (const row of rows) {
      for (const line of row[col].split('\n'))
        longest = Math.max(longest, approximateTextWidth(line));
    }
    // Reserve padding in short columns too, so Model/Price cannot be squeezed
    // to single letters by a neighbouring multiline heading.
    return Math.min(28, longest) + 2;
  });
}
