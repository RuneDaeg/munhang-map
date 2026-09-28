/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test=require('node:test');
const assert=require('node:assert/strict');
const {hasMissingSourceScripts,hasMissingSourcePrescripts,mathQualityIssues}=require('../lib/math-quality.ts');
const {enhanceQuestionsWithVision}=require('../lib/vision-recognition.ts');
const image='data:image/jpeg;base64,/9j/2Q==';
const inline=s=>`$${s}$`;

test('numeric powers and fractional exponents cannot disappear despite valid LaTeX',()=>{
  const source=String.raw`$2^{\frac{3}{2}}\times4^{-\frac{1}{2}}$의 값은?`;
  const candidate=String.raw`$2^{\frac{3}{2}}\times4$의 값은?`;
  assert.deepEqual(mathQualityIssues(candidate),[]);
  assert.equal(hasMissingSourceScripts(candidate,source),true);
  assert.equal(hasMissingSourceScripts(String.raw`$2^{\frac{3}{2}}$의 값은?`,source),true,'a completely omitted powered term is also a loss');
  assert.equal(hasMissingSourceScripts(inline(String.raw`\frac{x}{2}`),inline(String.raw`\frac{x^2}{2}`)),true);
  assert.equal(hasMissingSourceScripts(inline(String.raw`\frac{x}{y}`),inline(String.raw`\left(\frac{x}{y}\right)^2`)),true);
});

test('ordinary variables and lim/sum/integral bounds retain their right-side roles',()=>{
  for(const [source,candidate] of [
    ['f_1+f_2','f_1+f'],['a_n+a_{n+1}','a_n+a'],
    [String.raw`\lim_{x\to3}f(x)`,String.raw`\lim f(x)`],
    [String.raw`\sum_{k=1}^{24}a_k`,String.raw`\sum_{k=1}a_k`],
    [String.raw`\int_0^1f(x)dx`,String.raw`\int^1f(x)dx`],
  ]) assert.equal(hasMissingSourceScripts(inline(candidate),inline(source)),true,source);
  assert.equal(hasMissingSourceScripts('$x+y^2$','$x^2+y$'),true,'an unrelated new power cannot hide a dropped x power');
});

test('font wrappers, display limits, script order and corrected values are not rejected',()=>{
  for(const [source,candidate] of [
    [String.raw`\mathit{a}_{\mathit{n}}^2`,String.raw`{a}^{3}_{n+1}`],
    [String.raw`4^{-\frac{1}{2}}`,String.raw`\mathrm{4}^{-1/2}`],
    [String.raw`\left(2^{\frac{1}{3}}\right)^6`,String.raw`(2^{1/3})^{6}`],
    [String.raw`\sum_{k=1}^{24} a_k`,String.raw`\displaystyle\sum\limits_{k=1}^{24}\mathit{a}_{k}`],
    [String.raw`\lim_{x\to3}f(x)`,String.raw`\displaystyle\lim\limits_{x\to2}f(x)`],
    ['x^2','y^3'],
    [String.raw`\vec{v}`,String.raw`v`],
  ]) assert.equal(hasMissingSourceScripts(inline(candidate),inline(source)),false,source);
  assert.equal(hasMissingSourceScripts('$x^{2}$','$x^{$'),false,'invalid local syntax is not source script evidence');
  assert.equal(hasMissingSourceScripts('$x^2$','원문에서 읽히지 않은 x'),false);
});

test('upright multi-letter wrappers do not change the source index identity',()=>{
  for (const [left, right] of [
    [String.raw`\mathrm{CO_2}`, String.raw`\mathrm{CO}_{2}`],
    [String.raw`\mathrm{cm^2}`, String.raw`\mathrm{cm}^{2}`],
    [String.raw`\mathrm{Na^+}`, String.raw`\mathrm{Na}^{+}`],
    [String.raw`\mathrm{HCO_3}`, String.raw`\mathrm{HCO}_{3}`],
    [String.raw`\mathrm{He^3_2}`, String.raw`\mathrm{He}^{3}_{2}`],
    [String.raw`\text{CO}_{2}`, String.raw`\mathrm{CO_2}`],
    [String.raw`\mathrm{CO_2}^{2-}`, String.raw`\mathrm{CO_2^{2-}}`],
  ]) {
    assert.equal(hasMissingSourceScripts(inline(left), inline(right)), false, `${left} ← ${right}`);
    assert.equal(hasMissingSourceScripts(inline(right), inline(left)), false, `${right} ← ${left}`);
  }
  for (const [source, candidate] of [
    [String.raw`\mathrm{CO_2}`, String.raw`\mathrm{CO}+x_2`],
    [String.raw`\mathrm{Na^+}`, String.raw`\mathrm{Na}+x^2`],
    ['{ab}^2', 'ab^2'], ['(ab)^2', '(ab)'],
    [String.raw`\left(\frac{x}{y}\right)^2`, String.raw`\frac{x}{y}`],
    ['4^2', '4+x^2'],
  ]) assert.equal(hasMissingSourceScripts(inline(candidate), inline(source)), true, source);
});

test('Unicode and LaTeX prime spellings preserve the same upper role',()=>{
  for (const [left, right] of [
    ["F'", 'F′'], ["F''", 'F″'], ["F'''", 'F′′′'], [String.raw`F^{\prime}`, 'F′'],
    ["F'_1", 'F_1′'], ["(x)'", '(x)′'],
    [String.raw`\mathrm{FF}'`, String.raw`\mathrm{FF}′`],
    [String.raw`\mathrm{FF'}`, String.raw`\mathrm{FF′}`],
    [String.raw`\left(\frac{x}{y}\right)'`, String.raw`\left(\frac{x}{y}\right)′`],
  ]) {
    assert.equal(hasMissingSourceScripts(inline(left), inline(right)), false, `${left} ← ${right}`);
    assert.equal(hasMissingSourceScripts(inline(right), inline(left)), false, `${right} ← ${left}`);
  }
  assert.equal(hasMissingSourceScripts('$F$', '$F′$'), true, 'a missing Unicode prime is still a lost upper role');
  assert.equal(hasMissingSourceScripts('$F_1$', "$F'_1$"), true);
  assert.equal(hasMissingSourceScripts('$F_1+G′$', "$F'_1+G$"), true, 'moving a prime to another base is still rejected');
});

test('existing nuclear corrections and repairs of fake frequency prescripts remain allowed',()=>{
  const original=String.raw`핵반응에서 $\mathrm{H}^{2}_{1}$이다.`;
  const fixed='핵반응에서 $'+String.raw`{}^{2}_{1}\mathrm{H}`+'$이다.';
  assert.equal(hasMissingSourceScripts(fixed,original),false);
  assert.equal(hasMissingSourceScripts('$f_1+f_2$','${}^{f_1}_{1}f+{}^{f_2}_{2}f$'),false);
  assert.equal(hasMissingSourcePrescripts('$H$',fixed),true,'dedicated isotope completeness still owns left scripts');
});

test('mock API cannot replace intact source powers with a renderable but incomplete answer',async t=>{
  const source=String.raw`$2^{\frac{3}{2}}\times4^{-\frac{1}{2}}$의 값은?`;
  const dropped=String.raw`$2^{\frac{3}{2}}\times4$의 값은?`;
  const previous=global.fetch;t.after(()=>{global.fetch=previous});
  global.fetch=async()=>Response.json({questions:[{number:1,latexText:dropped,directStem:dropped}]});
  const result=await enhanceQuestionsWithVision([{number:1,text:source,assessmentText:source,sourcePageImage:image}]);
  assert.equal(result.questions[0].text,source);
  assert.equal(result.questions[0].assessmentText,source);
  assert.equal(result.questions[0].visionEnhanced,false);
  assert.match(result.warnings.join(' '),/지수.*누락/);
  assert.deepEqual(result.failures,[]);
});

test('structured blocks and shared assessment guard the same script loss separately',async t=>{
  const source=String.raw`두 수 $a_1$, $a_2$에 대하여 $a_1+a_2$의 값은?`;
  const dropped=String.raw`두 수 $a_1$, $a_2$에 대하여 $a_1+a$의 값은?`;
  const previous=global.fetch;t.after(()=>{global.fetch=previous});
  global.fetch=async()=>Response.json({questions:[{number:1,latexText:source,blocks:[{kind:'text',text:dropped}]}]});
  const blocks=await enhanceQuestionsWithVision([{number:1,text:source,sourcePageImage:image}]);
  assert.equal(blocks.questions[0].text,source);
  assert.match(blocks.warnings.join(' '),/구조가 불완전/);
  global.fetch=async()=>Response.json({questions:[{number:1,latexText:source,directStem:dropped}]});
  const shared=await enhanceQuestionsWithVision([{number:1,text:source,assessmentText:source,sourcePageImage:image,sharedPassage:{text:'공통 자료',pages:[1],range:[1,2]}}]);
  assert.equal(shared.questions[0].assessmentText,source);
  assert.equal(shared.questions[0].visionEnhanced,false);
  assert.match(shared.warnings.join(' '),/개별 발문.*지수/);
});

test('mock API can still repair local index values, invalid syntax, and nuclear script sides',async t=>{
  const previous=global.fetch;t.after(()=>{global.fetch=previous});
  for(const [source,candidate] of [
    ['$2^3$의 값은?',String.raw`$2^{\frac{1}{3}}$의 값은?`],
    ['$x^{$의 값은?','$x^2$의 값은?'],
    ['핵반응에서 $H^2_1$이다.','핵반응에서 ${}^2_1H$이다.'],
    ['${}^{f_1}_{1}f$의 값은?','$f_1$의 값은?'],
  ]) {
    global.fetch=async()=>Response.json({questions:[{number:1,latexText:candidate}]});
    const result=await enhanceQuestionsWithVision([{number:1,text:source,sourcePageImage:image}]);
    assert.equal(result.questions[0].text,candidate);
    assert.equal(result.questions[0].visionEnhanced,true,source);
  }
});

test('mock full-text API accepts equivalent upright wrappers and Unicode primes',async t=>{
  const previous=global.fetch;t.after(()=>{global.fetch=previous});
  for (const [source, candidate] of [
    [String.raw`$\mathrm{CO_2}$, $\mathrm{cm^2}$, $\mathrm{Na^+}$를 비교하시오.`, String.raw`$\mathrm{CO}_{2}$, $\mathrm{cm}^{2}$, $\mathrm{Na}^{+}$를 비교하시오.`],
    ["$F'$와 $F'_1$을 비교하시오.", '$F′$와 $F_1′$을 비교하시오.'],
    ['$F′$와 $F_1′$을 비교하시오.', "$F'$와 $F'_1$을 비교하시오."],
  ]) {
    global.fetch=async()=>Response.json({questions:[{number:1,latexText:candidate,directStem:candidate}]});
    const result=await enhanceQuestionsWithVision([{number:1,text:source,assessmentText:source,sourcePageImage:image}]);
    assert.equal(result.questions[0].text,candidate);
    assert.equal(result.questions[0].visionEnhanced,true,source);
    assert.deepEqual(result.warnings,[]);
    assert.deepEqual(result.failures,[]);
  }
});

test('repeated printed numbers retain unique API identity and source-facing warning labels',async t=>{
  const source='$x^2$의 값은?',dropped='$x$의 값은?';
  const previous=global.fetch;t.after(()=>{global.fetch=previous});
  global.fetch=async(_url,options)=>{
    const request=JSON.parse(options.body);
    assert.equal(request.questions[0].number,31);
    assert.match(request.questions[0].text,/미적분 · 23번/);
    assert.match(request.questions[0].text,/요청 식별자 31/);
    return Response.json({questions:[{number:31,latexText:dropped}]});
  };
  const result=await enhanceQuestionsWithVision([{number:31,sourceQuestionNumber:23,sectionLabel:'미적분',text:source,sourcePageImage:image}]);
  assert.equal(result.questions[0].number,31);
  assert.equal(result.questions[0].sourceQuestionNumber,23);
  assert.equal(result.questions[0].text,source);
  assert.match(result.warnings.join(' '),/미적분 · 23번/);
  assert.deepEqual(result.failures,[]);
});
