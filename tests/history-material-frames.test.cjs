/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test'), assert = require('node:assert/strict');
const { detectMaterialFrames } = require('../lib/pdf-material-frames.ts');
const { joinImageTiles, detectRasterStructure } = require('../lib/pdf-raster-structures.ts');

function fixture(width = 360, height = 260) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255), items = [];
  const rect = (x, y, w, h, color=0) => {
    for (let yy=y;yy<y+h;yy++) for(let xx=x;xx<x+w;xx++) data.set([color,color,color,255],(yy*width+xx)*4);
  };
  const frame = (x,y,w,h) => { rect(x,y,w,h);rect(x+3,y+3,w-6,h-6,255); };
  const words = (x,y,prefix='자료') => [0,1,2].forEach(row=>[0,1].forEach(column=>items.push({
    text:`${prefix}${row}${column}내용설명`,x:x+column*55,y:y+row*17,width:52,height:10,
  })));
  return {data,width,height,items,rect,frame,words,read(){return detectMaterialFrames(data,width,height,width,height,items);}};
}

test('separate enclosed paragraphs retain source ownership instead of alternating parallel lines', () => {
  const f=fixture();f.frame(10,20,145,85);f.frame(180,20,145,85);f.words(20,35,'왼쪽');f.words(190,35,'오른쪽');
  const boxes=f.read();assert.equal(boxes.length,2);assert.ok(boxes.every(b=>b.kind==='box'));
  assert.match(boxes[0].text,/왼쪽/);assert.doesNotMatch(boxes[0].text,/오른쪽/);
  assert.match(boxes[1].text,/오른쪽/);assert.doesNotMatch(boxes[1].text,/왼쪽/);
  assert.equal(new Set(boxes.flatMap(b=>b.sourceItems)).size,f.items.length);
});

test('rounded/irregular enclosed outline and grey heading stay a material box, not a table', () => {
  const f=fixture();
  // Stair-stepped rounded corners deliberately contain no complete vertical side.
  f.rect(25,20,125,90);f.rect(20,25,135,80);f.rect(28,23,119,84,255);f.rect(23,28,129,74,255);
  f.rect(30,28,114,12,210);f.words(32,48);f.items.push({text:'별도음영제목',x:35,y:28,width:85,height:10});
  const boxes=f.read();assert.equal(boxes.length,1);assert.equal(boxes[0].kind,'box');assert.match(boxes[0].text,/별도음영제목/);
});

test('nested material card assigns each text item once and keeps the child independent', () => {
  // Keep the observed card smaller than the page-background rejection limits.
  const f=fixture(500,360);f.frame(10,10,330,230);f.frame(180,70,145,85);f.words(25,25,'바깥');f.words(190,83,'안쪽');
  const boxes=f.read();assert.equal(boxes.length,2);
  assert.equal(new Set(boxes.flatMap(b=>b.sourceItems)).size,12);
  assert.equal(boxes.reduce((n,b)=>n+b.sourceItems.length,0),12);
  assert.ok(boxes.some(b=>b.text.includes('바깥')&&!b.text.includes('안쪽')));
});

test('plain prose, photographs with labels, chart axes and answer choices are not material boxes', () => {
  const plain=fixture();plain.words(25,25);assert.deepEqual(plain.read(),[]);
  const photo=fixture();photo.rect(10,10,200,180,90);photo.words(25,25);assert.deepEqual(photo.read(),[]);
  const chart=fixture();chart.frame(10,10,200,180);chart.items.push({text:'시간',x:80,y:170,width:30,height:10},{text:'거리',x:20,y:30,width:30,height:10});assert.deepEqual(chart.read(),[]);
  const choices=fixture();choices.frame(10,10,200,180);choices.words(25,25);choices.items.push({text:'① 선택지',x:25,y:95,width:80,height:10});assert.deepEqual(choices.read(),[]);
});

test('aligned image tiles join only at matching edges; a material split in half becomes detectable', () => {
  const a={id:'a',x:10,y:10,width:200,height:70},b={id:'b',x:10,y:80,width:200,height:70};
  const joined=joinImageTiles([a,b]);assert.equal(joined.length,1);assert.equal(joined[0].height,140);
  assert.equal(joinImageTiles([a,{...b,y:83}]).length,2);
  assert.equal(joinImageTiles([a,{...b,x:12}]).length,2);
  const f=fixture(200,140);f.frame(0,0,200,140);f.words(15,20);f.words(15,85);
  const area={id:'full',x:0,y:0,width:200,height:140};
  assert.equal(detectRasterStructure(f.data,200,140,area,f.items)?.kind,'box');
  assert.equal(detectRasterStructure(f.data.slice(0,200*70*4),200,70,{...area,height:70},f.items),undefined);
  assert.equal(detectRasterStructure(f.data.slice(200*70*4),200,70,{...area,y:70,height:70},f.items),undefined);
});

test('optional approved history source: every audited material family and parallel callout is separate', {
  skip: !process.env.MUNHANG_HISTORY_AUDIT_DIR || !process.env.MUNHANG_CANVAS_MODULE,
}, async () => {
  const fs=require('node:fs'),path=require('node:path'),canvas=require(process.env.MUNHANG_CANVAS_MODULE);
  const all=[];
  for(const p of [1,2,3,4]) {
    const base=process.env.MUNHANG_HISTORY_AUDIT_DIR;
    const geometry=JSON.parse(fs.readFileSync(path.join(base,`history/geometry-${p}.json`)));
    const image=await canvas.loadImage(path.join(base,`original/page-${p}.png`));
    const c=canvas.createCanvas(image.width,image.height),context=c.getContext('2d');context.drawImage(image,0,0);
    all.push(detectMaterialFrames(context.getImageData(0,0,image.width,image.height).data,image.width,image.height,
      geometry.width,geometry.height,geometry.bodyItems));
  }
  const find=(page,pattern)=>all[page-1].filter(b=>pattern.test(b.text));
  for(const [page,pattern] of [[1,/패총은/],[1,/여러분이/],[2,/전에 없던/],[2,/수창사/],[2,/올해는/],[3,/영상 정보/],[3,/이한열/],[4,/강제 징용/],[4,/기획.*의도/]]) assert.equal(find(page,pattern).length,1);
  for(const [page,a,b] of [[1,/당으로부터/,/고려에 귀순한/],[1,/이것은 프랑스가/,/그림에는 강화읍성/],[3,/작년에 양인들이/,/그러하옵니다/],[3,/조선 총독부에/,/황푸탄/]]) {
    assert.equal(find(page,a).length,1);assert.equal(find(page,b).length,1);assert.notEqual(find(page,a)[0],find(page,b)[0]);
    assert.doesNotMatch(find(page,a)[0].text,b);assert.doesNotMatch(find(page,b)[0].text,a);
  }
  assert.equal(find(3,/김원봉을/).length,1);
  for(const boxes of all) assert.equal(new Set(boxes.flatMap(b=>b.sourceItems)).size,boxes.reduce((n,b)=>n+b.sourceItems.length,0));
});
