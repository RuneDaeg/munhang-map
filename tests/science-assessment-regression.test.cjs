/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { classifyQuestion, parseStandardsCsv } = require('../lib/pdf-analysis.ts');
const { detectExamSubject } = require('../lib/exam-subject.ts');
const { scienceAssessmentScope } = require('../lib/science-assessment.ts');
const catalog = parseStandardsCsv(fs.readFileSync(path.join(__dirname, '../public/data/achievement-standards.csv'), 'utf8'));
const question = (label, text) => ({ number: 91, text, examSubject: detectExamSubject(label, catalog, 1) });

test('impulse and electric-force questions cannot rank unrelated tunnelling or mechanics standards', () => {
  for (const [text, pattern] of [
    ['충격량과 운동량에 관련된 스포츠와 에어백의 안전성을 설명하시오.', /충격량|운동량/],
    ['점전하 A와 B 사이의 전기력과 힘의 크기를 비교하시오.', /전기력|전하.*전기장|전하.*전기적/],
  ]) {
    const q = classifyQuestion(question('물리학 I', text), catalog);
    assert.ok(q.standardCandidates.length);
    assert.ok(q.standardCandidates.every(c => pattern.test(c.standard.replace(/\s/g, ''))));
    assert.ok(q.standardCandidates.every(c => catalog.some(row => row.code === c.code && row.statement === c.standard)));
    assert.match(q.mappingReason, /문항의 「/);
  }
});

test('a missing 2022 diagenesis criterion stays unresolved instead of a solar-observation guess', () => {
  const q = classifyQuestion(question('지구과학 I', '쇄설성 퇴적층에서 속성 작용과 교결 물질의 침전으로 밀도가 변한다.'), catalog);
  assert.equal(q.standardCode, '');
  assert.deepEqual(q.standardCandidates, []);
  assert.match(q.mappingReason, /판단을 보류/);
});

test('manual course selection is respected and an empty restricted catalogue never falls back', () => {
  const q = classifyQuestion(question('물리학 I', '충격량과 운동량의 관계'), catalog, '고등학교|전자기와 양자');
  assert.equal(q.standardCode, '');
  assert.deepEqual(q.standardCandidates, []);
  assert.equal(q.selectedSubjectKey, '고등학교|전자기와 양자');
});

test('a teacher changing to a different course family supersedes the old exam heading', () => {
  const q = classifyQuestion(question('물리학 I', '충격량이라는 말과 화학 반응의 에너지 관계를 비교한다.'), catalog, '고등학교|화학');
  assert.equal(q.selectedSubjectKey, '고등학교|화학');
  assert.ok(q.standardCandidates.length > 0);
  assert.ok(q.standardCandidates.every(c => c.domain === '고등학교 · 화학'));
  assert.equal(q.mappingArea, undefined);
});

const scienceTopics = [
  { label: '생명과학 I', text: '표의 생물의 특성 사례를 보고 항상성, 생식과 유전, 적응과 진화를 구분하시오.',
    statement: /생물(?:및생명과학)?의?특성/, area: '생물의 특성' },
  { label: '지구과학 I', text: '동일한 태풍의 영향을 받는 두 관측소의 기압, 풍속, 풍향으로 안전 반원 여부를 비교하시오.',
    statement: /태풍/, area: '태풍 영향권의 날씨' },
  { label: '지구과학 II', text: '해파의 주기가 일정할 때 수심에 따른 전파 속도와 파장을 비교하시오.',
    statement: /천해파|심해파|해파/, area: '해파의 전파와 수심' },
  { label: '지구과학 II', text: '정역학 평형과 지형류 평형인 해역에서 해수의 밀도 차이에 따른 수압과 유속을 비교하시오.',
    statement: /지형류/, area: '해수의 지형류 평형' },
];

test('strong biology and ocean-weather assessment evidence restricts candidates to catalogue statements', () => {
  for (const topic of scienceTopics) {
    const q = classifyQuestion(question(topic.label, topic.text), catalog);
    const expected = catalog.filter(row => row.school === '고등학교' && topic.statement.test(row.statement.replace(/\s/g, '')));
    assert.ok(expected.length);
    assert.ok(q.standardCandidates.length, topic.area);
    assert.ok(q.standardCandidates.every(c => expected.some(row => row.code === c.code && row.statement === c.standard)), topic.area);
    assert.equal(q.mappingArea, topic.area);
    assert.match(q.mappingReason, /문항의 「/);
    assert.equal(q.confidence, 0, 'topic evidence is not a calibrated correctness percentage');
  }
});

test('the topic guard follows supplied statements, not hard-coded standard identifiers', () => {
  for (const topic of scienceTopics) {
    const input = question(topic.label, topic.text);
    const matching = catalog.find(row => row.school === '고등학교' && topic.statement.test(row.statement.replace(/\s/g, '')));
    const supplied = [{ ...matching, code: '[CUSTOM-CRITERION]' }];
    assert.deepEqual(scienceAssessmentScope(input, supplied).catalog, supplied);
    const withoutTopic = catalog.filter(row => !topic.statement.test(row.statement.replace(/\s/g, '')));
    const q = classifyQuestion(input, withoutTopic);
    assert.equal(q.standardCode, '', topic.area);
    assert.deepEqual(q.standardCandidates, [], topic.area);
    assert.match(q.mappingReason, /판단을 보류/, topic.area);
  }
});

test('new topic restrictions preserve both explicit course selection and edited source text', () => {
  const marine = question('지구과학 II', scienceTopics[3].text);
  const wrongCourse = classifyQuestion(marine, catalog, '고등학교|행성우주과학');
  assert.equal(wrongCourse.selectedSubjectKey, '고등학교|행성우주과학');
  assert.equal(wrongCourse.standardCode, '');
  assert.deepEqual(wrongCourse.standardCandidates, []);
  const otherFamily = classifyQuestion(marine, catalog, '고등학교|화학');
  assert.equal(otherFamily.mappingArea, undefined);
  assert.ok(otherFamily.standardCandidates.length);
  assert.ok(otherFamily.standardCandidates.every(c => c.domain === '고등학교 · 화학'));
  const edited = classifyQuestion({ ...marine, assessmentText: marine.text, text: scienceTopics[2].text, textEdited: true }, catalog);
  assert.equal(edited.mappingArea, scienceTopics[2].area);
  assert.ok(edited.standardCandidates.every(c => scienceTopics[2].statement.test(c.standard.replace(/\s/g, ''))));
  const editedAway = scienceAssessmentScope({ ...marine, assessmentText: marine.text, text: '태양의 광구와 대기 관측 자료를 비교한다.', textEdited: true }, catalog);
  assert.equal(editedAway, undefined);
});

test('incidental science words and atmospheric hydrostatics do not trigger the new topic scopes', () => {
  for (const [label, text] of [
    ['생명과학 I', '생물의 유전적 특성을 가계도를 이용해 분석한다.'],
    ['지구과학 I', '태풍 피해 이후 드러난 지층의 상대 연령을 분석한다.'],
    ['지구과학 I', '서로 다른 파장의 태양광 관측 자료를 비교한다.'],
    ['지구과학 II', '정역학 평형인 대기에서 고도에 따른 기압을 비교한다.'],
  ]) assert.equal(scienceAssessmentScope(question(label, text), catalog), undefined, text);
});

test('optional actual final-audit questions use the same catalogue-backed topic guard', { skip: !process.env.MUNHANG_SCIENCE_MAPPING_AUDIT_DIR }, () => {
  const cases = [['biology1', 1], ['earth1', 18], ['earth2', 10], ['earth2', 18], ['earth2', 16]];
  for (let i = 0; i < cases.length; i++) {
    const [subject, number] = cases[i];
    const rows = JSON.parse(fs.readFileSync(path.join(process.env.MUNHANG_SCIENCE_MAPPING_AUDIT_DIR, subject, 'questions.json'), 'utf8'));
    const source = rows.find(row => row.number === number);
    assert.ok(source, `${subject} ${number}`);
    const topic = scienceTopics[Math.min(i, scienceTopics.length - 1)];
    const q = classifyQuestion({ ...question(topic.label, source.text), number }, catalog);
    assert.equal(q.mappingArea, topic.area);
    assert.ok(q.standardCandidates.length);
    assert.ok(q.standardCandidates.every(c => topic.statement.test(c.standard.replace(/\s/g, ''))));
    assert.ok(q.standardCandidates.every(c => catalog.some(row => row.code === c.code && row.statement === c.standard)));
  }
});
