/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const assert = require('node:assert/strict');
const test = require('node:test');
const { parseAnswerKeyText, parseAnswerKeyPages, previewAnswerMatches } = require('../lib/answer-key.ts');

const values = result => result.entries.map(({ number, value }) => [number, value]);
const part = (text, x, y, width = text.length * 7) => ({ text, x, y, width, height: 12 });

test('plain pairs preserve zero, negative, fractions, and choice marks without limiting answers to 1–5', () => {
  const result = parseAnswerKeyText('정답\n1. ①\n2: 0\n3번 -12\n4 3/7\n5 정답: 백두산\n6 [정답] ㄱ, ㄴ\n7. 123\n8. ①, ③', { sourceFileName: '답안.txt' });
  assert.deepEqual(values(result), [[1, '①'], [2, '0'], [3, '-12'], [4, '3/7'], [5, '백두산'], [6, 'ㄱ, ㄴ'], [7, '123'], [8, '①, ③']]);
  assert.ok(result.entries.every(entry => entry.sourceFileName === '답안.txt'));
  assert.deepEqual(result.warnings, []);
});

test('empty files and page markers do not become answer entries', () => {
  assert.deepEqual(values(parseAnswerKeyText(' \n\n')), []);
  assert.deepEqual(values(parseAnswerKeyText('1\n- 2 -\n3 / 8\n4쪽\nPage 5\n2026학년도\n1.5\n1. 다음 글을 읽으시오.\n2. 1.5 km인 길을 이동하였다.')), []);
});

test('explanations are not interpreted as implicit answer pairs', () => {
  const result = parseAnswerKeyText('정답\n1 ③\n해설\n1. 3\n2 0\n3. 정답은 ⑤이다.\n4 정답 ④ 해설: 이유가 있다.\n5 정답 ⑤ 이므로 답이다.\n수학\n6 2\n정답표\n7 0');
  assert.deepEqual(values(result), [[1, '③'], [7, '0']]);
});

test('explicit whole-line answer labels are usable within an explanation document', () => {
  assert.deepEqual(values(parseAnswerKeyText('해설\n1. [정답] ②\n따라서 x=3이다.\n2. 풀이 0이 정답이다.')), [[1, '②']]);
});

test('headered CSV supports quoted short answers and scoped duplicate numbers', () => {
  const result = parseAnswerKeyText('\uFEFF과목,구분,번호,정답,해설\r\n수학,미적분,23,0,"다른 설명"\r\n수학,기하,23,"ㄱ, ㄴ",설명\r\n국어,,1,"백두 산",본문', { format: 'csv' });
  assert.deepEqual(values(result), [[23, '0'], [23, 'ㄱ, ㄴ'], [1, '백두 산']]);
  assert.deepEqual(result.entries.map(entry => [entry.subject, entry.sectionLabel]), [['수학', '미적분'], ['수학', '기하'], ['국어', undefined]]);
  assert.ok(!result.entries.some(entry => entry.value.includes('설명')));
});

test('malformed CSV, empty answers and ambiguous extra columns never create entries', () => {
  assert.equal(parseAnswerKeyText('번호,정답\n1,"0', { format: 'csv' }).entries.length, 0);
  assert.equal(parseAnswerKeyText('번호,정답\n1,"0"x', { format: 'csv' }).entries.length, 0);
  const result = parseAnswerKeyText('번호,정답\n1,\n2,0\n-1,③\n3,4,5\n0,2', { format: 'csv' });
  assert.deepEqual(values(result), [[2, '0']]);
  assert.equal(result.warnings.length, 4);
  assert.deepEqual(values(parseAnswerKeyText('1,0\n2,-7\n3,11/4')), [[1, '0'], [2, '-7'], [3, '11/4']]);
  assert.deepEqual(values(parseAnswerKeyText('번호,과목\n1,수학', { format: 'csv' })), []);
  assert.deepEqual(values(parseAnswerKeyText('번호,정답,정답\n1,0,1', { format: 'csv' })), []);
});

test('horizontal and vertical text tables retain their explicit schema', () => {
  const horizontal = parseAnswerKeyText('수학 (미적분)\n문항\t23\t24\t25\n정답\t0\t-4\t1/3\n문항\t26\t27\n정답\t③');
  assert.deepEqual(values(horizontal), [[23, '0'], [24, '-4'], [25, '1/3']]);
  assert.ok(horizontal.entries.every(entry => entry.subject === '수학' && entry.sectionLabel === '미적분'));
  assert.equal(horizontal.warnings.length, 1);
  const vertical = parseAnswerKeyText('과목\t구분\t번호\t정답\n수학\t미적분\t23\t백두 산\n수학\t기하\t23\t0\n수학\t기하\t24\t');
  assert.deepEqual(values(vertical), [[23, '백두 산'], [23, '0']]);
});

test('paired rows and scope changes do not carry an old elective into a different subject', () => {
  const result = parseAnswerKeyText('과목: 수학\n구분: 미적분\n23. ③ 24. 0\n영어\n1 ② 2 -1');
  assert.deepEqual(values(result), [[23, '③'], [24, '0'], [1, '②'], [2, '-1']]);
  assert.equal(result.entries[0].sectionLabel, '미적분');
  assert.equal(result.entries[2].subject, '영어');
  assert.equal(result.entries[2].sectionLabel, undefined);
});

test('positioned PDF cells keep column-aligned pairs and source pages', () => {
  const result = parseAnswerKeyPages([{ page: 2, items: [
    part('수학', 30, 10), part('문항', 30, 50), part('1', 100, 50), part('2', 140, 50), part('3', 180, 50),
    part('정답', 30, 70), part('①', 100, 70), part('0', 140, 70), part('-2', 180, 70),
    part('2', 270, 800),
  ] }], { sourceFileName: '정답.pdf' });
  assert.deepEqual(values(result), [[1, '①'], [2, '0'], [3, '-2']]);
  assert.ok(result.entries.every(entry => entry.subject === '수학' && entry.sourcePage === 2 && entry.sourceFileName === '정답.pdf'));
});

test('positioned PDF tables under parallel subject headings remain separate', () => {
  const result = parseAnswerKeyPages([{ page: 1, items: [
    part('국어', 70, 10), part('수학', 330, 10),
    part('번호', 30, 40), part('정답', 110, 40), part('번호', 290, 40), part('정답', 370, 40),
    part('1', 30, 60), part('④', 110, 60), part('1', 290, 60), part('0', 370, 60),
    part('2', 30, 80), part('⑤', 110, 80), part('2', 290, 80), part('-1', 370, 80),
  ] }]);
  assert.deepEqual(result.entries.map(entry => [entry.subject, entry.number, entry.value]), [['국어', 1, '④'], ['국어', 2, '⑤'], ['수학', 1, '0'], ['수학', 2, '-1']]);
  assert.equal(new Set(result.entries.map(entry => entry.id)).size, 4);
});

test('unreadable PDF glyphs are warned and never guessed from their position', () => {
  const result = parseAnswerKeyPages([{ page: 1, items: [part('번호 1 2', 20, 30), part('정답 \uE000 0', 20, 50)] }]);
  assert.deepEqual(result.entries, []);
  assert.equal(result.warnings.length, 1);
});

test('printed numbers and exact sections determine targets rather than internal ordering', () => {
  const questions = [
    { number: 1, sourceQuestionNumber: 23, sectionLabel: '미적분', examSubject: { label: '수학' } },
    { number: 2, sourceQuestionNumber: 23, sectionLabel: '기하', examSubject: { label: '수학' } },
  ];
  const entries = parseAnswerKeyText('수학 (미적분)\n23 0\n기하\n23 ③').entries;
  const result = previewAnswerMatches(questions, entries);
  assert.deepEqual(result.map(match => [match.status, match.questionNumbers]), [['matched', [1]], ['matched', [2]]]);
  assert.equal(questions[0].answer, undefined);
  assert.equal(previewAnswerMatches(questions, [{ id: 'x', number: 23, value: '0' }])[0].status, 'ambiguous');
});

test('an explicit unknown scope never falls back to a number-only match', () => {
  const questions = [{ number: 1, sourceQuestionNumber: 23, sectionLabel: '미적분', examSubject: { label: '수학' }, domain: '영어' }];
  for (const scope of [{ sectionLabel: '기하' }, { subject: '영어' }, { subject: '수학', sectionLabel: '공통' }]) {
    assert.equal(previewAnswerMatches(questions, [{ id: 'x', number: 23, value: '0', ...scope }])[0].status, 'unmatched');
  }
  assert.equal(previewAnswerMatches([{ number: 1, domain: '수학' }], [{ id: 'x', number: 1, value: '0', subject: '수학' }])[0].status, 'unmatched');
});

test('subject labels discriminate equal source numbers while curriculum candidates do not override mastheads', () => {
  const questions = [
    { number: 1, sourceQuestionNumber: 1, examSubject: { label: '국어' }, selectedSubjectKey: '고등학교|영어' },
    { number: 2, sourceQuestionNumber: 1, examSubject: { label: '영어' } },
  ];
  const entries = parseAnswerKeyText('국어\n1 ②\n영어\n1 0').entries;
  assert.deepEqual(previewAnswerMatches(questions, entries).map(match => match.questionNumbers), [[1], [2]]);
  assert.equal(previewAnswerMatches([{ number: 1, selectedSubjectKey: '고등학교|수학' }], [{ id: 'x', number: 1, value: '0', subject: '수학' }])[0].status, 'matched');
});

test('duplicate rows and changed existing answers require review; zero is a real answer', () => {
  const questions = [{ number: 1, answer: '0' }];
  const entry = { id: 'a', number: 1, value: '0' };
  assert.equal(previewAnswerMatches(questions, [entry])[0].status, 'matched');
  assert.equal(previewAnswerMatches(questions, [{ ...entry, value: '1' }])[0].status, 'conflict');
  assert.deepEqual(previewAnswerMatches(questions, [entry, { ...entry, id: 'b' }]).map(match => match.status), ['ambiguous', 'ambiguous']);
  assert.deepEqual(previewAnswerMatches(questions, [entry, { ...entry, id: 'b', value: '1' }]).map(match => match.status), ['conflict', 'conflict']);
});

const markedItem = (code, page, number, answer, unit = '01') => `#강 ${unit} #쪽 ${page} #번 ${number} #문항코드 ${code}\n[문제]\n합성 시험 문항이다.\n1 3\n[정답/모범답안]\n\n${answer}\n\n[해설]\n1 4\n1. 정답: ⑤\n`;

test('marked books preserve repeated printed numbers with explicit item codes and page scope', () => {
  const result = parseAnswerKeyText(markedItem('sample-0001', '006', '001', '2') + markedItem('sample-0002', '007', '001', '0'), { sourceFileName: 'synthetic.hwpx' });
  assert.deepEqual(result.entries.map(entry => [entry.sourceItemId, entry.sectionLabel, entry.number, entry.value, entry.sourcePage]), [
    ['sample-0001', '01강 · 006쪽', 1, '2', 6], ['sample-0002', '01강 · 007쪽', 1, '0', 7],
  ]);
  assert.deepEqual(result.warnings, []);
  assert.ok(result.entries.every(entry => entry.sourceFileName === 'synthetic.hwpx'));
  assert.deepEqual(previewAnswerMatches([
    { number: 41, sourceQuestionNumber: 1, sourceItemId: 'sample-0001', sectionLabel: '01강 · 006쪽' },
    { number: 42, sourceQuestionNumber: 1, sourceItemId: 'sample-0002', sectionLabel: '01강 · 007쪽' },
  ], result.entries).map(match => [match.status, match.questionNumbers]), [['matched', [41]], ['matched', [42]]]);
});

test('marked books accept explicit numeric and circled answers without reading prose or a later paragraph', () => {
  const text = markedItem('a', '001', '001', '①') + markedItem('b', '002', '002', '-3/7')
    + markedItem('c', '003', '003', '정답은 3이다.\n3') + markedItem('d', '004', '004', '[해설]\n4')
    + markedItem('e', '005', '005', '③, ⑤');
  const result = parseAnswerKeyText(text, { format: 'text' });
  assert.deepEqual(values(result), [[1, '①'], [2, '-3/7'], [5, '③, ⑤']]);
  assert.ok(result.warnings.length >= 2);
});

test('missing or malformed book identities prevent numeric fallback and scope inheritance', () => {
  const text = markedItem('ok', '001', '001', '1')
    + '#강 01 #쪽 002 #번 001\n[정답/모범답안]\n2\n'
    + '#강 01 #쪽 003 #번 001 #번 002 #문항코드 duplicate-number\n[정답/모범답안]\n3\n'
    + '#강 01 #쪽 004 #번 000 #문항코드 invalid-zero-number\n[정답/모범답안]\n4\n';
  const result = parseAnswerKeyText(text);
  assert.deepEqual(result.entries.map(entry => entry.sourceItemId), ['ok']);
  assert.ok(result.warnings.length >= 3);
  const questions = [{ number: 1, sourceQuestionNumber: 1, sourceItemId: 'ok', sectionLabel: '01강 · 001쪽' }];
  const missing = { ...result.entries[0], sourceItemId: 'missing' };
  assert.equal(previewAnswerMatches(questions, [missing])[0].status, 'unmatched');
  assert.deepEqual(previewAnswerMatches([{ ...questions[0], sourceItemId: undefined }], result.entries)[0].questionNumbers, []);
});

test('matching book codes cannot conceal conflicting printed numbers, sections, subjects or duplicated codes', () => {
  const entry = parseAnswerKeyText(markedItem('same', '006', '001', '2')).entries[0];
  const question = { number: 88, sourceQuestionNumber: 1, sourceItemId: 'same', sectionLabel: '01강 · 006쪽', examSubject: { label: '수학' } };
  assert.equal(previewAnswerMatches([question], [{ ...entry, number: 2 }])[0].status, 'conflict');
  assert.equal(previewAnswerMatches([question], [{ ...entry, sectionLabel: '01강 · 007쪽' }])[0].status, 'conflict');
  assert.equal(previewAnswerMatches([question], [{ ...entry, subject: '영어' }])[0].status, 'conflict');
  assert.equal(previewAnswerMatches([question, { ...question, number: 89 }], [entry])[0].status, 'ambiguous');
  assert.deepEqual(previewAnswerMatches([question], [entry, { ...entry, id: 'duplicate', value: '3' }]).map(match => match.status), ['conflict', 'conflict']);
});

test('named book exercises match only explicit identity and never fall back to internal numbers', () => {
  const text = markedItem('practice', '@@', '유형 익히기', '3', '$$');
  const parsed = parseAnswerKeyText(text);
  assert.deepEqual(parsed.warnings, []);
  const [entry] = parsed.entries;
  assert.equal(entry.number, undefined); assert.equal(entry.sourceQuestionLabel, '유형 익히기');
  assert.equal(entry.sectionLabel, '$$강 · @@쪽'); assert.equal(entry.sourcePage, undefined);
  const question = { number: 19, sourceItemId: 'practice', sourceQuestionLabel: '유형 익히기', sectionLabel: '$$강 · @@쪽' };
  assert.equal(previewAnswerMatches([question], [entry])[0].status, 'matched');
  assert.equal(previewAnswerMatches([question], [{ id: 'number-only', number: 19, value: '3' }])[0].status, 'unmatched');
  for (const change of [{ number: 19 }, { sourceQuestionLabel: '다른 예제' }]) assert.equal(previewAnswerMatches([question], [{ ...entry, ...change }])[0].status, 'conflict');
  assert.equal(previewAnswerMatches([question], [{ id: 'code-only', sourceItemId: 'practice', value: '3' }])[0].status, 'matched');
  const csv = parseAnswerKeyText('문항 코드,원본 문항 번호,원본 문항 라벨,정답\npractice,,유형 익히기,3\ninvalid,19,유형 익히기,3', { format: 'csv' });
  assert.equal(csv.entries.length, 1); assert.equal(csv.warnings.length, 1);
  assert.equal(previewAnswerMatches([question], csv.entries)[0].status, 'matched');
});

test('related curriculum keys cannot identify an elective answer as the actual source subject', () => {
  const question = { number: 23, sectionLabel: '기하', examSubject: { label: '수학', subjectKeys: ['고등학교|수학', '고등학교|미적분Ⅰ', '고등학교|미적분Ⅱ', '고등학교|기하'] } };
  const entry = { id: 'a', number: 23, value: '3', subject: '미적분Ⅰ' };
  assert.equal(previewAnswerMatches([question], [entry])[0].status, 'unmatched');
  assert.equal(previewAnswerMatches([question], [{ ...entry, subject: '수학' }])[0].status, 'matched');
  // A manually selected curriculum or inconsistent masthead cannot contradict
  // an explicit elective section either.
  for (const source of [{ ...question, examSubject: { label: '미적분Ⅰ' } }, { number: 23, sectionLabel: '기하', selectedSubjectKey: '고등학교|미적분Ⅰ' }]) {
    assert.equal(previewAnswerMatches([source], [entry])[0].status, 'unmatched');
  }
  assert.equal(previewAnswerMatches([{ ...question, sourceItemId: 'exact' }], [{ ...entry, sourceItemId: 'exact' }])[0].status, 'conflict');
});

test('CSV source codes and numeric original-number aliases preserve repeated book identities', () => {
  const result = parseAnswerKeyText('원본 파일,문항 코드,원본 문항 번호,구분,정답\nbook.hwpx,a,1,01강 · 006쪽,0\nbook.hwpx,b,1,01강 · 007쪽,③');
  assert.deepEqual(result.entries.map(entry => [entry.sourceItemId, entry.number, entry.sectionLabel, entry.value]), [['a', 1, '01강 · 006쪽', '0'], ['b', 1, '01강 · 007쪽', '③']]);
  const codeOnly = parseAnswerKeyText('sourceItemId,answer\na,0\nb,3', { format: 'csv' });
  assert.ok(codeOnly.entries.every(entry => entry.number === undefined));
  assert.deepEqual(previewAnswerMatches([{ number: 99, sourceQuestionNumber: 7, sourceItemId: 'a' }], codeOnly.entries).map(match => [match.status, match.questionNumbers]), [['matched', [99]], ['unmatched', []]]);
  const blankNumber = parseAnswerKeyText('문항 코드,원본 문항 번호,정답\na,,0\nb,틀림,3\n,,4', { format: 'csv' });
  assert.deepEqual(blankNumber.entries.map(entry => entry.sourceItemId), ['a']);
  assert.equal(blankNumber.warnings.length, 2);
  assert.equal(parseAnswerKeyText('문항 코드,sourceItemId,정답\na,b,1', { format: 'csv' }).entries.length, 0);
});

test('only a declared CSV text encoding removes a protective answer apostrophe', () => {
  const encoded = parseAnswerKeyText('문항 코드,정답,정답 인코딩\na,\'-12,spreadsheet-text-v1\nb,\'\'-12,spreadsheet-text-v1\nc,0,spreadsheet-text-v1\nd,\'=1+1,spreadsheet-text-v1', { format: 'csv' });
  assert.deepEqual(encoded.entries.map(entry => entry.value), ['-12', "'-12", '0', '=1+1']);
  const literal = parseAnswerKeyText('번호,정답\n1,\'-12\n2,\'=1+1', { format: 'csv' });
  assert.deepEqual(literal.entries.map(entry => entry.value), ["'-12", "'=1+1"]);
  assert.equal(parseAnswerKeyText('번호,정답,정답 인코딩\n1,0,unknown', { format: 'csv' }).entries.length, 0);
});
