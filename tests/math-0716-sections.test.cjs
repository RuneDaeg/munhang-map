/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const {layoutPage, locateQuestions} = require('../lib/pdf-layout.ts');

const row=(text,x,y,width=220,height=12)=>({text,x,y,width,height});
const geometry={rules:[{x1:30,y1:90,x2:570,y2:90},{x1:300,y1:90,x2:300,y2:740}]};
const examPage=(page,label,number)=>layoutPage([
  row(`수학 영역${label?`(${label})`:''}`,170,50,250),
  row(String(page),550,55,12),row('5 지선다형',30,102,100),
  row(`${number}. 첫 질문의 값을 구하시오.`,30,145),row('① 1 ② 2 ③ 3 ④ 4 ⑤ 5',30,180),
  row(`${number+1}. 다음 질문의 값을 구하시오.`,330,115),row('① 1 ② 2 ③ 3 ④ 4 ⑤ 5',330,180),
  row(`${page} 20`,285,750,30),
],600,800,page,geometry);

test('repeated elective numbers get unique internal keys while preserving source numbers and mastheads',()=>{
  const questions=locateQuestions([examPage(1,'',21),examPage(2,'확률과 통계',23),examPage(3,'미적분',23),examPage(4,'기하',23)]);
  assert.deepEqual(questions.map(q=>q.number),[1,2,3,4,5,6,7,8]);
  assert.deepEqual(questions.map(q=>q.sourceQuestionNumber),[21,22,23,24,23,24,23,24]);
  assert.deepEqual(questions.slice(2).map(q=>q.sectionLabel),['확률과 통계','확률과 통계','미적분','미적분','기하','기하']);
  for(const q of questions) {
    assert.equal(q.regions.length,1,'do not append empty/header-only regions from the next section');
    assert.doesNotMatch(q.text,/지선다형|수학 영역/);
  }
});

test('single-section exams keep their original numeric identity',()=>{
  const questions=locateQuestions([examPage(1,'미적분',23),examPage(2,'미적분',25)]);
  assert.deepEqual(questions.map(q=>q.number),[23,24,25,26]);
  assert.ok(questions.every(q=>q.sourceQuestionNumber===undefined));
});

test('a question starting with 점 O is not mistaken for a point-value suffix',()=>{
  const page=layoutPage([row('27. 이전 질문',30,120,500),row('28. 점 O를 중심으로 하는 원이 있다.',30,250,500),row('3.점',30,280,30),row('29. 다음 질문',30,400,500)],600,800,1);
  assert.deepEqual(locateQuestions([page]).map(q=>q.number),[27,28,29]);
});

test('numbered lists do not restart a section without a new masthead',()=>{
  const first=examPage(1,'미적분',27),second=examPage(2,'미적분',23);
  assert.deepEqual(locateQuestions([first,second]).map(q=>q.number),[27,28]);
});

test('shared passages cannot leak into another elective with repeated question numbers',()=>{
  const first=examPage(1,'확률과 통계',23);
  const col=first.columns[0];
  col.lines.unshift({...row('[23~24] 다음 자료를 읽으시오.',30,100),column:0});
  const qs=locateQuestions([first,examPage(2,'기하',23)]);
  assert.ok(qs[0].sharedPassage && qs[1].sharedPassage);
  assert.ok(qs.slice(2).every(q=>!q.sharedPassage));
});

test('observed header rule excludes painted-header page numbers but keeps tall formula bounds',()=>{
  const page=layoutPage([
    row('3',550,60,12),row('(미적분)',260,65,90),row('단답형',30,100,80),
    {...row('29. 수식의 값을 구하시오.',30,145),sourceBounds:{x:30,y:130,width:220,height:27}},
    row('6',110,132,8),row('30. 두 번째 질문',330,120),row('마지막 본문',330,690),
    row('3 20',285,750,30),
  ],600,800,3,geometry);
  assert.equal(page.sectionLabel,'미적분');
  assert.ok(page.bodyItems.every(i=>i.y>90));
  assert.ok(!page.bodyItems.some(i=>i.text==='단답형'));
  const [question]=locateQuestions([page]);
  assert.ok(question.regions[0].box[1]*800<=130);
  assert.match(question.text,/6/);
  assert.doesNotMatch(question.text,/단답형|미적분/);
});

test('a long body rule without a joined column divider cannot delete leading text',()=>{
  const items=[row('연속 지문 첫 부분',30,80,500),row('1. 질문',30,200,500)];
  const baseline=layoutPage(items,600,800,1);
  const ruled=layoutPage(items,600,800,1,{rules:[{x1:30,y1:150,x2:570,y2:150}]});
  assert.deepEqual(ruled.bodyItems,baseline.bodyItems);
});

test('provided math booklet: all 46 common/elective questions survive once with no header contamination',{
  skip:!process.env.MUNHANG_MATH_0716_PDF,
},async()=>{
  const canvas=require(process.env.CODEX_CANVAS_MODULE||'@napi-rs/canvas');
  global.DOMMatrix=canvas.DOMMatrix;global.ImageData=canvas.ImageData;global.Path2D=canvas.Path2D;
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const {extractPositionedText}=require('../lib/pdf-text.ts');
  const {pdfRules}=require('../lib/pdf-structures.ts');
  const {pdfImageAreas}=require('../lib/pdf-visual-choices.ts');
  const pdf=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(process.env.MUNHANG_MATH_0716_PDF)),fontExtraProperties:true}).promise;
  try {
    const pages=[];
    for(let p=1;p<=pdf.numPages;p++) {
      const page=await pdf.getPage(p),vp=page.getViewport({scale:1});
      const [content,ops]=await Promise.all([page.getTextContent(),page.getOperatorList()]);
      const rules=pdfRules(ops,pdfjs.OPS,vp.transform),images=pdfImageAreas(ops,pdfjs.OPS,vp.transform);
      const decoded=extractPositionedText(content.items,vp.transform,ops,pdfjs.OPS,id=>page.commonObjs.get(id),rules);
      pages.push(layoutPage(decoded.items,vp.width,vp.height,p,{rules,images}));
    }
    const qs=locateQuestions(pages);
    assert.deepEqual(qs.map(q=>q.number),Array.from({length:46},(_,i)=>i+1));
    assert.deepEqual(qs.map(q=>q.sourceQuestionNumber),[...Array.from({length:22},(_,i)=>i+1),...Array.from({length:3},()=>Array.from({length:8},(_,i)=>i+23)).flat()]);
    for(const [offset,label] of [[22,'확률과 통계'],[30,'미적분'],[38,'기하']]) {
      assert.ok(qs.slice(offset,offset+8).every(q=>q.sectionLabel===label));
    }
    for(const q of qs) {
      assert.equal(q.regions.length,1,`q${q.number}: source fits one column, no foreign section/header region`);
      assert.doesNotMatch(q.text,/제\s*2\s*교시|5\s*지선다형|단답형|\(미적분\)|\(확률과 통계\)|\(기하\)|저작권/);
      assert.ok(q.regions[0].page===q.page);
    }
  }finally{await pdf.destroy()}
});
