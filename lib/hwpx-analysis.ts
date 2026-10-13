import { parseHwpx, type HwpxBlock, type HwpxImportDocument } from './hwpx-import';
import type { AnalyzedQuestion, StandardRecord } from './pdf-analysis';
import { detectExamSubject } from './exam-subject';
import { normalizeQuestionText } from './math-normalization';
import { sourceBasename } from './question-context';

type Group = { number: number; label?: string; code?: string; body: HwpxBlock[]; answer: HwpxBlock[]; explanation: HwpxBlock[] };
const emptyGroup = (number: number, label?: string, code?: string): Group => ({ number, label, code, body: [], answer: [], explanation: [] });
const join = (blocks: HwpxBlock[]) => blocks.map(block => block.text).join('\n').trim();
const plain = (blocks: HwpxBlock[]) => blocks.map(block => block.plainText).join('\n').trim();

function imagesIn(blocks: HwpxBlock[]): Set<string> {
  const ids = new Set<string>();
  for (const block of blocks) {
    if (block.kind === 'table') for (const cell of block.cells) for (const id of imagesIn(cell.blocks)) ids.add(id);
    else for (const run of block.runs) if (run.kind === 'image') ids.add(run.imageId);
  }
  return ids;
}

/** Only explicit book delimiters, never subject matter or expected answers. */
function markedBook(blocks: HwpxBlock[]): Group[] | undefined {
  if (!blocks.some(block => /#문항코드(?:\s|$)/.test(block.plainText))) return undefined;
  const groups: Group[] = [];
  let group: Group | undefined;
  let stage: 'body' | 'answer' | 'explanation' | undefined;
  let started = false;
  let answered = false;
  const finish = () => {
    if (!group) return;
    if (!started || !plain(group.body) || !answered) throw new Error(`${group.code}의 [문제]·본문·[정답/모범답안] 구분을 찾지 못했습니다. 문항을 누락하지 않도록 가져오기를 중단했습니다.`);
    groups.push(group);
  };
  for (const block of blocks) {
    const text = block.plainText.trim();
    if (/^#강\s+/.test(text) && /#문항코드\s+/.test(text)) {
      finish();
      const unit = /#강\s+(\S+)/.exec(text)?.[1];
      const page = /#쪽\s+(\d+)(?=\s|$)/.exec(text)?.[1];
      const number = /#번\s+(\d+)(?=\s|$)/.exec(text)?.[1];
      const code = /#문항코드\s+([^\s#]+)/.exec(text)?.[1];
      if (!number || !code || code.length > 200 || Number(number) < 1 || Number(number) > 10000) throw new Error('도서의 문항 번호·고유 코드 정보를 확인해 주세요.');
      group = emptyGroup(Number(number), [unit && `${unit}강`, page && `${page}쪽`].filter(Boolean).join(' · ') || undefined, code);
      stage = undefined; started = false; answered = false;
      continue;
    }
    if (block.kind === 'paragraph' && /^\[문제\]$/.test(text)) {
      if (!group || started) throw new Error('도서 문항 구분이 중복되거나 고유 코드가 없습니다.');
      stage = 'body'; started = true; continue;
    }
    if (/#문항코드(?:\s|$)/.test(text)) throw new Error('도서 문항 코드 구분을 읽지 못했습니다. #강·#번·#문항코드 정보를 확인하세요.');
    if (block.kind === 'paragraph' && /^\[정답\s*\/\s*모범답안\]$/.test(text)) {
      if (!group || stage !== 'body' || answered) throw new Error('정답 구분의 순서가 잘못되었거나 중복되었습니다.');
      stage = 'answer'; answered = true; continue;
    }
    if (block.kind === 'paragraph' && /^\[해설\]$/.test(text)) {
      if (!group || stage !== 'answer') throw new Error('해설 구분의 순서가 잘못되었거나 중복되었습니다.');
      stage = 'explanation'; continue;
    }
    if (/^교재명\s+[\s\S]*\bPage\b/i.test(text)) continue;
    if (group && stage) group[stage].push(block);
  }
  finish();
  if (!groups.length) throw new Error('도서의 문항 코드와 [문제] 구분을 찾지 못했습니다.');
  const codes = groups.map(group => group.code);
  if (new Set(codes).size !== codes.length) throw new Error('중복 문항 코드가 있습니다. 서로 다른 문항을 덮어쓰지 않도록 중단했습니다.');
  return groups;
}

/** Exam mode recognizes numbered paragraphs, not numbers inside data tables. */
function numberedExam(blocks: HwpxBlock[]): Group[] {
  if (blocks.some(block => /\[\s*\d+\s*[~～〜–-]\s*\d+\s*\]/.test(block.plainText))) throw new Error('HWPX 공통 지문 세트는 아직 지원하지 않습니다. 지문 누락을 막기 위해 중단했습니다. 문항별로 지문을 포함하거나 PDF로 저장해 주세요.');
  const groups: Group[] = [];
  let group: Group | undefined;
  let label: string | undefined;
  const expanded = blocks.flatMap(block => block.kind === 'table' && block.cells.length === 1
    && block.cells[0].blocks.some(child => child.kind === 'paragraph' && /^\s*\d{1,4}[.)]\s*\S/.test(child.plainText)) ? block.cells[0].blocks : [block]);
  for (const block of expanded) {
    const text = block.plainText.trim();
    const heading = block.kind === 'paragraph' && text.match(/^(?:\[\s*)?(공통|확률\s*과\s*통계|미적분|기하|\d{1,2}\s*단원\s*[:：]?[^?？]{0,60})(?:\s*\])?$/);
    if (heading) { if (group) { groups.push(group); group = undefined; } label = heading[1].trim(); continue; }
    const start = block.kind === 'paragraph' && !/^\d+\.\d/.test(text) && text.match(/^\s*(?:(?:문항|문제)\s*)?(\d{1,4})\s*(?:[.)]|번(?:\s*문항)?)\s*(\S.*)$/);
    if (start && Number(start[1]) >= 1 && Number(start[1]) <= 10000) {
      if (group) groups.push(group);
      group = emptyGroup(Number(start[1]), label);
    }
    if (group) group.body.push(block);
  }
  if (group) groups.push(group);
  if (!groups.length) throw new Error('HWPX에서 명시적인 문항 번호를 찾지 못했습니다. 본문의 각 문항을 “1. 문제 내용” 형식으로 표시하거나 PDF로 저장해 주세요.');
  return groups;
}

export function extractHwpxQuestions(document: HwpxImportDocument, fingerprint: string, fileName: string, catalog: StandardRecord[]): AnalyzedQuestion[] {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('HWPX 원본 식별자가 올바르지 않습니다.');
  if (document.notes.length) throw new Error('각주·미주가 포함된 HWPX는 아직 지원하지 않습니다. 정답·해설 누락을 막기 위해 중단했습니다. 주석을 본문으로 옮기거나 PDF로 저장해 주세요.');
  const groups = markedBook(document.blocks) ?? numberedExam(document.blocks);
  if (groups.length > 1000) throw new Error(`HWPX에 ${groups.length}문항이 있습니다. 한 번에 1,000문항 이하로 나누어 주세요. 일부만 잘라 저장하지 않았습니다.`);
  const header = document.blocks.slice(0, 12).map(block => block.plainText).join('\n') + '\n' + fileName;
  const subject = detectExamSubject(header, catalog, 1);
  const seen = new Set<string>();
  return groups.map((group, index) => {
    const identity = `${group.label ?? ''}:${group.number}`;
    const repeated = seen.has(identity); seen.add(identity);
    const collectImages = (blocks: HwpxBlock[]) => {
      const ids = imagesIn(blocks);
      if ([...ids].some(id => !document.images.some(image => image.id === id))) throw new Error('문항에 연결된 HWPX 그림을 읽지 못했습니다. 그림 누락을 막기 위해 중단했습니다. PNG/JPEG/BMP로 저장하거나 PDF를 사용하세요.');
      if (document.images.some(image => ids.has(image.id) && !['image/png', 'image/jpeg'].includes(image.mimeType))) throw new Error('HWPX에 지원하지 않는 그림 형식이 있습니다. PNG/JPEG/BMP 그림으로 저장해 다시 가져오세요.');
      const images = document.images.filter(image => ids.has(image.id)).map(image => ({ id: image.id, image: image.dataUrl, label: `HWPX 삽입 그림 ${image.id}` }));
      if (images.length > 40) throw new Error('한 문항의 삽입 그림이 40개를 넘습니다. 문항 경계를 확인해 주세요.');
      return images.length ? images : undefined;
    };
    const answer = plain(group.answer);
    const validAnswer = answer && answer.length <= 500 && !/[\uE000-\uF8FF\uFFFD]/u.test(answer) ? answer : undefined;
    const text = normalizeQuestionText(join(group.body));
    const explanation = normalizeQuestionText(join(group.explanation));
    const warnings = [
      repeated && !group.code ? '동일 구분·문항 번호가 반복됩니다. 정답 연결 전에 문항 경계를 확인하세요.' : '',
      /\[한글 수식/.test(text) ? '지원하지 않는 한글 수식이 원문 스크립트로 남아 있습니다. 한글 원문과 대조해 편집하세요.' : '',
      /\[한글 수식/.test(explanation) ? '해설에 지원하지 않는 한글 수식이 있습니다. 원문 스크립트를 보존했으므로 해설을 펼쳐 대조하세요.' : '',
      answer && !validAnswer ? '정답을 안전하게 읽지 못했습니다. 원문 [정답/모범답안]을 확인하세요.' : '',
    ].filter(Boolean);
    return {
      number: index + 1, sourceQuestionNumber: group.number, sectionLabel: group.label,
      sourceItemId: group.code, sourceFormat: 'hwpx', sourceFingerprint: fingerprint,
      type: `HWPX 구조 추출${group.code ? ` · ${group.code}` : ''}`, text,
      standardCode: '', standard: '', domain: '', confidence: 0,
      questionCaptures: [], sourceImages: collectImages(group.body), explanationImages: collectImages(group.explanation),
      explanation: explanation || undefined, answer: validAnswer,
      answerSource: validAnswer ? sourceBasename(fileName) : undefined,
      examSubject: subject, analysisWarning: warnings.join(' ') || undefined,
    };
  });
}

export async function analyzeHwpx(file: File, catalog: StandardRecord[], progress?: (completed: number, total: number) => void) {
  progress?.(0, 1);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');
  const document = await parseHwpx(bytes);
  const questions = extractHwpxQuestions(document, fingerprint, file.name, catalog);
  progress?.(1, 1);
  return { questions, sourcePages: [] as string[], pageCount: 0, qualityWarning: document.warnings.join(' ') };
}
