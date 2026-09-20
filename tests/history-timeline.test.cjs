/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const {detectPdfTimelines}=require('../lib/pdf-timeline.ts');
const {structureQuestionRegion}=require('../lib/pdf-structures.ts');
const item=(text,x,y,width=20,height=10)=>({text,x,y,width,height});
const rule=(x1,y1,x2,y2)=>({x1,y1,x2,y2});
const ticks=[40,100,160,220];
const rules=[rule(20,40,240,40),rule(20,65,240,65),...ticks.map(x=>rule(x,40,x,65))];
const items=[item('연표에서 고르시오',20,10,130),...['가','나','다'].map((v,n)=>item(`(${v})`,60+n*60,45)),
  ...['첫 사건','둘째 사건','셋째 사건','마지막 사건'].map((v,n)=>item(v,20+n*60,68,40)),
  item('① (가) ② (나) ③ (다)',20,100,230)];
test('timeline intervals retain both neighbouring events exactly once',()=>{
  const [s]=detectPdfTimelines(items,rules);
  assert.equal(s.kind,'box');assert.equal(s.title,'연표');
  assert.equal(s.text,'첫 사건 → (가) → 둘째 사건 → (나) → 셋째 사건 → (다) → 마지막 사건');
  const result=structureQuestionRegion(items,rules,[0,0,1,1],280,130);
  assert.match(result.text,/:::box 연표/);assert.equal((result.text.match(/둘째 사건/g)||[]).length,1);
  assert.match(result.text,/:::\n①/);
});
test('no invented timeline for an unruled list, absent events, or unrelated caption',()=>{
  assert.deepEqual(detectPdfTimelines(items,[]),[]);
  assert.deepEqual(detectPdfTimelines(items.filter(i=>i.text!=='둘째 사건'),rules),[]);
  assert.deepEqual(detectPdfTimelines(items.slice(1),rules),[]);
});
test('bordered Korean blanks remain inline and unbordered parentheses stay ordinary',()=>{
  const source=[item('이는',10,21,20),item('(',45,21,4),item('가',49,21,9),item(')',58,21,4),item('자료이다.',76,21,60)];
  const border=[rule(40,20,68,20),rule(40,34,68,34),rule(40,20,40,34),rule(68,20,68,34)];
  assert.equal(structureQuestionRegion(source,border,[0,0,1,1],160,70).text,'이는 $\\boxed{\\text{(가)}}$ 자료이다.');
  assert.doesNotMatch(structureQuestionRegion(source,[],[0,0,1,1],160,70).text,/boxed/);
});
test('a clipped detected box emits a geometry warning even within a valid page crop',()=>{
  const source=[item('여러 문장을 담은 사료 자료의 경계가 조금씩 잘리는 경우를 다시 차례로 정확하게 확인한다.',20,30,160)];
  const border=[rule(10,20,205,20),rule(10,65,205,65),rule(10,20,10,65),rule(205,20,205,65)];
  const result=structureQuestionRegion(source,border,[0,0,200/250,1],250,100);
  assert.equal(result.structures.length,0);assert.match(result.warnings[0],/캡처 범위/);
  assert.deepEqual(structureQuestionRegion(source,border,[0,0,1,1],250,100).warnings,[]);
});
test('a curved parent owns only its source items plus nested child content',()=>{
  const a=item('바깥 자료의 문장',10,15,60), b=item('안쪽 인용문의 문장',25,45,60), other=item('옆 자료의 문장',115,15,40);
  const frame={x:5,y:5,width:160,height:90,kind:'box',title:'',text:a.text,rows:[],header:false,sourceItems:[a]};
  const child={x:20,y:35,width:75,height:25,kind:'box',title:'',text:b.text,rows:[],header:false,sourceItems:[b]};
  const result=structureQuestionRegion([a,b,other],[],[0,0,1,1],200,120,[frame,child]);
  assert.equal((result.text.match(/옆 자료의 문장/g)||[]).length,1);
  assert.equal((result.text.match(/안쪽 인용문의 문장/g)||[]).length,1);
  assert.match(result.text,/:::\n:::\n옆 자료의 문장/);
});
test('parallel speech bubbles follow text-row then left-to-right order despite pixel-edge jitter',()=>{
  const left=item('먼저 묻는 사람의 문장',10,20,80),right=item('다음 답하는 사람의 문장',115,20,80);
  const frame=(i,y)=>({x:i.x-5,y,width:90,height:50,kind:'box',title:'',text:i.text,rows:[],header:false,sourceItems:[i]});
  const result=structureQuestionRegion([left,right],[],[0,0,1,1],220,100,[frame(right,9.5),frame(left,10)]);
  assert.ok(result.text.indexOf(left.text)<result.text.indexOf(right.text));
});
test('two annotations beside one long paragraph do not reverse when moved below it',()=>{
  const poem=[0,1,2,3,4].map(n=>item(`시의 ${n}번째 행`,10,20+n*15,80));
  const first=item('윗 해설의 문장',115,30,80),second=item('아랫 해설의 문장',115,60,80);
  const frame=i=>({x:110,y:i.y-5,width:95,height:27,kind:'box',title:'',text:i.text,rows:[],header:false,sourceItems:[i]});
  const result=structureQuestionRegion([...poem,first,second],[],[0,0,1,1],230,130,[frame(first),frame(second)]);
  assert.ok(result.text.indexOf(first.text)<result.text.indexOf(second.text));
  assert.equal((result.text.match(/윗 해설의 문장/g)||[]).length,1);
});
