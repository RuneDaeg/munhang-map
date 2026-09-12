/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { detectPdfStructures, pdfRules, structureQuestionRegion } = require('../lib/pdf-structures.ts');
const { extractPositionedText } = require('../lib/pdf-text.ts');
const { questionPlainText } = require('../lib/question-content.ts');
const { unformattedText } = require('../lib/text-formatting.ts');
const item = (text, x, y, width = 25) => ({ text, x, y, width, height: 10 });
const rule = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });

function splitTableFixture() {
  const xs = [0, 140, 185, 230, 275, 320];
  return {
    rules: [
      ...xs.map(x => rule(x, 0, x, 100)),
      ...[0, 20, 60, 80, 100].map(y => rule(0, y, 320, y)),
      rule(70, 20, 70, 60),
      rule(70, 40, 320, 40),
    ],
    items: [
      item('혼합 용액', 50, 4, 55),
      ...['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ'].map((value, c) => item(value, 150 + c * 45, 4, 15)),
      item('혼합 전', 10, 24, 50), item('부피(mL)', 8, 44, 55),
      item('산 용액', 80, 24, 45), item('염기 용액', 78, 44, 55),
      ...['17', '19', '23', '29'].map((value, c) => item(value, 150 + c * 45, 24, 20)),
      ...['11', '13', '31', '37'].map((value, c) => item(value, 150 + c * 45, 44, 20)),
      item('온도', 45, 64, 40),
      ...['21.1', '22.2', '23.3', '24.4'].map((value, c) => item(value, 148 + c * 45, 64, 30)),
      item('용액의 색', 45, 84, 55),
      ...['노랑', '초록', '파랑', '보라'].map((value, c) => item(value, 148 + c * 45, 84, 30)),
    ],
  };
}

test('split body rows retain all values and associate a multiline shared label with both rows', () => {
  const {items, rules} = splitTableFixture();
  const table = detectPdfStructures(items, rules).find(s => s.kind === 'table' && s.x === 0);
  assert.deepEqual(table.rows, [
    ['혼합 용액', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ'],
    ['혼합 전 부피(mL) 산 용액', '17', '19', '23', '29'],
    ['혼합 전 부피(mL) 염기 용액', '11', '13', '31', '37'],
    ['온도', '21.1', '22.2', '23.3', '24.4'],
    ['용액의 색', '노랑', '초록', '파랑', '보라'],
  ]);
  const result = structureQuestionRegion(items, rules, [0, 0, 1, 1], 320, 100);
  for (const value of ['17','19','23','29','11','13','31','37'])
    assert.equal(result.text.split(`| ${value} |`).length - 1, 1);
  assert.equal(result.structures.filter(s => s.kind === 'table').length, 1);
});

test('split cells remain valid when source values, scale, translation and input order change', () => {
  const fixture = splitTableFixture(), scale = 1.65, dx = 57, dy = 92;
  const items = fixture.items.map(i => ({...i, text:i.text === '17' ? '8.75' : i.text, x:dx+i.x*scale,y:dy+i.y*scale,width:i.width*scale,height:i.height*scale})).reverse();
  const rules = fixture.rules.map(r => ({x1:dx+r.x1*scale,y1:dy+r.y1*scale,x2:dx+r.x2*scale,y2:dy+r.y2*scale})).reverse();
  const table = detectPdfStructures(items, rules).find(s => s.kind === 'table' && s.x === dx);
  assert.deepEqual(table.rows[1], ['혼합 전 부피(mL) 산 용액','8.75','19','23','29']);
  assert.deepEqual(table.rows[2], ['혼합 전 부피(mL) 염기 용액','11','13','31','37']);
});

test('partial rules with no row-anchored endpoint and small boxes inside cells do not split data rows', () => {
  const fixture = splitTableFixture();
  fixture.rules = fixture.rules.filter(r => !(r.y1 === 40 && r.y2 === 40));
  fixture.rules.push(rule(155, 40, 310, 40)); // underline/diagram line, not a grid boundary
  fixture.rules.push(rule(290,25,305,25),rule(290,38,305,38),rule(290,25,290,38),rule(305,25,305,38));
  const table = detectPdfStructures(fixture.items, fixture.rules).find(s => s.kind === 'table' && s.x === 0);
  assert.equal(table.rows.length, 4);
  assert.equal(table.rows[1][1], '17 11');
});

test('a partial row rule can stop at an existing shared column boundary', () => {
  const xs=[0,80,150,220], rules=[...xs.map(x=>rule(x,0,x,100)),...[0,20,80,100].map(y=>rule(0,y,220,y)),rule(80,50,220,50)];
  const items=[item('분류',20,4),item('측정 A',90,4,50),item('측정 B',160,4,50),item('공통 조건',10,43,60),item('1',100,28),item('2',170,28),item('3',100,60),item('4',170,60),item('대조',20,85),item('5',100,85),item('6',170,85)];
  const table=detectPdfStructures(items,rules).find(s=>s.kind==='table');
  assert.deepEqual(table.rows.slice(1,3),[['공통 조건','1','2'],['공통 조건','3','4']]);
});

const sourcePdf=process.env.SPLIT_CELLS_PDF;
test('provided PDF retains neutralization rows and source characters on direct extraction', {skip:!sourcePdf}, async () => {
  const canvas = createRequire(require.resolve('pdfjs-dist/package.json'))('@napi-rs/canvas');
  Object.assign(global, {DOMMatrix:canvas.DOMMatrix,ImageData:canvas.ImageData,Path2D:canvas.Path2D});
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(sourcePdf)),fontExtraProperties:true}).promise;
  try {
    const page=await doc.getPage(5), viewport=page.getViewport({scale:1});
    const [content,operators]=await Promise.all([page.getTextContent(),page.getOperatorList()]);
    const rules=pdfRules(operators,pdfjs.OPS,viewport.transform);
    const decoded=extractPositionedText(content.items,viewport.transform,operators,pdfjs.OPS,id=>page.commonObjs.get(id),rules);
    const table=detectPdfStructures(decoded.items,rules).find(s=>s.kind==='table'&&s.rows[0].join(' ').includes('혼합 용액'));
    assert.ok(table);
    assert.deepEqual(table.rows[0],['혼합 용액','Ⅰ','Ⅱ','Ⅲ','Ⅳ']);
    assert.deepEqual(table.rows[1].slice(1),['30','30','30','30']);
    assert.deepEqual(table.rows[2].slice(1),['10','20','30','40']);
    // Verified source-font metadata now retains upright units/atoms as math.
    // Ignore only these flat style wrappers, not scripts, digits or cell content.
    const labelText = value => value.replace(/\\mathrm\{([A-Za-z]+)\}/g, '$1').replace(/\$/g, '');
    assert.match(labelText(table.rows[1][0]),/혼합 전 수용액의 부피 \( mL \) HCl 수용액/);
    assert.match(labelText(table.rows[2][0]),/혼합 전 수용액의 부피 \( mL \) NaOH 수용액/);
    assert.deepEqual(table.rows[3].slice(1),['23.4','25.5','26.9','25.9']);
    assert.deepEqual(table.rows[4].slice(1),['노란색','노란색','초록색','파란색']);
    const selected=decoded.items.filter(i=>i.x+i.width/2>=table.x&&i.x+i.width/2<=table.x+table.width&&i.y+i.height/2>=table.y&&i.y+i.height/2<=table.y+table.height);
    const result=structureQuestionRegion(decoded.items,rules,[table.x/viewport.width,table.y/viewport.height,table.width/viewport.width,table.height/viewport.height],viewport.width,viewport.height);
    const counts=new Map();
    for(const char of unformattedText(questionPlainText(result.text)).replace(/[\s·]/g,''))counts.set(char,(counts.get(char)||0)+1);
    const missing=[];
    for(const char of selected.map(i=>i.text).join('').replace(/\s/g,'')){if(counts.get(char))counts.set(char,counts.get(char)-1);else missing.push(char);}
    assert.deepEqual(missing,[],'all raw table characters survive reconstruction');
  } finally {await doc.destroy();}
});
