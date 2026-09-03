import type { AnalyzedQuestion } from './pdf-analysis';

type ZipEntry = { name: string; data: Uint8Array };
const encoder = new TextEncoder();

export function downloadDocx(title: string, questions: AnalyzedQuestion[]) {
  saveBlob(createDocxBytes(title, questions), safeName(title, 'docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

export function createDocxBytes(title: string, questions: AnalyzedQuestion[]) {
  const body = questions.map((question) => `
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${xml(`${question.number}번 문항`)}</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">${xml(question.text)}</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Standard"/></w:pPr><w:r><w:t>${xml(`${question.standardCode} ${question.domain}`)}</w:t></w:r></w:p>
    <w:p><w:r><w:t>${xml(question.standard)}</w:t></w:r></w:p>`).join('');
  const entries: ZipEntry[] = [
    entry('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`),
    entry('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
    entry('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    entry('word/styles.xml', docxStyles()),
    entry('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>${xml(title)}</w:t></w:r></w:p><w:p><w:r><w:t>${xml(`문항 ${questions.length}개 · 성취기준별 자동 분류`)}</w:t></w:r></w:p>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`),
  ];
  return zip(entries);
}

export function downloadHwpx(title: string, questions: AnalyzedQuestion[]) {
  saveBlob(createHwpxBytes(title, questions), safeName(title, 'hwpx'), 'application/hwp+zip');
}

export function createHwpxBytes(title: string, questions: AnalyzedQuestion[]) {
  const paragraphs = [title, `문항 ${questions.length}개 · 성취기준별 자동 분류`, ...questions.flatMap((q) => [`${q.number}번 문항`, q.text, `${q.standardCode} ${q.domain}`, q.standard])]
    .map((text, index) => `<hp:p id="${index}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:t>${xml(text)}</hp:t></hp:run></hp:p>`).join('');
  const entries: ZipEntry[] = [
    entry('mimetype', 'application/hwp+zip'),
    entry('version.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" targetApplication="WORDPROCESSOR" major="5" minor="1" micro="0" buildNumber="1" os="1" xmlVersion="1.4" application="문항맵" appVersion="1.0"/>`),
    entry('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/></rootfiles></container>`),
    entry('META-INF/manifest.xml', `<?xml version="1.0" encoding="UTF-8"?><manifest xmlns="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><file-entry full-path="/" media-type="application/hwp+zip"/><file-entry full-path="Contents/content.hpf" media-type="application/xml"/><file-entry full-path="Contents/header.xml" media-type="application/xml"/><file-entry full-path="Contents/section0.xml" media-type="application/xml"/></manifest>`),
    entry('Contents/content.hpf', `<?xml version="1.0" encoding="UTF-8"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf/" version="2.0"><opf:metadata><opf:title>${xml(title)}</opf:title><opf:language>ko</opf:language></opf:metadata><opf:manifest><opf:item id="header" href="header.xml" media-type="application/xml"/><opf:item id="section0" href="section0.xml" media-type="application/xml"/></opf:manifest><opf:spine><opf:itemref idref="section0"/></opf:spine></opf:package>`),
    entry('Contents/header.xml', `<?xml version="1.0" encoding="UTF-8"?><hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" version="1.4" secCnt="1"><hh:refList><hh:fontfaces itemCnt="1"><hh:fontface lang="HANGUL" fontCnt="1"><hh:font id="0" face="함초롬바탕" type="TTF" isEmbedded="0"/></hh:fontface></hh:fontfaces><hh:charProperties itemCnt="1"><hh:charPr id="0" height="1000" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="0"><hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/></hh:charPr></hh:charProperties><hh:paraProperties itemCnt="1"><hh:paraPr id="0" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1"><hh:align horizontal="JUSTIFY" vertical="BASELINE"/></hh:paraPr></hh:paraProperties><hh:styles itemCnt="1"><hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/></hh:styles></hh:refList></hh:head>`),
    entry('Contents/section0.xml', `<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">${paragraphs}</hs:sec>`),
  ];
  return zip(entries);
}

function docxStyles() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Malgun Gothic" w:eastAsia="맑은 고딕"/><w:sz w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="320" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="360"/></w:pPr><w:rPr><w:b/><w:color w:val="163C63"/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="163C63"/><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Standard"><w:name w:val="Standard"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="180" w:after="80"/></w:pPr><w:rPr><w:b/><w:color w:val="2D6A4F"/></w:rPr></w:style></w:styles>`;
}

function entry(name: string, data: string): ZipEntry { return { name, data: encoder.encode(data) }; }
function xml(value: string) { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char] ?? char)); }
function safeName(name: string, ext: string) { return `${name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_')}_문항분류.${ext}`; }
function saveBlob(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function zip(entries: ZipEntry[]) {
  const local: number[] = []; const central: number[] = []; let offset = 0;
  for (const item of entries) {
    const name = encoder.encode(item.name); const crc = crc32(item.data); const size = item.data.length;
    const header = [...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...name];
    local.push(...header, ...item.data);
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name);
    offset += header.length + size;
  }
  return new Uint8Array([...local, ...central, ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(central.length), ...u32(local.length), ...u16(0)]);
}

function u16(n: number) { return [n & 255, (n >>> 8) & 255]; }
function u32(n: number) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
