import type { AnalyzedQuestion } from './pdf-analysis';

// HWPX packaging follows jkf87/hwpx-skill Workflow A and uses its MIT base
// skeleton. Full attribution and pinned revisions are in THIRD_PARTY_NOTICES.md.

type ZipEntry = { name: string; data: Uint8Array };
type EmbeddedPageImage = { itemId: string; fileName: string; data: Uint8Array; width: number; height: number };
const encoder = new TextEncoder();

export function downloadDocx(title: string, questions: AnalyzedQuestion[]) {
  saveBlob(createDocxBytes(title, questions), safeName(title, 'docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

export function createDocxBytes(title: string, questions: AnalyzedQuestion[]) {
  const images = collectPageImages(questions);
  const body = questions.map((question, index) => `
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${xml(`${question.number}번 문항`)}</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">${xml(question.text)}</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Standard"/></w:pPr><w:r><w:t>${xml(`${question.standardCode} ${question.domain}`)}</w:t></w:r></w:p>
    <w:p><w:r><w:t>${xml(question.standard)}</w:t></w:r></w:p>
    ${(images.byQuestion.get(index) ?? []).map((image, imageIndex) => `<w:p><w:r><w:rPr><w:b/><w:color w:val="64748B"/></w:rPr><w:t>${question.questionCaptures?.length ? '문항 전체 원문 캡처' : '문항 그림자료'}${question.captureWarning ? ' · 범위 확인 필요' : ''}</w:t></w:r></w:p>${docxImageParagraph(`rIdImage${image.itemId}`, index * 100 + imageIndex + 1, image)}`).join('')}`).join('');
  const sourceNotice = '<w:p><w:r><w:rPr><w:color w:val="64748B"/><w:sz w:val="18"/></w:rPr><w:t>성취기준 출처: pblsketch/worksheet-grab (2022 개정 교육과정)</w:t></w:r></w:p>';
  const imageRelationships = images.unique.map((image) => `<Relationship Id="rIdImage${image.itemId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${image.fileName}"/>`).join('');
  const entries: ZipEntry[] = [
    entry('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`),
    entry('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
    entry('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${imageRelationships}</Relationships>`),
    entry('word/styles.xml', docxStyles()),
    entry('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>${xml(title)}</w:t></w:r></w:p><w:p><w:r><w:t>${xml(`문항 ${questions.length}개 · 성취기준별 자동 분류`)}</w:t></w:r></w:p>${body}${sourceNotice}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`),
    ...images.unique.map((image) => ({ name: `word/media/${image.fileName}`, data: image.data })),
  ];
  return zip(entries);
}

const hwpxTemplatePaths = [
  'mimetype',
  'version.xml',
  'settings.xml',
  'META-INF/container.xml',
  'META-INF/manifest.xml',
  'META-INF/container.rdf',
  'Contents/content.hpf',
  'Contents/header.xml',
  'Contents/section0.xml',
  'Preview/PrvImage.png',
  'Preview/PrvText.txt',
];
let hwpxTemplatePromise: Promise<Map<string, Uint8Array>> | undefined;

export async function downloadHwpx(title: string, questions: AnalyzedQuestion[]) {
  saveBlob(await createHwpxBytes(title, questions), safeName(title, 'hwpx'), 'application/hwp+zip');
}

export async function createHwpxBytes(title: string, questions: AnalyzedQuestion[]) {
  hwpxTemplatePromise ??= Promise.all(hwpxTemplatePaths.map(async (path) => {
    const response = await fetch(`/hwpx-template/${path}`);
    if (!response.ok) throw new Error(`HWPX 템플릿을 읽지 못했습니다: ${path}`);
    return [path, new Uint8Array(await response.arrayBuffer())] as const;
  })).then((items) => new Map(items));
  return createHwpxBytesFromTemplate(title, questions, await hwpxTemplatePromise);
}

export function createHwpxBytesFromTemplate(title: string, questions: AnalyzedQuestion[], template: Map<string, Uint8Array>) {
  const decoder = new TextDecoder();
  const baseSection = decoder.decode(requiredTemplatePart(template, 'Contents/section0.xml'));
  const baseContent = decoder.decode(requiredTemplatePart(template, 'Contents/content.hpf'));
  const images = collectPageImages(questions);
  const section = makeHwpxSection(baseSection, title, questions, images.byQuestion);
  const imageManifest = images.unique.map((image) => `<opf:item id="${image.itemId}" href="BinData/${image.fileName}" media-type="image/jpeg" isEmbeded="1"/>`).join('');
  const content = baseContent
    .replace('<opf:title/>', `<opf:title>${xml(title)}</opf:title>`)
    .replace('name="creator" content="text"', 'name="creator" content="문항맵"')
    .replace('name="lastsaveby" content="text"', 'name="lastsaveby" content="문항맵"')
    .replace('</opf:manifest>', `${imageManifest}</opf:manifest>`);
  const preview = [title, `문항 ${questions.length}개 · 성취기준별 자동 분류`, ...questions.flatMap((question) => [`${question.number}번 문항`, question.text, question.standardCode, question.standard, question.questionCaptures?.length ? '[문항 전체 원문 캡처 포함]' : question.figureImage ? '[문항 그림자료 포함]' : '']), '성취기준 출처: pblsketch/worksheet-grab'].join('\n');
  const replacements = new Map<string, Uint8Array>([
    ['Contents/section0.xml', encoder.encode(section)],
    ['Contents/content.hpf', encoder.encode(content)],
    ['Preview/PrvText.txt', encoder.encode(preview)],
  ]);
  return zip([
    ...hwpxTemplatePaths.map((name) => ({ name, data: replacements.get(name) ?? requiredTemplatePart(template, name) })),
    ...images.unique.map((image) => ({ name: `BinData/${image.fileName}`, data: image.data })),
  ]);
}

function makeHwpxSection(base: string, title: string, questions: AnalyzedQuestion[], images: Map<number, EmbeddedPageImage[]>) {
  const open = base.match(/<hs:sec\b[^>]*>/)?.[0];
  const first = base.match(/<hp:p\b[\s\S]*?<\/hp:p>/)?.[0]
    ?.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, '')
    .replace(/id="\d+"/, 'id="1"');
  if (!open || !first) throw new Error('HWPX 베이스 템플릿의 secPr/colPr를 찾지 못했습니다.');
  let id = 2;
  const paragraph = (text: string, charPr = '0') => `<hp:p id="${id++}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${charPr}"><hp:t>${xml(text)}</hp:t></hp:run></hp:p>`;
  const parts = [first, paragraph(title, '5'), paragraph(`문항 ${questions.length}개 · 성취기준별 자동 분류`, '6'), paragraph('')];
  for (const [index, question] of questions.entries()) {
    parts.push(paragraph(`${question.number}번 문항`, '6'));
    for (const line of question.text.split(/\r?\n/).filter(Boolean)) parts.push(paragraph(line));
    parts.push(paragraph(`${question.standardCode}  ${question.domain}`, '6'));
    parts.push(paragraph(`- ${question.standard}`));
    for (const image of images.get(index) ?? []) {
      parts.push(paragraph(`${question.questionCaptures?.length ? '문항 전체 원문 캡처' : '문항 그림자료'}${question.captureWarning ? ' · 범위 확인 필요' : ''}`, '2'));
      parts.push(hwpxImageParagraph(id++, image, 10000 + id * 2, 10001 + id * 2));
    }
    parts.push(paragraph(''));
  }
  parts.push(paragraph('성취기준 출처: pblsketch/worksheet-grab (2022 개정 교육과정)', '2'));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n${open}\n${parts.join('\n')}\n</hs:sec>`;
}

function requiredTemplatePart(template: Map<string, Uint8Array>, name: string) {
  const part = template.get(name);
  if (!part) throw new Error(`HWPX 템플릿 파트 누락: ${name}`);
  return part;
}

function collectPageImages(questions: AnalyzedQuestion[]) {
  const unique: EmbeddedPageImage[] = [];
  const byDataUrl = new Map<string, EmbeddedPageImage>();
  const byQuestion = new Map<number, EmbeddedPageImage[]>();
  questions.forEach((question, index) => {
    const sources = question.questionCaptures?.length ? question.questionCaptures.map((capture) => capture.image) : question.figureImage ? [question.figureImage] : [];
    const embedded: EmbeddedPageImage[] = [];
    for (const source of sources) {
      if (!source.startsWith('data:image/jpeg;base64,')) continue;
      let image = byDataUrl.get(source);
      if (!image) {
        const number = unique.length + 1;
        const data = dataUrlBytes(source);
        const [width, height] = jpegDimensions(data) ?? [4, 3];
        image = { itemId: `image${number}`, fileName: `question${number}.jpg`, data, width, height };
        unique.push(image);
        byDataUrl.set(source, image);
      }
      embedded.push(image);
    }
    byQuestion.set(index, embedded);
  });
  return { unique, byQuestion };
}

function dataUrlBytes(dataUrl: string) {
  const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const decoded = atob(encoded);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

function jpegDimensions(bytes: Uint8Array): [number, number] | undefined {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
    if (marker >= 0xc0 && marker <= 0xc3) return [(bytes[offset + 7] << 8) + bytes[offset + 8], (bytes[offset + 5] << 8) + bytes[offset + 6]];
    offset += 2 + Math.max(length, 2);
  }
  return undefined;
}

function docxImageParagraph(relationshipId: string, imageId: number, image: EmbeddedPageImage) {
  let width = 4480560;
  let height = Math.round(width * image.height / image.width);
  if (height > 6200000) { width = Math.round(width * 6200000 / height); height = 6200000; }
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${imageId}" name="문항 그림자료 ${imageId}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${imageId}" name="figure${imageId}.jpg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function hwpxImageParagraph(paragraphId: number, image: EmbeddedPageImage, pictureId: number, instanceId: number) {
  let width = 40000;
  let height = Math.round(width * image.height / image.width);
  if (height > 56000) { width = Math.round(width * 56000 / height); height = 56000; }
  return `<hp:p id="${paragraphId}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:pic id="${pictureId}" zOrder="0" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${instanceId}" reverse="0"><hp:offset x="0" y="0"/><hp:orgSz width="${width}" height="${height}"/><hp:curSz width="${width}" height="${height}"/><hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0" centerX="${Math.round(width / 2)}" centerY="${Math.round(height / 2)}" rotateimage="0"/><hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo><hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${width}" y="0"/><hc:pt2 x="${width}" y="${height}"/><hc:pt3 x="0" y="${height}"/></hp:imgRect><hp:imgClip left="0" right="${width}" top="0" bottom="${height}"/><hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:imgDim dimwidth="${width}" dimheight="${height}"/><hc:img binaryItemIDRef="${image.itemId}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/><hp:effects/><hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="CENTER" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:shapeComment>문항 그림자료</hp:shapeComment></hp:pic></hp:run></hp:p>`;
}

function docxStyles() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Malgun Gothic" w:eastAsia="맑은 고딕"/><w:sz w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="320" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="360"/></w:pPr><w:rPr><w:b/><w:color w:val="163C63"/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="163C63"/><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Standard"><w:name w:val="Standard"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="180" w:after="80"/></w:pPr><w:rPr><w:b/><w:color w:val="2D6A4F"/></w:rPr></w:style></w:styles>`;
}

function entry(name: string, data: string): ZipEntry { return { name, data: encoder.encode(data) }; }
function xml(value: string) { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char] ?? char)); }
function safeName(name: string, ext: string) { return `${name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_')}_문항분류.${ext}`; }
function saveBlob(bytes: Uint8Array, name: string, type: string) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([buffer], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function zip(entries: ZipEntry[]) {
  const local: Uint8Array[] = []; const central: number[] = []; let offset = 0;
  for (const item of entries) {
    const name = encoder.encode(item.name); const crc = crc32(item.data); const size = item.data.length;
    const header = [...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...name];
    local.push(new Uint8Array(header), item.data);
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name);
    offset += header.length + size;
  }
  const ending = new Uint8Array([...central, ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(central.length), ...u32(offset), ...u16(0)]);
  const output = new Uint8Array(offset + ending.length);
  let cursor = 0;
  for (const part of [...local, ending]) { output.set(part, cursor); cursor += part.length; }
  return output;
}

function u16(n: number) { return [n & 255, (n >>> 8) & 255]; }
function u32(n: number) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
