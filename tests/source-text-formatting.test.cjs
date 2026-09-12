/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { preserveSourceTextFormatting } = require('../lib/source-text-formatting.ts');
const { textRuns, unformattedText, formatRuns, splitFormattedText, plainToSource } = require('../lib/text-formatting.ts');
const { inferPdfTextStyles, inferPdfMathUnderlines } = require('../lib/pdf-source-formatting.ts');
const { enhanceQuestionsWithVision } = require('../lib/vision-recognition.ts');

test('source underlines survive whitespace changes and harmless chemical math wrappers', () => {
  const source = '자료\n:::box\n◦ ㉠ <u>화석</u> <u>연료의</u> <u>연소</u>에 의해 농도가 변한다.\n◦ ㉢ <u>일정량의</u> <u>해수에</u> <u>용해된</u> <u>$CO_{2}$</u><u>의</u> <u>양</u>만 다르다.\n:::';
  const candidate = '탐구 자료\n:::box\n◦ ㉠ 화석 연료의 연소에 의해 농도가 변한다.\n◦ ㉢ 일정량의 해수에 용해된 $\\mathrm{CO_2}$의 양만 다르다.\n:::';
  const result = preserveSourceTextFormatting(candidate, source);
  assert.match(result, /㉠ <u>화석 연료의 연소<\/u>에/);
  assert.match(result, /㉢ <u>일정량의 해수에 용해된 \$\\mathrm\{CO_2\}\$의 양<\/u>만/);
  assert.equal(unformattedText(result), candidate);
  assert.equal(preserveSourceTextFormatting(result, source), result);
});

test('line-wrapped spans retain exact boundaries without marking the reference label or following phrase', () => {
  const source = '호수의 ⓐ <u>수온이</u> <u>높아지면서</u> <u>그곳에</u> <u>서식하는</u>\n<u>분홍돌고래</u> <u>개체군의</u> <u>크기가</u> <u>급격하게</u> <u>줄어</u>, 분홍돌고래의 다양성이 감소하였다.';
  const candidate = '호수의 ⓐ 수온이 높아지면서 그곳에 서식하는 분홍돌고래 개체군의 크기가 급격하게 줄어, 분홍돌고래의 다양성이 감소하였다.';
  const result = preserveSourceTextFormatting(candidate, source);
  assert.equal(result, '호수의 ⓐ <u>수온이 높아지면서 그곳에 서식하는 분홍돌고래 개체군의 크기가 급격하게 줄어</u>, 분홍돌고래의 다양성이 감소하였다.');
});

test('missing, modified or ambiguous deleted source spans never spread their styles', () => {
  for (const style of ['b', 'u']) {
    const tagged = (text) => `<${style}>${text}</${style}>`;
    for (const [source, candidate] of [
      [`${tagged('반복 문구')}를 삭제했다. 남은 반복 문구`, '남은 반복 문구'],
      [`처음 ${tagged('서로 다른 조건')} 끝`, '처음 서로 바뀐 조건 끝'],
      [`전체 ${tagged('길게 강조한 문장')} 끝`, '전체 문장 끝'],
      [`${tagged('x')}는 초기 변수이다.`, '최종 값은 x이다.'],
      [`첫 ${tagged('$\\frac{a}{bc}$')} 수식`, '첫 $\\frac{ab}{c}$ 수식'],
    ]) assert.equal(preserveSourceTextFormatting(candidate, source), candidate);
  }
});

test('balanced legacy b/u tags render and normalize with bounded emphasis only', () => {
  const legacy = '앞 [b]굵게 [u]함께[/u][/b] 뒤';
  assert.equal(formatRuns(textRuns(legacy)), '앞 <b>굵게 </b><b><u>함께</u></b> 뒤');
  assert.equal(unformattedText('[b]미완성'), '[b]미완성');
  assert.equal(unformattedText('[b]잘못[/u] 뒤'), '[b]잘못[/u] 뒤');
  assert.equal(unformattedText('[b]값[/b] 뒤'), '값 뒤');
  assert.deepEqual(splitFormattedText('[b]abcdef[/b]', 6), ['<b>abc</b>', '<b>def</b>']);
  assert.equal(plainToSource('[b]abcd[/b]', 2), 5);
});

test('malformed candidate formatting remains literal without introducing new visible tags', () => {
  const source = '<u>앞부분 강조문구</u> 뒷부분';
  for (const candidate of ['앞부분 강조문구 <b>뒷부분', '앞부분 강조문구 [u]뒷부분', '앞부분 강조문구 <b>뒷부분</u>']) {
    const result = preserveSourceTextFormatting(candidate, source);
    assert.equal(result, candidate);
    assert.equal(unformattedText(result), unformattedText(candidate));
  }
});

test('PDF underline offsets include descenders and complete math, excluding box borders and fraction bars', () => {
  for (const scale of [0.75, 1, 2]) {
    const raw = [
      { text: '용해된', x: 10, y: 20, width: 20, height: 10 },
      { text: '$CO_{2}$', x: 34, y: 20, baseline: 30, width: 18, height: 10, equation: true, sourceBounds: { x: 34, y: 20, width: 18, height: 13 } },
      { text: '의 양', x: 55, y: 20, width: 20, height: 10 },
      { text: '다음', x: 79, y: 20, width: 20, height: 10 },
      { text: '$\\frac{a}{b}$', x: 34, y: 50, width: 18, height: 10, equation: true },
      { text: '표 셀', x: 110, y: 20, width: 20, height: 10 },
    ].map((r) => ({ ...r, x: r.x * scale, y: r.y * scale, width: r.width * scale, height: r.height * scale, ...(r.baseline ? { baseline: r.baseline * scale } : {}), ...(r.sourceBounds ? { sourceBounds: Object.fromEntries(Object.entries(r.sourceBounds).map(([k, v]) => [k, v * scale])) } : {}) }));
    const rules = [[10, 33.2, 75, 33.2], [34, 61, 52, 61], [106, 33.2, 134, 33.2], [106, 10, 106, 33.2], [134, 10, 134, 33.2]].map(([x1,y1,x2,y2]) => ({ x1:x1*scale, y1:y1*scale, x2:x2*scale, y2:y2*scale }));
    const styled = inferPdfTextStyles(raw, rules, { fnArray: [], argsArray: [] }, {}, [1,0,0,1,0,0], () => undefined);
    const result = inferPdfMathUnderlines(styled, rules);
    assert.deepEqual(result.map((r) => !!r.underline), [true, true, true, false, false, false]);
    assert.deepEqual(result.map((r) => r.text), raw.map((r) => r.text));
  }
});

test('fresh mocked recognition retains PDF style spans in both question and assessment text', async (t) => {
  const previous = global.fetch;
  t.after(() => { global.fetch = previous; });
  const source = '호수의 ⓐ <u>수온이 높아지면서 그곳에 서식하는 분홍돌고래 개체군의 크기가 급격하게 줄어</u>, 다양성이 감소하였다.';
  const candidate = unformattedText(source);
  global.fetch = async () => Response.json({ questions: [{ number: 18, latexText: candidate, choices: [] }] });
  const result = await enhanceQuestionsWithVision([{ number: 18, text: source, sourcePageImage: 'data:image/jpeg;base64,/9j/2Q==' }]);
  assert.deepEqual(result.failures, []);
  assert.equal(result.questions[0].text, source);
  assert.equal(result.questions[0].assessmentText, source);
});
