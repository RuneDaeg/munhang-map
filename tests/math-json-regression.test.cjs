/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { normalizeQuestionText: normalize, splitMathText, mathForRendering } = require('../lib/math-normalization.ts');
const { mathQualityIssues } = require('../lib/math-quality.ts');
const { validateQuestion } = require('../lib/question-validation.ts');
const { hasDuplicatedStem } = require('../lib/question-completeness.ts');
const { readQuestionContext } = require('../lib/question-context.ts');
const { enhanceQuestionsWithVision } = require('../lib/vision-recognition.ts');
const MathText = require('../components/math-text.tsx').default;

const damagedPower = JSON.parse(String.raw`{"text":"$\bigg(2^{\\frac{1}{3}}\bigg)^{6}$"}`).text;
const damagedLimit = JSON.parse(String.raw`{"text":"$\\text{lim}_{x \to 3} \\frac{x^2-x-6}{x-3}$"}`).text;

test('JSON-decoded bigg and to are recovered without flattening nested powers or operator scripts', () => {
  assert.ok(damagedPower.includes('\b'));
  assert.ok(damagedLimit.includes('\t'));
  assert.equal(normalize(damagedPower), String.raw`$\bigg(2^{\frac{1}{3}}\bigg)^{6}$`);
  assert.equal(normalize(damagedLimit), String.raw`$\lim_{x \to 3} \frac{x^2-x-6}{x-3}$`);
  for (const value of [damagedPower, damagedLimit, '$'+'\b'+'ar{OB}$']) {
    const fixed=normalize(value);
    assert.equal(normalize(fixed),fixed);
    assert.equal(JSON.parse(JSON.stringify(fixed)),fixed);
    assert.deepEqual(mathQualityIssues(fixed),[]);
    const html=renderToStaticMarkup(React.createElement(MathText,{text:value}));
    assert.match(html,/class="katex"/);
    // oxlint-disable-next-line no-control-regex -- Ensure invalid source controls are not rendered.
    assert.doesNotMatch(html,/katex-error|\u0008|\u001c/);
  }
  const operator=splitMathText(normalize(damagedLimit))[0].text;
  assert.match(mathForRendering(operator),/\\lim\\limits_\{x \\to 3\}/);
  assert.equal(normalize('항목\t값\nA\t65.0 cm'),'항목\t값\nA\t65.0 cm');
  assert.equal(readQuestionContext({assessmentText:damagedLimit}).assessmentText,normalize(damagedLimit));
});

test('a newline before a math command and doubled command slashes do not break following spans', () => {
  const value='수열 $\n'+String.raw`\left\{a_n\right\}$의 합은 $S_n$, $a_4=6$이다.`;
  assert.deepEqual(splitMathText(normalize(value)).filter(p=>p.math).map(p=>p.text.trim()),[String.raw`\left\{a_n\right\}`, 'S_n','a_4=6']);
  assert.deepEqual(mathQualityIssues(value),[]);
  assert.equal(normalize(String.raw`$\\left\{a_n\right\}$, $\\sum_{k=1}^{15}a_k$`),String.raw`$\left\{a_n\right\}$, $\sum_{k=1}^{15}a_k$`);
  const cases=String.raw`$a_{n+1}=\begin{cases}a_n+k&\left(a_n≤0\right)\\a_n-2&\left(a_n>0\right)\end{cases}$`;
  assert.equal(normalize(cases),cases);
  assert.deepEqual(mathQualityIssues(cases),[]);
  // Even a row followed by literal math letters 'left' must not be rewritten.
  const matrix=String.raw`$\begin{matrix}a\\left\end{matrix}$`;
  assert.equal(normalize(matrix),matrix);
  assert.deepEqual(mathQualityIssues(matrix),[]);
  const rows=String.raw`\begin{aligned}x&=1\\sum&=3\\\sum_{k=1}^{3}k&=6\end{aligned}`;
  assert.equal(mathForRendering(rows),String.raw`\begin{aligned}x&=1\\sum&=3\\\sum\limits_{k=1}^{3}k&=6\end{aligned}`);
  assert.deepEqual(mathQualityIssues('$'+rows+'$'),[]);
  assert.equal(normalize('$\tilde{x}$'),String.raw`$\tilde{x}$`);
});

test('invalid controls, broken delimiters and detached scripts no longer pass quality checks', () => {
  const samples=[
    ['$\u001c\\overline{AB}$','invalid_control_character'],
    [String.raw`$\notacommand{x}$`,'latex_syntax'],
    [String.raw`$\sum_{k=1}^{24}$\left(S_{k+1}-S_k\right)$`,'latex_unbalanced'],
    [String.raw`$\lim_{t\to1+}$(t-1)(f(t)+g(t))^{2}`,'latex_outside_math'],
    ['조건\n| |\n$b_n=1$','orphan_absolute_bars'],
  ];
  for (const [text,code] of samples) {
    assert.ok(mathQualityIssues(text).some(f=>f.code===code),code);
    assert.ok(validateQuestion({number:1,text,standardCode:'test'}).some(f=>f.code===code),code);
  }
  assert.deepEqual(mathQualityIssues('① $5\n② $10\n③ $15\n④ $20\n⑤ $25'),[]);
  assert.deepEqual(mathQualityIssues('자료\n:::table\nA | B\n1 | 2\n:::'),[]);
  assert.deepEqual(mathQualityIssues('자료\n:::table\n| |\n:::'),[]);
});

test('only a whole long doubled stem is flagged, not ordinary repeated phrases', () => {
  const stem='주어진 두 함수의 그래프가 만나는 점과 좌표에 대한 자료를 읽고 다음 조건을 만족하는 값을 구하시오. '.repeat(4);
  assert.equal(hasDuplicatedStem(stem+'\n'+stem+'\n① 1\n② 2'),true);
  assert.ok(validateQuestion({number:1,text:stem+'\n'+stem+'\n① 1',standardCode:'test'}).some(f=>f.code==='duplicated_stem'));
  assert.equal(hasDuplicatedStem('안녕 안녕\n① 1'),false);
  assert.equal(hasDuplicatedStem(stem+'다른 발문\n① 1'),false);
});

test('AI escape repairs are accepted; invalid AI math preserves a healthy source and disables the success badge', async(t) => {
  const previous=global.fetch;
  t.after(()=>{global.fetch=previous;});
  const capture={page:1,box:[0,0,0.5,0.5],image:'data:image/jpeg;base64,/9j/2Q=='};
  const source={number:1,text:normalize(damagedPower)+'의 값은?',questionCaptures:[capture]};
  global.fetch=async()=>Response.json({questions:[{number:1,latexText:damagedPower+'의 값은?'}]});
  const repaired=await enhanceQuestionsWithVision([source]);
  assert.equal(repaired.questions[0].text,source.text);
  assert.equal(repaired.questions[0].visionEnhanced,true);
  for (const broken of [String.raw`$\bigg(2^{\frac{1}{3}}\bigg)^{6}\notacommand{x}$의 값은?`,String.raw`$\sum_{k=1}^{24}$\left(S_{k+1}-S_k\right)$의 값은?`]) {
    global.fetch=async()=>Response.json({questions:[{number:1,latexText:broken}]});
    const rejected=await enhanceQuestionsWithVision([source]);
    assert.equal(rejected.questions[0].text,source.text);
    assert.equal(rejected.questions[0].visionEnhanced,false);
    assert.ok(rejected.warnings.some(w=>w.includes('기존 추출문')));
    assert.deepEqual(rejected.questions[0].questionCaptures,[capture]);
  }
  global.fetch=async()=>Response.json({questions:[{number:1,latexText:source.text, directStem:String.raw`$\bad{x}$`}]});
  const shared=await enhanceQuestionsWithVision([{...source,sharedPassage:{text:'공통 지문',pages:[1],range:[1,3]}}]);
  assert.equal(shared.questions[0].visionEnhanced,false);
  assert.ok(validateQuestion(shared.questions[0]).some(f=>f.code==='latex_syntax'));
  assert.ok(shared.warnings.some(w=>w.includes('개별 발문')));
});
