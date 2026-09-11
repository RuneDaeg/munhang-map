require('./load-typescript.cjs');
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { reconstructMathRuns } = require('../lib/pdf-math-layout.ts');
const { splitMathText } = require('../lib/math-normalization.ts');
const {
  mapAssessment,
  ownAssessmentText,
} = require('../lib/assessment-mapping.ts');
const { parseStandardsCsv, classifyQuestion } = require('../lib/pdf-analysis.ts');
const {
  validateQuestion,
  validateExamQuestions,
} = require('../lib/question-validation.ts');
const { readQuestionContext } = require('../lib/question-context.ts');
const {
  fontIsBold,
  inferPdfTextStyles,
  detectRangeBrackets,
} = require('../lib/pdf-source-formatting.ts');
const { detectRasterStructure } = require('../lib/pdf-raster-structures.ts');
const {
  questionTextFromBlocks,
  questionPlainText,
} = require('../lib/question-content.ts');
const { structureQuestionRegion } = require('../lib/pdf-structures.ts');
const { layoutPage, locateQuestions } = require('../lib/pdf-layout.ts');
const katex = require('katex');
test('a chemical group index stays on its closing delimiter',()=>{
  const atoms=[run('C',0,30,12,6),run('a',6,30,12,6),run('(',12,30,12,4),run('O',16,30,12,6),run('H',22,30,12,6),run(')',28,30,12,4),run('2',33,34,8,4)];
  const r=reconstructMathRuns(atoms);
  assert.equal(r.sourceConserved,true);assert.match(r.items.map(i=>i.text).join(''),/Ca\\left\(OH\\right\)_\{2\}/);
});
const run = (text, x, baseline, height, width, mathRole) => ({
  text,
  x,
  y: baseline - height,
  baseline,
  height,
  width,
  equation: true,
  mathRole,
});
const line = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });
const item = (text, x, y, width = 20) => ({ text, x, y, width, height: 10 });
const catalog = parseStandardsCsv(
  fs.readFileSync(
    path.join(__dirname, '../public/data/achievement-standards.csv'),
    'utf8',
  ),
);
const korean = {
  label: '국어',
  subjectKeys: catalog
    .filter(
      (c) =>
        c.school === '고등학교' && /국어|문학|화법|독서|매체/.test(c.subject),
    )
    .map((c) => `${c.school}|${c.subject}`),
};

test('specific distributions precede generic probability and continuity words', () => {
  for (const text of [
    '확률변수 X는 정규분포를 따른다. P(X ≥ 60)의 확률을 구하시오.',
    '연속확률변수 X의 확률밀도함수가 주어져 있다. 확률을 구하시오.',
  ]) {
    const result=mapAssessment({number:1,text,selectedSubjectKey:'고등학교|확률과 통계'},catalog);
    assert.equal(result.area,'math-statistics');
    assert.ok(result.candidates.length>0);
    assert.ok(result.candidates.every(c=>c.code.startsWith('[12확통03-')));
  }
});

test('a manually split child keeps its own stem anchor despite shared context', () => {
  const text='2. 발표자의 말하기 방식으로 적절한 것은?';
  const question={number:2,text,textEdited:true,sharedPassage:{range:[1,2],text:'다음은 학생의 발표이다.',pages:[1]},examSubject:korean};
  assert.equal(ownAssessmentText(question),'발표자의 말하기 방식으로 적절한 것은?');
  assert.equal(mapAssessment(question,catalog).area,'speech');
  const source=fs.readFileSync(path.join(__dirname,'../app/page.tsx'),'utf8');
  assert.ok(source.includes('if (!marker) secondText = `${secondNumber}. ${secondText}`'));
});

test('changing subject clears the previous assessment explanation and stale flags', () => {
  const question=classifyQuestion({number:1,type:'테스트',text:'발표자의 말하기 방식으로 적절한 것은?',standardCode:'',standard:'',domain:'',confidence:0,examSubject:korean},catalog,'고등학교|화법과 언어');
  assert.equal(question.mappingArea,'듣기·말하기');
  const changed=classifyQuestion({...question,validationFlags:[{code:'old_flag',message:'이전 결과'}]},catalog,'고등학교|물리학');
  assert.equal(changed.mappingArea,undefined);
  assert.equal(changed.mappingReason,undefined);
  assert.equal(changed.validationFlags,undefined);
  assert.match(changed.domain,/물리학/);
  const unavailable=classifyQuestion(question,catalog,'고등학교|없는 교과');
  assert.equal(unavailable.standardCode,'');
});

test('English money choices keep dollar signs and are not cross-choice formula spans', () => {
  const prices='① $55 ② $63 ③ $70 ④ $81 ⑤ $90';
  assert.equal(splitMathText(prices).some(p=>p.math),false);
  assert.equal(splitMathText(prices).map(p=>p.text).join(''),prices);
  assert.ok(!validateQuestion({number:6,type:'테스트',text:prices,standardCode:'',standard:'',domain:'',confidence:0}).some(f=>f.code==='latex_unbalanced'));
  assert.equal(splitMathText('① $20$ ② $x+1$').filter(p=>p.math).length,2);
});

test('a fraction inside an exponent stays inside the parentheses outer power at every scale', () => {
  const input = [
    run('(', 104.88, 301.44, 24.96, 4.656),
    run('2', 109.44, 304.56, 12, 6),
    run('─', 116.16, 296.16, 8.16, 6.48, 'fractionBar'),
    run('3', 117.6, 299.04, 8.16, 4.08),
    run('1', 117.6, 288.36, 8.16, 4.08),
    run(')', 123.6, 301.44, 24.96, 4.656),
    run('6', 128.04, 286.32, 8.16, 4.08),
  ];
  for (const scale of [0.75, 1, 2]) {
    const atoms = input.map((r) => ({
      ...r,
      x: r.x * scale + 30,
      y: r.y * scale + 50,
      baseline: r.baseline * scale + 50,
      width: r.width * scale,
      height: r.height * scale,
    }));
    const original = JSON.stringify(atoms),
      r = reconstructMathRuns(atoms);
    assert.equal(r.sourceConserved, true);
    assert.equal(r.warnings.length, 0);
    assert.equal(
      r.items.map((i) => i.text).join(''),
      String.raw`$\left(2^{\frac{1}{3}}\right)^{6}$`,
    );
    assert.equal(JSON.stringify(atoms), original);
    assert.ok(r.items[0].sourceBounds.y <= Math.min(...atoms.map((i) => i.y)));
  }
});
test('root belongs to numerator before division, and preceding prose comma is not a numerator', () => {
  const root = [
    run('√', 10, 30, 12, 5, 'radical'),
    run('─', 15, 27.2, 12, 7, 'fractionBar'),
    run('3', 16, 30, 12, 5),
  ];
  const r = reconstructMathRuns([
    ...root,
    run('─', 9, 42, 12, 15, 'fractionBar'),
    run('18', 11, 46, 12, 11),
  ]);
  assert.equal(r.sourceConserved, true);
  assert.match(
    r.items.map((i) => i.text).join(''),
    /\\frac\{\\sqrt\{3\}\}\{18\}/,
  );
  const accent = reconstructMathRuns([
    { ...run(',', 10, 20, 8, 3), equation: false },
    run('─', 10, 28, 8, 10, 'fractionBar'),
    run('A', 10, 30.6, 8, 5),
    run('B', 15, 30.6, 8, 5),
  ]);
  assert.ok(accent.items.some((i) => i.text === String.raw`$\overline{AB}$`));
  assert.ok(accent.items.some((i) => i.text === ','));
});
test('complete bare sums/limits render, while malformed input is not silently completed', () => {
  for (const value of [
    String.raw`\sum_{n=2}^{10}`,
    String.raw`\lim_{x\to3}`,
    String.raw`\sqrt{3}^2`,
  ]) {
    const part = splitMathText(value).find((p) => p.math);
    assert.ok(part);
    katex.renderToString(part.text, { throwOnError: true });
  }
  assert.equal(
    splitMathText(String.raw`\sum_{n=2}^{`).some((p) => p.math),
    false,
  );
});
test('source style evidence preserves text and distinguishes underlines from table edges', () => {
  assert.equal(fontIsBold({ name: 'AB+Bold' }), true);
  assert.equal(fontIsBold({ name: 'AB+Regular' }), false);
  assert.equal(fontIsBold({ data: new Uint8Array([0, 1]) }), false);
  const source = [
    { ...item('강조', 10, 20), fontName: 'bold' },
    item('밑줄', 50, 20),
    item('표 셀', 90, 20),
  ];
  const result = inferPdfTextStyles(
    source,
    [
      line(50, 32, 70, 32),
      line(85, 32, 115, 32),
      line(85, 10, 85, 32),
      line(115, 10, 115, 32),
    ],
    { fnArray: [], argsArray: [] },
    {},
    [1, 0, 0, 1, 0, 0],
    (id) => ({ name: id === 'bold' ? 'Bold' : 'Regular' }),
  );
  assert.equal(result[0].bold, true);
  assert.equal(result[1].underline, true);
  assert.equal(result[2].underline, undefined);
  assert.deepEqual(
    result.map((i) => i.text),
    source.map((i) => i.text),
  );
});
test('named brackets own a range, with the label once in the title instead of mid-word', () => {
  const items = [
    item('[A]', 15, 45, 10),
    item('첫 문장', 35, 25, 50),
    item('가운데 문장', 35, 42, 70),
    item('끝 문장', 35, 60, 50),
    item('마지막', 95, 60, 40),
  ];
  const rules = [
    line(20, 20, 20, 42),
    line(20, 58, 20, 78),
    line(20, 20, 30, 20),
    line(20, 78, 30, 78),
    line(150, 10, 150, 90),
  ];
  const range = detectRangeBrackets(items, rules)[0];
  assert.ok(range);
  assert.equal(range.title, '[A]');
  assert.doesNotMatch(range.text, /\[A\]/);
  assert.equal(detectRangeBrackets(items, rules.slice(0, -1)).length, 0);
});
test('a small reference box remains between surrounding words rather than at paragraph end', () => {
  const items = [
    item('그는 훨씬', 0, 25, 45),
    item('좋은 제안', 55, 25, 50),
    item('을 냈다.', 115, 25, 45),
  ];
  const rules = [
    line(50, 20, 50, 40),
    line(110, 20, 110, 40),
    line(50, 20, 110, 20),
    line(50, 40, 110, 40),
  ];
  const text = structureQuestionRegion(
    items,
    rules,
    [0, 0, 1, 1],
    180,
    80,
  ).text;
  assert.ok(text.indexOf('그는 훨씬') < text.indexOf('좋은 제안'));
  assert.ok(text.indexOf('좋은 제안') < text.indexOf('을 냈다.'));
});
test('raster memo with separate text layer becomes editable cells; a borderless picture is rejected', () => {
  const w = 240,
    h = 120,
    data = new Uint8ClampedArray(w * h * 4).fill(255);
  const black = (x, y) => {
    let i = (y * w + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 0;
  };
  for (const x of [2, 70, 237]) for (let y = 2; y < 118; y++) black(x, y);
  for (const y of [2, 60, 117]) for (let x = 2; x < 238; x++) black(x, y);
  const source = [
    item('기관', 10, 15),
    item('개방', 10, 35),
    item('내용 하나', 85, 15, 70),
    item('내용 둘', 85, 35, 70),
    item('구역', 10, 75),
    item('활용', 10, 95),
    item('내용 셋', 85, 75, 70),
    item('내용 넷', 85, 95, 70),
  ];
  const area = { id: 'image', x: 0, y: 0, width: w, height: h };
  const table = detectRasterStructure(data, w, h, area, source);
  assert.equal(table.kind, 'table');
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0].length, 2);
  assert.match(questionTextFromBlocks([table]), /기관 개방/);
  assert.equal(
    questionPlainText(questionTextFromBlocks([table])).includes('내용 넷'),
    true,
  );
  assert.equal(
    detectRasterStructure(
      new Uint8ClampedArray(w * h * 4).fill(255),
      w,
      h,
      area,
      source,
    ),
    undefined,
  );
});
test('shared topic never determines a Korean standard; edits invalidate stale assessment text', () => {
  const q = {
    number: 1,
    text: '법률과 매체에 관한 지문',
    assessmentText: '발표자의 말하기 방식으로 적절한 것은?',
    examSubject: korean,
  };
  const first = mapAssessment(q, catalog);
  assert.equal(first.area, 'speech');
  assert.equal(first.candidates[0].code, '[12화언01-09]');
  const second = mapAssessment(
    { ...q, text: '과학과 SNS가 등장하는 지문' },
    catalog,
  );
  assert.deepEqual(first.candidates, second.candidates);
  assert.equal(
    ownAssessmentText({
      ...q,
      textEdited: true,
      text: '<b>1.</b> 표준 발음에 대한 설명은?',
    }),
    '표준 발음에 대한 설명은?',
  );
  assert.equal(mapAssessment(q, catalog, '고등학교|문학').status, 'unknown');
  const novel = mapAssessment(
    {
      ...q,
      number: 41,
      assessmentText: '밑줄 친 제안에 대한 이해로 적절한 것은?',
      sharedPassage: {
        range: [39, 42],
        pages: [14],
        text: '[중략 부분의 줄거리] 소설 자료',
      },
    },
    catalog,
  );
  assert.equal(novel.area, 'literature');
});
test('validation reports observable defects, not a confidence threshold; metadata is whitelisted', () => {
  const q = {
    number: 1,
    text: '밑줄 친 내용? \uE000 ① 하나 ② 둘 $x',
    standardCode: '[bogus]',
    confidence: 99,
  };
  const codes = validateQuestion(q, catalog).map((f) => f.code);
  for (const code of [
    'pua_present',
    'latex_unbalanced',
    'choice_count',
    'format_lost',
    'code_not_in_catalog',
  ])
    assert.ok(codes.includes(code));
  const contextual = {
    assessmentText: '물음',
    sharedPassage: {
      range: [1, 3],
      text: '지문',
      pages: [1, 2],
      apiKey: 'secret',
    },
    mappingReason: '근거',
    apiKey: 'secret',
    validationFlags: [
      { code: 'choice_count', message: '검토', apiKey: 'secret' },
    ],
  };
  assert.equal(
    JSON.stringify(readQuestionContext(contextual)).includes('secret'),
    false,
  );
  assert.equal(
    readQuestionContext({
      ...contextual,
      sharedPassage: { ...contextual.sharedPassage, pages: [999] },
    }).sharedPassage,
    undefined,
  );
  const qs = Array.from({ length: 20 }, (_, n) => ({
    number: n + 1,
    text: '자료를 읽으시오.',
    standardCode: '[one]',
  }));
  assert.ok(
    validateExamQuestions(qs).every((q) =>
      q.validationFlags.some((f) => f.code === 'code_overused'),
    ),
  );
});

test('manual subject selection overrides a wrong header, and validation uses edited text', () => {
  const q = {
    number: 1,
    text: '표준 발음에 대한 설명은?',
    examSubject: korean,
  };
  assert.equal(mapAssessment(q, catalog, '고등학교|물리학'), undefined);
  const math = mapAssessment(
    { ...q, text: '$2^{3}$의 값은?' },
    catalog,
    '고등학교|대수',
  );
  assert.ok(math.candidates.length);
  assert.ok(math.candidates.every((c) => c.subjectKey === '고등학교|대수'));
  const edited = {
    ...q,
    assessmentText: '① 하나 ② 둘',
    textEdited: true,
    text: '1. 고른 것은? ① 하나 ② 둘 ③ 셋 ④ 넷 ⑤ 다섯',
    selectedSubjectKey: '고등학교|대수',
    standardCode: math.candidates[0].code,
  };
  assert.ok(
    !validateQuestion(edited, catalog).some((f) =>
      ['choice_count', 'code_out_of_scope'].includes(f.code),
    ),
  );
  assert.equal(questionPlainText('<b>번호</b> <u>내용</u>'), '번호 내용');
});

test('a passage registry crosses more than three pages and ends before the next set', () => {
  const line = (text, y) => ({ text, x: 30, y, width: 500, height: 12 });
  const pages = [
    layoutPage(
      [line('[1~2] 다음 글을 읽으시오.', 100), line('공유 지문 첫 부분', 140)],
      600,
      800,
      1,
    ),
    layoutPage([line('공유 지문 두 번째 부분', 140)], 600, 800, 2),
    layoutPage([line('공유 지문 세 번째 부분', 140)], 600, 800, 3),
    layoutPage(
      [
        line('공유 지문 끝 부분', 140),
        line('1. 첫 발문?', 300),
        line('① 하나 ② 둘 ③ 셋 ④ 넷 ⑤ 다섯', 330),
        line('2. 다른 발문?', 400),
        line('① 하나 ② 둘 ③ 셋 ④ 넷 ⑤ 다섯', 430),
        line('[3~4] 다음 지문', 500),
        line('침범 금지 지문', 540),
        line('3. 다음 발문?', 600),
      ],
      600,
      800,
      4,
    ),
  ];
  const questions = locateQuestions(pages);
  for (const q of questions.slice(0, 2)) {
    assert.deepEqual(q.sharedPassage.pages, [1, 2, 3, 4]);
    assert.match(q.sharedPassage.text, /공유 지문 끝 부분/);
    assert.doesNotMatch(q.text, /침범 금지/);
    assert.equal(q.sharedRegionCount, 4);
  }
});
