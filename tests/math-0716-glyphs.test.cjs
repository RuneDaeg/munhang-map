/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractPositionedText, glyphOutlineFingerprint, countUnresolvedGlyphs,
  splitEquationTextItems } = require('../lib/pdf-text.ts');
const { pdfRules } = require('../lib/pdf-structures.ts');
const { syntheticBoldAreas } = require('../lib/pdf-source-formatting.ts');

// Independently rendered glyph-outline evidence only; no PDF/font is bundled.
const verified = new Map([
  [0xe05b, ['∫', '404:928898d8:3beb7ea0', 10]],
  [0xe0ae, ['σ', '224:835fe81d:cfc8188b', 4]],
  [0xe017, ['X', '354:600d98a3:afde3a41', 5]],
  [0xe0fe, ['z', '406:8ce76e6d:4c82a563', 2]],
  [0xe019, ['Z', '128:6768cf35:46aa8593', 1]],
  [0xe0e9, ['e', '256:221d5271:dd05026d', 13]],
]);
function decodeOne(unicode, fontChar, font) {
  return extractPositionedText(
    [{ str: unicode, fontName: 'eq', transform: [10, 0, 0, 10, 20, 50], width: 6 }],
    [1, 0, 0, -1, 0, 100],
    { fnArray: [1, 2], argsArray: [['eq', 10], [[{ unicode, fontChar }]]] },
    { setFont: 1, showText: 2 }, () => font,
  );
}
test('new math PUA requires the exact semantic code, verified outline and supported font', () => {
  for (const code of verified.keys()) {
    const unicode = String.fromCodePoint(code);
    for (const font of [undefined, { name: 'HyhwpEQ' },
      { name: 'ABCDEF+HyhwpEQ', data: new Uint8Array(100) },
      { name: 'UnknownFont', data: new Uint8Array(100) }]) {
      const result = decodeOne(unicode, '\ue001', font);
      assert.equal(result.recoveredGlyphs, 0);
      assert.equal(result.items.map(i => i.text).join(''), unicode);
    }
  }
});

const viewport = [1, 0, 0, -1, 0, 100];
const decoders = new Map([['eq', new Map([['\ue044', '('], ['\ue04b', '{'], ['\ue101', '|'], ['\ue05c', '√'], ['\ue06d', '─']])]]);
const raw = (str, x, width, height = 10) => ({str, fontName:'eq', width, transform:[10,0,0,height,x,50]});
const area = (text, x, width, height = 10, baseline = 50) => ({text, x, right:x+width,
  height, baseline, fontName:'eq', glyphs:[{text, x, right:x+width}]});
test('splitting tall delimiters uses painted operand metrics, not equal-width character estimates', () => {
  const item = raw('\ue0442x',20,13,15);
  const result = splitEquationTextItems([item],viewport,[area('\ue044',20,4,15),area('2',24,5),area('x',29,4)],decoders);
  assert.equal(result.length,2);
  assert.deepEqual(result.map(i=>[i.str,i.width,i.transform[3],i.transform[4]]),[
    ['\ue044',4,15,20],['2x',9,10,24],
  ]);
  assert.deepEqual(item,raw('\ue0442x',20,13,15),'input remains immutable');
});
test('a tall delimiter can have a lower source baseline than its merged operands', () => {
  const item=raw('\ue0442x',20,13.24,28);
  const result=splitEquationTextItems([item],viewport,
    [area('\ue044',20,4,28),area('2',24,5,10,44.5),area('x',29,4,10,44.5)],decoders);
  assert.deepEqual(result.map(i=>[i.str,i.width,i.transform[3],i.transform[5]]),[
    ['\ue044',4,28,50],['2x',9,10,55.5],
  ]);
});
test('bounded final character-spacing advance is accepted only with the complete exact source glyph sequence', () => {
  const painted=[area('\ue044',20,4,28),area('2',24,5,10,44.5),area('x',29,4,10,44.5)];
  const item=raw('\ue0442x',20,11,28);
  assert.deepEqual(splitEquationTextItems([item],viewport,painted,decoders).map(i=>i.str),['\ue044','2x']);
  // A much larger advance or an extra character inside the allowed strip is
  // ambiguous. Neither is repaired by stretching or clipping glyph widths.
  const tooShort=raw('\ue0442x',20,9,28);
  assert.deepEqual(splitEquationTextItems([tooShort],viewport,painted,decoders),[tooShort]);
  assert.deepEqual(splitEquationTextItems([item],viewport,[...painted,area('y',30,3,10,44.5)],decoders),[item]);
});
test('a coefficient joined with a verified radical is split at the actual glyph edge', () => {
  const result = splitEquationTextItems([raw('2\ue05c7',20,18)],viewport,
    [area('2',20,5),area('\ue05c',25,8),area('7',33,5)],decoders);
  assert.deepEqual(result.map(i=>[i.str,i.width,i.transform[4]]),[['2',5,20],['\ue05c',8,25],['7',5,33]]);
});
test('a radical may overlap the preceding delimiter outline without being an overprinted duplicate', () => {
  const result=splitEquationTextItems([raw('f\ue044\ue05c',20,20)],viewport,
    [area('f',20,5),area('\ue044',27,4.5,14,50.8),area('\ue05c',31,9,13,50.6)],decoders);
  assert.deepEqual(result.map(i=>i.str),['f','\ue044','\ue05c']);
});
test('an upper line covering only two capitals does not extend over the equals and value', () => {
  const result = splitEquationTextItems([raw('AB=4',20,22)],viewport,
    [area('A',20,5),area('B',25,5),area('=',30,7),area('4',37,5),area('\ue06d',20,10,10,45)],decoders);
  assert.deepEqual(result.map(i=>i.str),['AB','=4']);
  assert.deepEqual(result.map(i=>i.width),[10,12]);
});
test('unmatched, overprinted, cross-font and ambiguous painted glyphs do not split source runs', () => {
  const item=raw('2\ue05c7',20,18), good=[area('2',20,5),area('\ue05c',25,8),area('7',33,5)];
  for (const painted of [[],good.slice(1),[...good,good[0]],
    good.map(g=>({...g,fontName:'other'})),good.map(g=>({...g,baseline:55})),
    [good[0],good[1],area('8',33,5)]]) {
    assert.deepEqual(splitEquationTextItems([item],viewport,painted,decoders),[item]);
  }
  assert.deepEqual(splitEquationTextItems([item],viewport,good,new Map()),[item]);
  assert.deepEqual(splitEquationTextItems([item],[0,0,0,0,0,0],good,decoders),[item]);
});

test('supplied math source: all 35 new glyphs restore across all 20 pages and no PUA is hidden',
  {skip:!process.env.MUNHANG_MATH_0716_PDF},async()=>{
    if(process.env.CODEX_CANVAS_MODULE){const canvas=require(process.env.CODEX_CANVAS_MODULE);Object.assign(global,{DOMMatrix:canvas.DOMMatrix,ImageData:canvas.ImageData,Path2D:canvas.Path2D});}
    const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
    const base=path.dirname(require.resolve('pdfjs-dist/package.json'));
    const pdf=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(process.env.MUNHANG_MATH_0716_PDF)),fontExtraProperties:true,
      cMapUrl:path.join(base,'cmaps')+path.sep,cMapPacked:true,standardFontDataUrl:path.join(base,'standard_fonts')+path.sep}).promise;
    const seen=new Map();
    try{
      assert.equal(pdf.numPages,20);
      for(let n=1;n<=pdf.numPages;n++){
        const page=await pdf.getPage(n),content=await page.getTextContent(),list=await page.getOperatorList();
        const transform=page.getViewport({scale:1}).transform;
        const restored=extractPositionedText(content.items,transform,list,pdfjs.OPS,id=>page.commonObjs.get(id),pdfRules(list,pdfjs.OPS,transform));
        assert.equal(countUnresolvedGlyphs(restored.items.map(i=>i.text).join('')),0,`page ${n}`);
        if(n===5||n===6||n===10){
          const fragment=n===5?'\ue0ea \ue044\ue05c':n===6?'\ue04b\ue0f8 \ue101 \ue0f8 ≥':'\ue044\ue035\ue0fc';
          const item=content.items.find(i=>i.str===fragment);
          assert.ok(item,`original structural fragment, page ${n}`);
          const split=splitEquationTextItems([item],transform,syntheticBoldAreas(list,pdfjs.OPS,transform,true),
            new Map([[item.fontName,decoders.get('eq')]]));
          assert.equal(split.length,n===5?3:n===6?4:2,`painted structure boundaries, page ${n}`);
          assert.equal(split.map(i=>i.str).join(''),fragment.replace(/\s/g,''));
          if(n===10)assert.ok(split[0].transform[3]>split[1].transform[3]*2,'stretched delimiter metrics do not leak into operands');
        }
        for(const item of content.items.filter(i=>i.str)){
          const font=page.commonObjs.get(item.fontName);
          for(const unicode of item.str){
            const expected=verified.get(unicode.codePointAt(0));if(!expected)continue;
            const source=Object.entries(font.toUnicode?._map??{}).find(([,value])=>value===unicode)?.[0];
            assert.notEqual(source,undefined);
            const fontChar=String.fromCodePoint(font.toFontChar[Number(source)]);
            assert.equal(glyphOutlineFingerprint(font.data,fontChar.codePointAt(0)),expected[1]);
            const decoded=decodeOne(unicode,fontChar,font);
            assert.equal(decoded.recoveredGlyphs,1);
            assert.equal(decoded.items.map(i=>i.text).join('').replace(/\$/g,'').replace(/\\(?:mathrm|mathit)\{([^{}]+)\}/g,'$1'),expected[0]);
            assert.equal(decodeOne(unicode,fontChar,{...font,name:'UnknownFont'}).recoveredGlyphs,0);
            const wrongCode=unicode==='\ue05b'?'\ue017':'\ue05b';
            assert.equal(decodeOne(wrongCode,fontChar,font).recoveredGlyphs,0);
            seen.set(unicode.codePointAt(0),(seen.get(unicode.codePointAt(0))??0)+1);
          }
        }
      }
      assert.deepEqual([...seen].sort((a,b)=>a[0]-b[0]),[...verified].map(([code,v])=>[code,v[2]]).sort((a,b)=>a[0]-b[0]));
    }finally{await pdf.destroy();}
  });
