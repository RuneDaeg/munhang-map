/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createRequire } = require('node:module');
const { createCanvas } = createRequire(require.resolve('pdfjs-dist/package.json'))('@napi-rs/canvas');
const { createQuestionBank, questionSnapshot } = require('../local/question-bank.cjs');
const { readQuestionContext } = require('../lib/question-context.ts');
const { serializeReview, parseReview } = require('../lib/review-file.ts');
const { saveToQuestionBank, updateBankItem } = require('../lib/question-bank.ts');
const { questionStorageProblem } = require('../lib/question-storage-check.ts');
const { mathQualityIssues } = require('../lib/math-quality.ts');
const { parseAnswerKeyText, previewAnswerMatches } = require('../lib/answer-key.ts');
const { createDocxBytes, createHwpxBytesFromTemplate, createStandardArchive, createCaptureArchive, createAnswerCsvBytes } = require('../lib/document-export.ts');

const canvas = createCanvas(12, 16), jpeg = canvas.toDataURL('image/jpeg'), png = canvas.toDataURL('image/png');
const fingerprint = 'a'.repeat(64);
const base = { number: 1, type: 'test', text: '발문 $x^2$', standardCode: '[기준]', standard: '교사 선택', domain: '수학', confidence: 80,
  answer: 'ANSWER_PRIVATE', answerSource: '정답지.hwpx', assessmentText: '발문', mappingReason: '기존 분류 근거', validationFlags: [{ code: 'review', message: '확인' }], captureReviewed: true };
const pdf = { ...base, sourceFormat: 'pdf', sourcePageImage: jpeg, questionCaptures: [{ page: 1, box: [0, 0, .5, .5], image: jpeg }] };
const hwpx = { ...base, sourceFormat: 'hwpx', sourceFingerprint: fingerprint, sectionLabel: '단원 1', sourceQuestionNumber: 321,
  sourceImages: [{ id: 'image1', image: png, label: '자료 그림' }], questionCaptures: [] };
const templateNames = ['mimetype', 'version.xml', 'settings.xml', 'META-INF/container.xml', 'META-INF/manifest.xml', 'META-INF/container.rdf', 'Contents/content.hpf', 'Contents/header.xml', 'Contents/section0.xml', 'Preview/PrvImage.png', 'Preview/PrvText.txt'];
const template = new Map(templateNames.map(name => [name, new Uint8Array(fs.readFileSync(path.join(__dirname, '../public/hwpx-template', name)))]));
function unzip(bytes) {
  const buffer = Buffer.from(bytes), files = new Map();
  for (let offset = 0; buffer.readUInt32LE(offset) === 0x04034b50;) {
    const size = buffer.readUInt32LE(offset + 18), nameLength = buffer.readUInt16LE(offset + 26), extra = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString('utf8', offset + 30, offset + 30 + nameLength), start = offset + 30 + nameLength + extra;
    files.set(name, buffer.subarray(start, start + size)); offset = start + size;
  }
  return files;
}
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'munhang-answer-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, bank: createQuestionBank(directory) };
}

test('answer and source identity whitelist bounds text and removes parent directories', () => {
  const context = readQuestionContext({ ...hwpx, answer: 'x'.repeat(501), answerSource: 'C:\\private\\정답지.hwpx', apiKey: 'DO_NOT_COPY', sourcePageImage: jpeg });
  assert.equal(context.answer.length, 500); assert.equal(context.answerSource, '정답지.hwpx');
  assert.equal(context.sourceFingerprint, fingerprint); assert.equal(context.sourceQuestionNumber, 321);
  assert.deepEqual(context.sourceImages, hwpx.sourceImages); assert.equal(context.apiKey, undefined); assert.equal(context.sourcePageImage, undefined);
  assert.equal(readQuestionContext({ sourceFormat: 'hwpx', sourceFingerprint: '../invalid' }).sourceFormat, undefined);
  for (const sourceImages of [[{ id: '../image', image: png }], [{ id: 'image', image: 'https://example.test/image.png' }], [{ id: 'image', image: 'data:image/svg+xml;base64,PHN2Zz4=' }], Array(41).fill(hwpx.sourceImages[0])]) {
    assert.throws(() => readQuestionContext({ ...hwpx, sourceImages }), /HWPX/);
    assert.throws(() => questionSnapshot({ ...hwpx, sourceImages }, 'book.hwpx'), /HWPX/);
  }
});

test('HWPX review roundtrip preserves answers, identity and embedded images without page captures', async () => {
  const serialized = serializeReview('book.hwpx', [{ ...hwpx, apiKey: 'NEVER_STORE', answerSource: '/private/정답지.hwpx' }], []);
  assert.doesNotMatch(serialized, /NEVER_STORE|private/);
  const restored = await parseReview(serialized), question = restored.questions[0];
  assert.deepEqual(restored.sourcePages, []); assert.deepEqual(question.questionCaptures, []); assert.equal(question.sourcePageImage, undefined);
  for (const key of ['answer', 'answerSource', 'sourceFormat', 'sourceFingerprint', 'sourceImages', 'sectionLabel', 'sourceQuestionNumber']) assert.deepEqual(question[key], hwpx[key]);
  const raw = JSON.parse(serialized);
  for (const patch of [{ sourceFormat: undefined }, { sourceFingerprint: 'bad' }, { regions: [{ page: 1, box: [0, 0, 1, 1] }] }, { visualChoices: [{ label: '①' }] }]) {
    await assert.rejects(parseReview(JSON.stringify({ ...raw, questions: [{ ...raw.questions[0], ...patch }] })), /HWPX|캡처 범위/);
  }
});

test('PDF review remains backward compatible and continues to require original pages and valid captures', async t => {
  const previous = { Image: global.Image, document: global.document };
  t.after(() => Object.assign(global, previous));
  global.Image = class { naturalWidth = 100; naturalHeight = 100; set src(_value) { queueMicrotask(() => this.onload()); } };
  global.document = { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => jpeg }) };
  const serialized = serializeReview('exam.pdf', [pdf], [jpeg]);
  const restored = await parseReview(serialized);
  assert.equal(restored.questions[0].answer, pdf.answer); assert.equal(restored.questions[0].questionCaptures.length, 1);
  const raw = JSON.parse(serialized);
  await assert.rejects(parseReview(JSON.stringify({ ...raw, sourcePages: [] })), /HWPX/);
  await assert.rejects(parseReview(JSON.stringify({ ...raw, questions: [{ ...raw.questions[0], regions: [] }] })), /캡처 범위/);
  delete raw.questions[0].sourceFormat; delete raw.questions[0].answer; delete raw.questions[0].answerSource;
  assert.equal((await parseReview(JSON.stringify(raw))).questions[0].answer, undefined);
});

test('HWPX bank persists text-only entries across restart while PDF still requires captures', t => {
  const { directory, bank } = fixture(t);
  bank.save({ sourceFileName: 'book.hwpx', sourceFingerprint: fingerprint, questions: [hwpx] });
  const restored = createQuestionBank(directory), id = restored.list()[0].id, entry = restored.inspect(id);
  for (const key of ['text', 'answer', 'answerSource', 'sourceFormat', 'sourceFingerprint', 'sourceImages', 'sectionLabel', 'sourceQuestionNumber']) assert.deepEqual(entry.question[key], hwpx[key]);
  for (const question of [{ ...pdf, questionCaptures: [] }, { ...hwpx, sourceFormat: undefined }, { ...hwpx, sourceFingerprint: 'bad' }]) {
    assert.throws(() => bank.save({ sourceFileName: 'bad', sourceFingerprint: fingerprint, questions: [question] }), /캡처|HWPX/);
  }
  assert.throws(() => bank.save({ sourceFileName: 'book.hwpx', sourceFingerprint: 'b'.repeat(64), questions: [hwpx] }), /일치/);
  assert.equal(restored.list().length, 1);
});

test('answer-only bank update preserves other metadata and sibling; stale write fails', t => {
  const { bank } = fixture(t);
  bank.save({ sourceFileName: 'book.hwpx', sourceFingerprint: fingerprint, questions: [hwpx, { ...hwpx, number: 2 }] });
  const [first, second] = bank.list(), entry = bank.inspect(first.id), sibling = bank.inspect(second.id);
  const updated = bank.update({ id: entry.id, revision: entry.revision, text: entry.question.text, answer: '③', sourceImages: [], standardCode: 'INJECT', sourceFingerprint: 'b'.repeat(64) });
  assert.deepEqual(updated.question, { ...entry.question, answer: '③' });
  assert.deepEqual(bank.inspect(second.id), sibling);
  assert.throws(() => bank.update({ id: entry.id, revision: entry.revision, text: entry.question.text, answer: '④' }), /덮어쓰지/);
  const editedText = bank.update({ id: updated.id, revision: updated.revision, text: '변경한 본문' });
  assert.equal(editedText.question.answer, '③'); assert.deepEqual(editedText.question.sourceImages, hwpx.sourceImages);
  assert.throws(() => bank.update({ ...editedText, text: '변경', answer: 'x'.repeat(501) }), /500자/);
});

test('browser saves use source-byte HWPX fingerprint and preserve legacy edit request shape', async t => {
  const originalFetch = global.fetch; t.after(() => { global.fetch = originalFetch; });
  const payloads = [];
  global.fetch = async (_url, options) => { const body = JSON.parse(options.body); payloads.push(body); return Response.json({ saved: 1, updated: payloads.length > 1 }); };
  await saveToQuestionBank('book.hwpx', [hwpx], []);
  await saveToQuestionBank('book.hwpx', [{ ...hwpx, answer: '②' }], []);
  assert.equal(payloads[0].sourceFingerprint, fingerprint); assert.equal(payloads[1].sourceFingerprint, fingerprint);
  assert.equal(payloads[0].sourcePages, undefined); assert.equal(payloads[0].questions[0].answer, hwpx.answer);
  const entry = { id: `${fingerprint}:${fingerprint}`, revision: fingerprint, question: hwpx };
  await updateBankItem(entry, hwpx.text); assert.deepEqual(Object.keys(payloads.at(-1)).sort(), ['id', 'revision', 'text']);
  await updateBankItem(entry, hwpx.text, '⑤'); assert.equal(payloads.at(-1).answer, '⑤');
  const count = payloads.length;
  await assert.rejects(saveToQuestionBank('bad.pdf', [pdf], []), /분석/);
  await assert.rejects(updateBankItem(entry, hwpx.text, 'x'.repeat(501)), /500자/); assert.equal(payloads.length, count);
});

test('book review and bank accept 321 HWPX questions, with explicit 1000 cap and unchanged PDF cap', async t => {
  const { bank } = fixture(t);
  const questions = Array.from({ length: 321 }, (_, index) => ({ ...hwpx, sourceImages: [], number: index + 1, sourceQuestionNumber: index + 1 }));
  assert.equal((await parseReview(serializeReview('book.hwpx', questions, []))).questions.length, 321);
  bank.save({ sourceFileName: 'book.hwpx', sourceFingerprint: fingerprint, questions }); assert.equal(bank.list().length, 321);
  assert.throws(() => serializeReview('book.hwpx', Array(1001).fill(hwpx), []), /1,000/);
  assert.throws(() => bank.save({ sourceFileName: 'too-large.hwpx', sourceFingerprint: fingerprint, questions: Array(1001).fill(hwpx) }), /올바르지/);
  assert.throws(() => bank.save({ sourceFileName: 'too-large.pdf', sourceFingerprint: fingerprint, questions: Array(201).fill(pdf) }), /200문항/);
  assert.equal(bank.list().length, 321);
});

test('DOCX and HWPX exclude answers by default; opt-in exports literal answers without math parsing', () => {
  const question = { ...hwpx, answer: String.raw`ANSWER_PRIVATE $\bad{ <hp:equation> & "③"` };
  for (const format of ['docx', 'hwpx']) {
    const create = options => format === 'docx' ? createDocxBytes('교재', [question], options) : createHwpxBytesFromTemplate('교재', [question], template, options);
    assert.doesNotMatch(Buffer.from(create()).toString(), /ANSWER_PRIVATE|정답지.hwpx/);
    const bytes = create({ includeAnswers: true }), files = unzip(bytes);
    const content = files.get(format === 'docx' ? 'word/document.xml' : 'Contents/section0.xml').toString();
    assert.match(content, /ANSWER_PRIVATE/); assert.match(content, /&lt;hp:equation&gt;/); assert.match(content, /\\bad\{/);
    assert.match(content, /HWPX 삽입 그림 \(원문 페이지 캡처 아님\)/);
    assert.deepEqual([...files].find(([name]) => name.endsWith('/question1.png'))[1], Buffer.from(png.split(',')[1], 'base64'));
    if (format === 'hwpx') assert.match(files.get('Preview/PrvText.txt').toString(), /ANSWER_PRIVATE/);
  }
  assert.throws(() => createDocxBytes('bad', [{ ...hwpx, sourceFingerprint: 'bad' }]), /HWPX/);
});

test('grouped document and capture CSV include answer metadata only when explicitly enabled', async t => {
  const originalFetch = global.fetch; t.after(() => { global.fetch = originalFetch; });
  global.fetch = async url => new Response(fs.readFileSync(path.join(__dirname, '../public', url)));
  for (const format of ['docx', 'hwpx']) {
    const omitted = unzip(await createStandardArchive('교재', [hwpx], format));
    assert.doesNotMatch(Buffer.from([...omitted.values()].flatMap(value => [...value])).toString(), /ANSWER_PRIVATE|정답 출처/);
    const included = unzip(await createStandardArchive('교재', [hwpx], format, undefined, { includeAnswers: true }));
    assert.match(included.get('문항목록.csv').toString(), /ANSWER_PRIVATE/); assert.match(included.get('문항목록.csv').toString(), /정답지.hwpx/);
  }
  const omitted = unzip(await createCaptureArchive('시험', [pdf], undefined, { groupByStandard: true }));
  assert.doesNotMatch(omitted.get('문항목록.csv').toString(), /ANSWER_PRIVATE|정답 출처/);
  const included = unzip(await createCaptureArchive('시험', [pdf], undefined, { groupByStandard: true, includeAnswers: true }));
  assert.match(included.get('문항목록.csv').toString(), /ANSWER_PRIVATE/);
  await assert.rejects(createCaptureArchive('교재', [hwpx]), /캡처가 없는/);
});

test('answer CSV neutralizes spreadsheet formulas and strips local directories', () => {
  const csv = Buffer.from(createAnswerCsvBytes('book.hwpx', [{ ...hwpx, sourceFileName: '/private/book.hwpx', answer: '\u200b=SUM(1,2)', answerSource: 'C:\\private\\정답.csv' }])).toString();
  assert.match(csv, /"'\u200b=SUM\(1,2\)"/); assert.match(csv, /정답.csv/); assert.doesNotMatch(csv, /private|C:\\/);
  assert.ok(csv.startsWith('\uFEFF'));
});

test('answer CSV exports separate identities and roundtrips editable answers to the exact original questions', () => {
  const questions = [
    { ...hwpx, number: 8, sourceQuestionNumber: 23, sourceItemId: 'SYNTH-0001', sectionLabel: '01강 · 006쪽', answer: '③' },
    { ...hwpx, number: 9, sourceQuestionNumber: 23, sourceItemId: 'SYNTH-0002', sectionLabel: '01강 · 006쪽', answer: '-12' },
    { ...pdf, number: 10, sourceQuestionNumber: 23, sectionLabel: '기하', answer: '0' },
    { ...pdf, number: 11, sourceQuestionNumber: 23, sectionLabel: '미적분', answer: 'ㄱ, ㄴ' },
    { ...hwpx, number: 12, sourceQuestionNumber: 24, sourceItemId: 'SYNTH-0003', sectionLabel: '01강 · 006쪽', answer: "'-12" },
    { ...hwpx, number: 13, sourceQuestionNumber: 25, sourceItemId: 'SYNTH-0004', sectionLabel: '01강 · 006쪽', answer: '=x+1' },
  ];
  const before = JSON.stringify(questions);
  const csv = Buffer.from(createAnswerCsvBytes('synthetic.hwpx', questions)).toString();
  assert.equal(csv.split('\r\n')[0], '\uFEFF"원본 파일","문항 코드","원본 문항 번호","구분","정답","정답 출처","성취기준 코드","성취기준 내용","성취기준 교과","정답 인코딩"');
  assert.match(csv, /"SYNTH-0001","23","01강 · 006쪽","③"/);
  const parsed = parseAnswerKeyText(csv, { format: 'csv', sourceFileName: 'synthetic_정답.csv' });
  assert.deepEqual(parsed.warnings, []);
  assert.deepEqual(parsed.entries.map(entry => [entry.sourceItemId, entry.number, entry.sectionLabel, entry.value]), [
    ['SYNTH-0001', 23, '01강 · 006쪽', '③'], ['SYNTH-0002', 23, '01강 · 006쪽', '-12'], [undefined, 23, '기하', '0'], [undefined, 23, '미적분', 'ㄱ, ㄴ'],
    ['SYNTH-0003', 24, '01강 · 006쪽', "'-12"], ['SYNTH-0004', 25, '01강 · 006쪽', '=x+1'],
  ]);
  assert.deepEqual(previewAnswerMatches(questions, parsed.entries).map(match => [match.status, match.questionNumbers]), [['matched', [8]], ['matched', [9]], ['matched', [10]], ['matched', [11]], ['matched', [12]], ['matched', [13]]]);
  // Simulate changing just the answer cell in the exported sheet. The existing
  // answer remains a conflict requiring confirmation, while identity is exact.
  const edited = csv.replace('"SYNTH-0001","23","01강 · 006쪽","③"', '"SYNTH-0001","23","01강 · 006쪽","⑤"');
  const editedEntries = parseAnswerKeyText(edited, { format: 'csv' }).entries;
  assert.deepEqual(previewAnswerMatches(questions, editedEntries)[0].questionNumbers, [8]);
  assert.equal(previewAnswerMatches(questions, editedEntries)[0].status, 'conflict');
  assert.equal(previewAnswerMatches(questions.map(question => ({ ...question, answer: undefined })), editedEntries)[0].status, 'matched');
  assert.equal(editedEntries[0].value, '⑤'); assert.equal(JSON.stringify(questions), before);
});

test('answer CSV preserves only explicit source and standard metadata without private parent paths or document content', () => {
  const question = { ...hwpx, sourceFileName: '/PRIVATE_PARENT/book.hwpx', answerSource: 'C:\\PRIVATE_PARENT\\answers.csv', sourceItemId: 'SYNTH-0001', sectionLabel: '1단원', answer: '②',
    standardCode: '[선택한 기준]', standard: '선택한 성취기준, "인용"\n다음 줄', domain: '선택한 교과', text: 'PRIVATE_BODY', explanation: 'PRIVATE_EXPLANATION', assessmentText: 'PRIVATE_ASSESSMENT',
    apiKey: 'PRIVATE_API_KEY', apiSettings: { token: 'PRIVATE_TOKEN' }, sourceFingerprint: 'PRIVATE_FINGERPRINT', sourceImages: [{ id: 'PRIVATE_IMAGE_ID', image: 'PRIVATE_IMAGE' }],
    standardCandidates: [{ code: 'PRIVATE_CANDIDATE' }] };
  const csv = Buffer.from(createAnswerCsvBytes('/PRIVATE_TITLE/fallback.hwpx', [question])).toString();
  assert.match(csv, /"book.hwpx","SYNTH-0001"/); assert.match(csv, /"answers.csv","\[선택한 기준\]","선택한 성취기준, ""인용""\n다음 줄","선택한 교과"/);
  assert.doesNotMatch(csv, /PRIVATE_|data:image|sourceFingerprint|apiSettings/);
  const formulaCsv = Buffer.from(createAnswerCsvBytes('book.hwpx', [{ ...hwpx, sourceItemId: '=BAD()', sectionLabel: '+BAD()', standardCode: '@BAD()', standard: '-BAD()', domain: '\u200b=BAD()' }])).toString();
  for (const value of ['=BAD()', '+BAD()', '@BAD()', '-BAD()', '\u200b=BAD()']) assert.ok(formulaCsv.includes(`"'${value}"`));
});

test('book item codes and explanation assets roundtrip privately and survive text/answer edits', async t => {
  const { bank } = fixture(t);
  const question = { ...hwpx, sourceItemId: '26066-0001', explanation: 'EXPLANATION_PRIVATE $x^3$', explanationImages: [{ id: 'explain-image', image: jpeg }] };
  const restored = (await parseReview(serializeReview('book.hwpx', [question], []))).questions[0];
  for (const key of ['sourceItemId', 'explanation', 'explanationImages']) assert.deepEqual(restored[key], question[key]);
  bank.save({ sourceFileName: 'book.hwpx', sourceFingerprint: fingerprint, questions: [question] });
  const entry = bank.inspect(bank.list()[0].id);
  const updated = bank.update({ id: entry.id, revision: entry.revision, text: '수정한 발문', answer: '④' });
  for (const key of ['sourceItemId', 'explanation', 'explanationImages']) assert.deepEqual(updated.question[key], question[key]);
  bank.save({ sourceFileName: 'book.hwpx', sourceFingerprint: fingerprint, questions: [{ ...question, number: 19, answer: '⑤' }] });
  assert.equal(bank.list()[0].id, entry.id, 'source item identity survives numbering/answer changes');
  assert.throws(() => bank.save({ sourceFileName: 'book.hwpx', sourceFingerprint: fingerprint, questions: [question, { ...question, number: 2 }] }), /중복/);
  for (const options of [{}, { includeAnswers: true }]) {
    for (const bytes of [createDocxBytes('교재', [question], options), createHwpxBytesFromTemplate('교재', [question], template, options)]) {
      assert.doesNotMatch(Buffer.from(bytes).toString(), /EXPLANATION_PRIVATE/);
      assert.equal([...unzip(bytes).keys()].filter(name => /(?:word\/media|BinData)\//.test(name)).length, 1, 'explanation image is not part of student or answer-only exports');
    }
  }
  assert.throws(() => readQuestionContext({ ...question, explanation: 'x'.repeat(200001) }), /20만/);
  assert.throws(() => questionSnapshot({ ...question, explanationImages: [{ id: 'explain', image: 'https://example.test/private.png' }] }, 'book.hwpx'), /HWPX/);
});

test('explicit preserved HWPX native scripts remain literal and do not block storage as stray LaTeX', () => {
  for (const native of ['[한글 수식: MATRIX {a_{1} & b^{2} # c & d}]', '[한글 수식: LEFT [ a_{n} + b^{2} RIGHT ] ]']) {
    for (const text of [`자료 ${native} 다음 $x^2$`, `:::table\n| 구분 | 내용 |\n| 자료 | ${native} |\n:::`, `<b><u>${native}</u></b>`]) {
      assert.equal(questionStorageProblem(text), null, text);
      assert.ok(!mathQualityIssues(text).some(issue => issue.code === 'latex_outside_math'));
      const question = { ...hwpx, text, analysisWarning: '지원하지 않는 한글 수식이 원문 스크립트로 남아 있습니다.' };
      const before = JSON.stringify(question);
      for (const [format, bytes] of [['docx', createDocxBytes('합성 자료', [question])], ['hwpx', createHwpxBytesFromTemplate('합성 자료', [question], template)]]) {
        const files = unzip(bytes), content = files.get(format === 'docx' ? 'word/document.xml' : 'Contents/section0.xml').toString();
        assert.match(content, /\[한글 수식:/); assert.match(content, /a_\{(?:1|n)\}/);
      }
      assert.equal(JSON.stringify(question), before);
    }
  }
});

test('native-script exemptions cannot hide malformed ordinary LaTeX or damaged controls', () => {
  const native = '[한글 수식: MATRIX {a_{1}}]';
  for (const text of [`${native} x^{2}`, `${native} $\\notACommand{x}$`, `${native} $x^{2$`, `${native} $\\frac{1}{2}`, '[한글 수식: x_{a}', '[한글 수식: x_{a}\n뒤 본문]', '[한글 수식:x_{a}]', '[한글 수식: a' + ' '.repeat(20001) + '_{1}]']) {
    assert.ok(questionStorageProblem(text), text.slice(0, 200));
  }
  assert.ok(mathQualityIssues('[한글 수식: MATRIX {a_{1}}' + String.fromCharCode(1) + ']').some(issue => issue.code === 'invalid_control_character'));
  assert.equal(questionStorageProblem(`${native} $x^2$`), null);
});
