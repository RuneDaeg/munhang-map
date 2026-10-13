import type { PageText } from './pdf-layout';

/** Answer imports are suggestions. The caller must ask the user before applying them. */
export type AnswerKeyEntry = {
  id: string;
  number?: number;
  value: string;
  /** Explicit publisher/item identity, when supplied by the source document. */
  sourceItemId?: string;
  sectionLabel?: string;
  subject?: string;
  sourceFileName?: string;
  sourcePage?: number;
  sourceLine?: number;
};
export type AnswerKeyResult = { entries: AnswerKeyEntry[]; warnings: string[] };
export type AnswerKeyOptions = { format?: 'text' | 'csv'; sourceFileName?: string };
export type AnswerMatchQuestion = {
  number: number;
  sourceQuestionNumber?: number;
  sourceItemId?: string;
  sectionLabel?: string;
  examSubject?: { label: string; subjectKeys?: string[] };
  selectedSubjectKey?: string;
  domain?: string;
  answer?: string;
};
export type AnswerMatch = {
  entry: AnswerKeyEntry;
  status: 'matched' | 'ambiguous' | 'unmatched' | 'conflict';
  /** Stable internal question numbers, never the potentially repeated printed number. */
  questionNumbers: number[];
  message: string;
};
type Scope = { subject?: string; sectionLabel?: string };
type SourceLine = { text: string; line: number; page?: number };
const numberHeader = /^(?:원본문항번호|문항(?:번호)?|문제(?:번호)?|번호|number|question(?:number)?|sourcequestionnumber)$/i;
const answerHeader = /^(?:정답|답|답안|answer|value)$/i;
const itemHeader = /^(?:문항코드|sourceitemid)$/i;
const normalizeLabel = (value: string) => value.normalize('NFKC').replace(/[\s·ㆍ()[\]（）]/g, '').toLowerCase();
const clean = (value: string) => value.replace(/^\uFEFF/, '').replace(/\s+/g, ' ').trim();
const printedNumber = (value: string) => /^(?:0*[1-9]\d{0,5})(?:번)?$/.test(value.trim()) ? Number(value.trim().replace(/번$/, '')) : undefined;
const hasBrokenGlyph = (value: string) => /[\uE000-\uF8FF\uFFFD]/u.test(value);

// Implicit pairs are deliberately narrow. Korean words and sentences need an
// answer label or a CSV/table schema, otherwise ordinary stems look like answers.
function compactAnswer(value: string) {
  return /^(?:[+\-−]?\d+(?:\.\d+)?(?:\/[+\-−]?\d+(?:\.\d+)?)?|[①-⑳❶-❿]+|[A-Ea-eOXox○×]|[ㄱ-ㅎ](?:[,·ㆍ+][ㄱ-ㅎ])*|[①-⑳](?:[,·ㆍ+][①-⑳])+)$/u.test(value.trim().replace(/\s*([,·ㆍ+])\s*/g, '$1'));
}

function scopeHeading(raw: string): Scope | undefined {
  const value = clean(raw).replace(/^[[【]([^\]】]+)[\]】]$/, '$1').trim();
  const explicit = value.match(/^(과목|교과|subject|영역|선택과목|구분|section)\s*[:：]\s*(.{1,60})$/i);
  if (explicit) return /^(구분|section|선택과목)$/i.test(explicit[1]) ? { sectionLabel: explicit[2] } : { subject: explicit[2] };
  const section = value.match(/^(확률\s*과\s*통계|미적분|기하|공통|화법\s*과\s*작문|언어\s*와\s*매체)(?:\s*(?:정답|답안)(?:\s*및\s*해설)?)?$/);
  if (section) return { sectionLabel: clean(section[1]) };
  const subject = value.match(/^(국어|수학|영어|한국사|통합\s*과학[12]?|통합\s*사회[12]?|물리학\s*[ⅠⅡⅢIV12]*|화학\s*[ⅠⅡⅢIV12]*|생명\s*과학\s*[ⅠⅡⅢIV12]*|지구\s*과학\s*[ⅠⅡⅢIV12]*|생활\s*과\s*윤리|윤리\s*와\s*사상|한국\s*지리|세계\s*지리|세계사|동아시아사|경제|정치\s*와\s*법|사회\s*[·ㆍ]?\s*문화)(?:\s*영역)?(?:\s*(?:정답|답안)(?:\s*및\s*해설)?)?$/);
  if (subject) return { subject: clean(subject[1]) };
  const combined = value.match(/^(국어|수학|영어)\s*(?:영역)?\s*[（(]([^）)]+)[）)](?:\s*(?:정답|답안))?$/);
  if (combined) return { subject: combined[1], sectionLabel: clean(combined[2]) };
  return undefined;
}

function updateScope(scope: Scope, next: Scope): Scope {
  // A new subject cannot inherit an elective label belonging to the old subject.
  return next.subject ? { ...next } : { ...scope, ...next };
}

function splitCells(line: string) {
  const trimmed = line.trim().replace(/^\|\s*|\s*\|$/g, '');
  return (/[\t|]/.test(trimmed) ? trimmed.split(/\t|\|/) : trimmed.split(/\s+/)).map(clean);
}

function parseLines(lines: SourceLine[], options: AnswerKeyOptions, initialScope: Scope = {}): AnswerKeyResult {
  const entries: AnswerKeyEntry[] = [];
  const warnings: string[] = [];
  let scope = initialScope;
  let explanation = false;
  let tableNumbers: number[] | undefined;
  let vertical: { number: number; answer: number; subject: number; section: number; count: number } | undefined;
  const add = (number: number, value: string, source: SourceLine, explicit = false) => {
    const answer = clean(value);
    if (!answer || hasBrokenGlyph(answer) || answer.length > 500 || (!explicit && !compactAnswer(answer))) {
      warnings.push(`${source.page ? `${source.page}쪽 ` : ''}${source.line}행: 정답을 확정할 수 없어 제외했습니다.`);
      return;
    }
    entries.push({ id: `answer-${entries.length + 1}`, number, value: answer, ...scope,
      ...(options.sourceFileName ? { sourceFileName: options.sourceFileName } : {}),
      ...(source.page ? { sourcePage: source.page } : {}), sourceLine: source.line });
  };
  for (const source of lines) {
    const line = source.text.trim().replace(/^\uFEFF/, '');
    if (!line) continue;
    if (hasBrokenGlyph(line)) {
      warnings.push(`${source.page ? `${source.page}쪽 ` : ''}${source.line}행: 읽을 수 없는 PDF 문자가 있어 제외했습니다.`);
      tableNumbers = undefined;
      continue;
    }
    const heading = scopeHeading(line);
    if (heading) {
      scope = updateScope(scope, heading);
      tableNumbers = undefined;
      vertical = undefined;
      // A subject heading alone does not turn an explanation into an answer key.
      if (/(?:정답|답안)/.test(line)) explanation = false;
      continue;
    }
    if (/^(?:\[|【)?\s*(?:해설|풀이|풀이과정|문제\s*해설|정답\s*해설|explanations?|solutions?)\s*(?:\]|】)?$/i.test(line)) {
      explanation = true;
      tableNumbers = undefined;
      vertical = undefined;
      continue;
    }
    if (/^(?:\[|【)?\s*(?:정답|답안|빠른\s*정답|정답표|정답\s*(?:및|과)\s*해설|answer\s*key|answers?)\s*(?:\]|】)?$/i.test(line)) {
      explanation = false;
      tableNumbers = undefined;
      vertical = undefined;
      continue;
    }
    const cells = splitCells(line);
    const headers = cells.map(normalizeLabel);
    if (headers.some(value => numberHeader.test(value)) && headers.some(value => answerHeader.test(value))) {
      vertical = headers.filter(value => numberHeader.test(value)).length === 1 && headers.filter(value => answerHeader.test(value)).length === 1 ? {
        number: headers.findIndex(value => numberHeader.test(value)), answer: headers.findIndex(value => answerHeader.test(value)),
        subject: headers.findIndex(value => /^(?:과목|교과|subject)$/.test(value)),
        section: headers.findIndex(value => /^(?:구분|선택과목|section|sectionlabel)$/.test(value)), count: headers.length,
      } : undefined;
      tableNumbers = undefined;
      continue;
    }
    if (numberHeader.test(normalizeLabel(cells[0]))) {
      vertical = undefined;
      if (cells.slice(1).length && cells.slice(1).every(value => printedNumber(value) !== undefined)) {
        tableNumbers = cells.slice(1).map(value => printedNumber(value)!);
      } else {
        tableNumbers = undefined;
      }
      continue;
    }
    if (vertical && cells.length === vertical.count && printedNumber(cells[vertical.number]) !== undefined) {
      const previousScope = scope;
      const rowSubject = vertical.subject >= 0 ? cells[vertical.subject] : undefined;
      const rowSection = vertical.section >= 0 ? cells[vertical.section] : undefined;
      scope = { ...scope, ...(rowSubject ? { subject: rowSubject } : {}), ...(rowSection ? { sectionLabel: rowSection } : {}) };
      add(printedNumber(cells[vertical.number])!, cells[vertical.answer], source, true);
      scope = previousScope;
      continue;
    }
    if (tableNumbers) {
      const values = answerHeader.test(normalizeLabel(cells[0])) ? cells.slice(1) : cells;
      if (values.length === tableNumbers.length && (answerHeader.test(normalizeLabel(cells[0])) || values.every(compactAnswer))) {
        values.forEach((value, index) => add(tableNumbers![index], value, source, true));
        tableNumbers = undefined;
        continue;
      }
      warnings.push(`${source.line}행: 문항 번호와 정답 칸 수가 달라 표를 제외했습니다.`);
      tableNumbers = undefined;
    }
    // Explicit, whole-line number/answer pairs can be used even in an explanation
    // document; prose after them is never searched for a likely answer.
    const labeled = line.match(/^(?:문항\s*|문제\s*)?(\d{1,6})(?:번|[.)])?\s*(?:(?:\[정답\]|【정답】)\s*[:：]?\s*|(?:정답|답안|답|answer)(?:\s*[:：]\s*|\s+))(.+)$/i);
    if (labeled) {
      const number = printedNumber(labeled[1]);
      if (number !== undefined && !/(?:해설|풀이)|[。!?]|(?:이다|한다|된다|이므로|때문이다)\.?$/u.test(labeled[2])) add(number, labeled[2], source, true);
      continue;
    }
    if (explanation) continue;
    // A page marker or bare number never constitutes an answer pair.
    const pair = /^(?:문항\s*|문제\s*)?\d+\.\d/.test(line) ? null : line.match(/^(?:문항\s*|문제\s*)?(\d{1,6})(?:번\s*|\s*[.):：]\s*|\s+)([^\s].*)$/);
    if (pair && printedNumber(pair[1]) !== undefined && compactAnswer(pair[2])) {
      add(printedNumber(pair[1])!, pair[2], source);
      continue;
    }
    // Repeated horizontal pairs, including "1. ③ 2. 0" and PDF table rows.
    const pairs = line.replace(/(\d)[.)](?=\s)/g, '$1').split(/[\s|\t]+/).filter(Boolean);
    if (pairs.length >= 4 && pairs.length % 2 === 0 && pairs.every((value, index) => index % 2 ? compactAnswer(value) : printedNumber(value) !== undefined)) {
      for (let index = 0; index < pairs.length; index += 2) add(printedNumber(pairs[index])!, pairs[index + 1], source);
    }
  }
  if (tableNumbers) warnings.push('문항 번호 행에 대응하는 정답 행을 찾지 못했습니다.');
  return { entries, warnings: [...new Set(warnings)] };
}

type CsvRow = { cells: string[]; line: number };
function readCsv(text: string): { rows: CsvRow[]; error?: string } {
  const rows: CsvRow[] = [];
  let cells: string[] = [], cell = '', quoted = false, closed = false, line = 1, rowLine = 1;
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') { cell += '"'; index += 1; }
        else { quoted = false; closed = true; }
      } else { cell += character; if (character === '\n') line += 1; }
      continue;
    }
    if (character === ',' || character === '\n') {
      cells.push(cell); cell = ''; closed = false;
      if (character === '\n') { rows.push({ cells, line: rowLine }); cells = []; line += 1; rowLine = line; }
    } else if (character === '"' && !cell && !closed) quoted = true;
    else if (closed && character.trim()) return { rows: [], error: `${line}행: CSV 따옴표 뒤에 잘못된 문자가 있습니다.` };
    else if (character === '"') return { rows: [], error: `${line}행: CSV 따옴표 형식이 올바르지 않습니다.` };
    else if (!closed) cell += character;
  }
  if (quoted) return { rows: [], error: 'CSV 따옴표가 닫히지 않아 정답을 읽지 않았습니다.' };
  if (cell || cells.length) rows.push({ cells: [...cells, cell], line: rowLine });
  return { rows: rows.filter(row => row.cells.some(value => value.trim())) };
}

function parseCsv(text: string, options: AnswerKeyOptions): AnswerKeyResult {
  const { rows, error } = readCsv(text);
  if (error) return { entries: [], warnings: [error] };
  if (!rows.length) return { entries: [], warnings: [] };
  const header = rows[0].cells.map(normalizeLabel);
  const numberIndex = header.findIndex(value => numberHeader.test(value));
  const answerIndex = header.findIndex(value => answerHeader.test(value));
  const itemIndex = header.findIndex(value => itemHeader.test(value));
  const encodingIndex = header.findIndex(value => /^(?:정답인코딩|answerencoding)$/i.test(value));
  const hasHeader = (numberIndex >= 0 || itemIndex >= 0) && answerIndex >= 0;
  if (hasHeader && (header.filter(value => numberHeader.test(value)).length > 1 || header.filter(value => answerHeader.test(value)).length !== 1
    || header.filter(value => itemHeader.test(value)).length > 1 || header.filter(value => /^(?:정답인코딩|answerencoding)$/i.test(value)).length > 1
    || header.filter(value => /^(?:과목|교과|subject)$/.test(value)).length > 1 || header.filter(value => /^(?:구분|선택과목|section|sectionlabel)$/.test(value)).length > 1))
    return { entries: [], warnings: ['CSV의 문항 번호·코드·정답·과목·구분 열이 중복되어 있습니다.'] };
  if (!hasHeader && header.some(value => numberHeader.test(value) || itemHeader.test(value) || answerHeader.test(value)))
    return { entries: [], warnings: ['CSV에는 문항 번호 또는 문항 코드 열과 정답 열이 필요합니다.'] };
  const subjectIndex = header.findIndex(value => /^(?:과목|교과|subject)$/.test(value));
  const sectionIndex = header.findIndex(value => /^(?:구분|선택과목|section|sectionlabel)$/.test(value));
  const entries: AnswerKeyEntry[] = [], warnings: string[] = [];
  for (const row of hasHeader ? rows.slice(1) : rows) {
    const rawNumber = clean(row.cells[hasHeader ? numberIndex : 0] ?? '');
    const number = printedNumber(rawNumber);
    const sourceItemId = hasHeader && itemIndex >= 0 ? clean(row.cells[itemIndex] ?? '') : '';
    const encoding = hasHeader && encodingIndex >= 0 ? clean(row.cells[encodingIndex] ?? '') : '';
    let value = clean(row.cells[hasHeader ? answerIndex : 1] ?? '');
    // Only the app's explicit text-encoding marker permits removing a CSV
    // safety apostrophe; an ordinary answer beginning with one stays literal.
    if (encoding === 'spreadsheet-text-v1' && value.startsWith("'")) value = value.slice(1);
    if (row.cells.length !== (hasHeader ? header.length : 2) || (number === undefined && (!sourceItemId || !!rawNumber))
      || sourceItemId && (!/^[^\s#[\]{}<>]{1,200}$/.test(sourceItemId) || /[\p{Cc}\p{Cf}]/u.test(sourceItemId) || hasBrokenGlyph(sourceItemId))
      || encoding && encoding !== 'spreadsheet-text-v1' || !value || value.length > 500 || hasBrokenGlyph(value) || (!hasHeader && !compactAnswer(value))) {
      warnings.push(`${row.line}행: 문항 번호 또는 정답을 확인할 수 없어 제외했습니다.`);
      continue;
    }
    entries.push({ id: `answer-${entries.length + 1}`, ...(number !== undefined ? { number } : {}), value,
      ...(sourceItemId ? { sourceItemId } : {}),
      ...(hasHeader && subjectIndex >= 0 && clean(row.cells[subjectIndex]) ? { subject: clean(row.cells[subjectIndex]) } : {}),
      ...(hasHeader && sectionIndex >= 0 && clean(row.cells[sectionIndex]) ? { sectionLabel: clean(row.cells[sectionIndex]) } : {}),
      ...(options.sourceFileName ? { sourceFileName: options.sourceFileName } : {}), sourceLine: row.line });
  }
  return { entries, warnings };
}

type BookItem = { number: number; sourceItemId: string; sectionLabel?: string; sourcePage?: number; sourceLine: number };
const bookMetadataLine = /^\s*#(?:강|쪽|번|문항코드)(?=\s|$)/;
function parseMarkedBook(lines: string[], options: AnswerKeyOptions): AnswerKeyResult {
  const entries: AnswerKeyEntry[] = [], warnings: string[] = [];
  let item: BookItem | undefined;
  let awaitingAnswer = false, foundAnswer = false;
  const finishItem = () => {
    if (item && !foundAnswer) warnings.push(`${item.sourceLine}행: 문항 ${item.sourceItemId}의 명시된 정답을 찾지 못했습니다.`);
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = clean(lines[index]);
    if (!line) continue;
    if (bookMetadataLine.test(line)) {
      finishItem();
      item = undefined; awaitingAnswer = false; foundAnswer = false;
      const fields = [...line.matchAll(/#(강|쪽|번|문항코드)\s+([^#]*?)(?=\s*#|$)/g)];
      const values = new Map(fields.map(field => [field[1], clean(field[2])]));
      const number = printedNumber(values.get('번') ?? '');
      const code = values.get('문항코드');
      const unit = values.get('강'), page = values.get('쪽');
      if (fields.length !== values.size || number === undefined || !code || !/^[^\s#[\]{}<>]{1,128}$/.test(code)
        || hasBrokenGlyph(code) || unit !== undefined && !/^\d{1,6}$/.test(unit) || page !== undefined && !/^\d{1,6}$/.test(page)) {
        warnings.push(`${index + 1}행: 문항 번호·코드·단원·쪽 정보가 불완전하거나 중복되어 정답 연결을 보류했습니다.`);
        continue;
      }
      item = { number, sourceItemId: code, sourceLine: index + 1,
        ...(unit && page ? { sectionLabel: `${unit}강 · ${page}쪽` } : {}),
        ...(page && Number(page) > 0 ? { sourcePage: Number(page) } : {}) };
      continue;
    }
    if (/^\[\s*정답\s*\/\s*모범답안\s*\]$/.test(line)) {
      awaitingAnswer = !!item;
      if (!item) warnings.push(`${index + 1}행: 문항 코드가 없는 정답 표지는 연결하지 않았습니다.`);
      continue;
    }
    if (/^\[\s*(?:문제|해설|풀이)\s*\]$/.test(line)) {
      awaitingAnswer = false;
      continue;
    }
    if (!awaitingAnswer || !item) continue;
    awaitingAnswer = false;
    // Only the first nonblank paragraph immediately after the explicit marker
    // is eligible. Never search the question or its explanation for a number.
    if (!/^(?:[+\-−]?\d+(?:\.\d+)?(?:\/[+\-−]?\d+(?:\.\d+)?)?|[①-⑳❶-❿](?:\s*[,·ㆍ+]\s*[①-⑳❶-❿])*)$/u.test(line)) {
      warnings.push(`${index + 1}행: 정답 표지 다음 값이 명확한 숫자·선택지 기호가 아니어서 제외했습니다.`);
      continue;
    }
    entries.push({ id: `answer-${entries.length + 1}`, ...item, sourceLine: index + 1, value: line,
      ...(options.sourceFileName ? { sourceFileName: options.sourceFileName } : {}) });
    foundAnswer = true;
  }
  finishItem();
  return { entries, warnings };
}

/** Only reads explicit pairs/table schemas; never sends document contents anywhere. */
export function parseAnswerKeyText(text: string, options: AnswerKeyOptions = {}): AnswerKeyResult {
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  if (options.format !== 'csv' && lines.some(line => bookMetadataLine.test(line))) return parseMarkedBook(lines, options);
  const first = lines.find(line => line.trim())?.replace(/^\uFEFF/, '').trim() ?? '';
  const csvFirst = clean(first.split(',')[0].replace(/^"|"$/g, ''));
  const csvHeaders = first.includes(',') ? (readCsv(first).rows[0]?.cells ?? []).map(normalizeLabel) : [];
  if (options.format === 'csv' || (!options.format && first.includes(',') && (printedNumber(csvFirst) !== undefined || numberHeader.test(normalizeLabel(csvFirst)) || /^(?:과목|교과|subject|구분|section)$/i.test(csvFirst)
    || csvHeaders.some(value => numberHeader.test(value) || itemHeader.test(value)) && csvHeaders.some(value => answerHeader.test(value))))) return parseCsv(normalized, options);
  return parseLines(lines.map((line, index) => ({ text: line, line: index + 1 })), options);
}

type PositionedRow = { y: number; parts: PageText[] };
function positionedRows(items: PageText[]) {
  const rows: PositionedRow[] = [];
  for (const part of [...items].filter(item => item.text.trim()).sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find(candidate => Math.abs(candidate.y - part.y) <= Math.max(2, Math.min(4, part.height * .3)));
    if (row) row.parts.push(part);
    else rows.push({ y: part.y, parts: [part] });
  }
  return rows.map(row => ({ ...row, parts: row.parts.sort((a, b) => a.x - b.x) }));
}
function rowText(parts: PageText[]) {
  return parts.map((part, index) => {
    if (!index) return part.text;
    const previous = parts[index - 1], gap = part.x - previous.x - previous.width;
    return `${gap <= 1 ? '' : gap > Math.max(10, Math.min(part.height, previous.height)) ? '\t' : ' '}${part.text}`;
  }).join('');
}

/** PDF callers provide viewport-positioned text runs, not guessed reading order. */
export function parseAnswerKeyPages(pages: Array<{ page: number; items: PageText[] }>, options: AnswerKeyOptions = {}): AnswerKeyResult {
  const entries: AnswerKeyEntry[] = [], warnings: string[] = [];
  let pending: SourceLine[] = [];
  const flush = () => {
    if (!pending.length) return;
    const result = parseLines(pending, options);
    entries.push(...result.entries); warnings.push(...result.warnings); pending = [];
  };
  for (const page of pages) {
    const rows = positionedRows(page.items);
    // Separate side-by-side subject/section tables before interpreting their rows.
    // Without this, a single text line could silently apply one subject to both.
    const parallelHeading = rows.find(row => {
      const headings = row.parts.filter(part => scopeHeading(part.text));
      return headings.length >= 2 && headings.every((part, index) => !index || part.x - headings[index - 1].x - headings[index - 1].width > 40);
    });
    if (!parallelHeading) {
      pending.push(...rows.map((row, index) => ({ text: rowText(row.parts), line: index + 1, page: page.page })));
      continue;
    }
    flush();
    const headings = parallelHeading.parts.filter(part => scopeHeading(part.text));
    const centers = headings.map(part => part.x + part.width / 2);
    const boundaries = centers.slice(1).map((center, index) => (center + centers[index]) / 2);
    for (let column = 0; column < headings.length; column += 1) {
      const left = boundaries[column - 1] ?? -Infinity, right = boundaries[column] ?? Infinity;
      const lines = rows.filter(row => row.y >= parallelHeading.y).map((row, index) => ({
        text: rowText(row.parts.filter(part => part.x + part.width / 2 >= left && part.x + part.width / 2 < right)), line: index + 1, page: page.page,
      }));
      const result = parseLines(lines, options);
      entries.push(...result.entries); warnings.push(...result.warnings);
    }
  }
  flush();
  return { entries: entries.map((entry, index) => ({ ...entry, id: `answer-${index + 1}` })), warnings: [...new Set(warnings)] };
}

function subjectLabels(question: AnswerMatchQuestion) {
  // An exam masthead is stronger evidence than a curriculum classification.
  // Classification candidates and question prose must never establish identity.
  const labels = question.examSubject ? [question.examSubject.label]
    : question.selectedSubjectKey ? [question.selectedSubjectKey] : [];
  return labels.flatMap(label => [label, label.split('|').at(-1)!]).map(normalizeLabel);
}
function compatibleScope(question: AnswerMatchQuestion, entry: AnswerKeyEntry) {
  const section = normalizeLabel(question.sectionLabel ?? '');
  const subject = normalizeLabel(entry.subject ?? '');
  const sectionSubject = /^(?:확률과통계|미적분(?:i|ii)?|기하)$/.test(section) ? '수학'
    : /^(?:화법과작문|언어와매체)$/.test(section) ? '국어' : undefined;
  // A concrete elective heading cannot be contradicted by a broader masthead
  // or a selected curriculum course. Chapter/page labels are not subjects.
  if (entry.subject && sectionSubject && subject !== sectionSubject && subject !== section) return false;
  return (!entry.sectionLabel || normalizeLabel(question.sectionLabel ?? '') === normalizeLabel(entry.sectionLabel))
    && (!entry.subject || subjectLabels(question).includes(normalizeLabel(entry.subject)));
}
const sameAnswer = (left: string, right: string) => clean(left) === clean(right);

/** No mutation: duplicates, missing scope, and existing different answers need review. */
export function previewAnswerMatches(questions: AnswerMatchQuestion[], entries: AnswerKeyEntry[]): AnswerMatch[] {
  const matches: AnswerMatch[] = entries.map(entry => {
    const candidates = entry.sourceItemId
      ? questions.filter(question => question.sourceItemId === entry.sourceItemId)
      : questions.filter(question => (question.sourceQuestionNumber ?? question.number) === entry.number && compatibleScope(question, entry));
    const questionNumbers = candidates.map(question => question.number);
    if (!candidates.length) return { entry, status: 'unmatched', questionNumbers, message: entry.sourceItemId ? '같은 문항 코드의 문항을 찾지 못했습니다. 번호만으로 연결하지 않았습니다.' : '같은 원본 번호와 과목·구분의 문항을 찾지 못했습니다.' };
    if (candidates.length > 1) return { entry, status: 'ambiguous', questionNumbers, message: entry.sourceItemId ? '같은 문항 코드가 여러 문항에 있습니다. 원본을 확인해 주세요.' : '같은 원본 번호의 문항이 여러 개입니다. 과목·구분을 확인해 주세요.' };
    if (entry.sourceItemId && ((entry.number !== undefined && (candidates[0].sourceQuestionNumber ?? candidates[0].number) !== entry.number) || !compatibleScope(candidates[0], entry)))
      return { entry, status: 'conflict', questionNumbers, message: '문항 코드는 같지만 원본 번호 또는 과목·구분 정보가 다릅니다. 직접 확인해 주세요.' };
    const previous = candidates[0].answer;
    if (previous !== undefined && previous.trim() && !sameAnswer(previous, entry.value))
      return { entry, status: 'conflict', questionNumbers, message: `기존 정답(${previous})과 다릅니다. 직접 확인해 주세요.` };
    return { entry, status: 'matched', questionNumbers, message: previous?.trim() ? '기존 정답과 같습니다.' : entry.sourceItemId ? '문항 코드와 원본 문항 정보가 일치합니다.' : '원본 번호와 과목·구분이 일치합니다.' };
  });
  // Even identical duplicate rows require an explicit choice: repeated booklets
  // without a label cannot be distinguished from accidentally repeated entries.
  const byQuestion = new Map<number, AnswerMatch[]>();
  for (const match of matches) {
    if (match.questionNumbers.length !== 1) continue;
    const number = match.questionNumbers[0];
    byQuestion.set(number, [...(byQuestion.get(number) ?? []), match]);
  }
  for (const duplicates of byQuestion.values()) {
    if (duplicates.length < 2) continue;
    const different = duplicates.some(match => !sameAnswer(match.entry.value, duplicates[0].entry.value));
    for (const match of duplicates) {
      match.status = different || match.status === 'conflict' ? 'conflict' : 'ambiguous';
      match.message = different ? '하나의 문항에 서로 다른 정답이 있습니다. 사용할 정답을 직접 선택해 주세요.' : '하나의 문항에 정답 행이 중복되어 있습니다. 사용할 행을 직접 선택해 주세요.';
    }
  }
  return matches;
}
