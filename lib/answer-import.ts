import { parseAnswerKeyPages, parseAnswerKeyText } from './answer-key';
import { countUnresolvedGlyphs, extractPositionedText } from './pdf-text';

/** Read only the selected local file. Never send answers to a recognition API. */
export async function readAnswerFile(file: File, progress?: (message: string) => void) {
  if (!file.size || file.size > 40_000_000) throw new Error('정답 파일은 40MB 이하의 비어 있지 않은 파일을 선택하세요.');
  const extension = file.name.split('.').pop()?.toLowerCase();
  const options = { sourceFileName: file.name };
  if (extension === 'txt' || extension === 'csv') {
    const text = await file.text();
    if (text.includes('\uFFFD')) throw new Error('텍스트 인코딩을 읽지 못했습니다. UTF-8 형식으로 저장한 TXT/CSV를 선택하세요.');
    return parseAnswerKeyText(text, { ...options, format: extension === 'csv' ? 'csv' : 'text' });
  }
  if (extension === 'hwpx') {
    const { parseHwpx } = await import('./hwpx-import');
    const document = await parseHwpx(file);
    if (document.notes.length) throw new Error('각주·미주에 정답이 있는 HWPX는 아직 지원하지 않습니다. 정답표를 본문으로 옮기거나 TXT/CSV로 저장해 주세요.');
    const result = parseAnswerKeyText(document.plainText, options);
    return { ...result, warnings: [...document.warnings, ...result.warnings] };
  }
  if (extension !== 'pdf') throw new Error('정답 파일은 PDF·HWPX·UTF-8 TXT/CSV를 지원합니다.');
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), fontExtraProperties: true }).promise;
  try {
    if (pdf.numPages > 100) throw new Error('정답 PDF는 100쪽 이하로 나누어 선택하세요.');
    const pages = [];
    let unreadable = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      progress?.(`정답표 읽는 중 · ${number}/${pdf.numPages}쪽`);
      const page = await pdf.getPage(number);
      const [content, operators] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
      if (content.items.length > 100_000) throw new Error('한 페이지의 텍스트가 너무 많습니다. 정답표 부분만 분리해 주세요.');
      const { items } = extractPositionedText(content.items, page.getViewport({ scale: 1 }).transform, operators, pdfjs.OPS, id => page.commonObjs.get(id));
      unreadable += items.reduce((count, item) => count + countUnresolvedGlyphs(item.text), 0);
      pages.push({ page: number, items });
      page.cleanup();
    }
    const result = parseAnswerKeyPages(pages, options);
    if (unreadable) result.warnings.unshift(`정답표에서 ${unreadable}개 문자를 복원하지 못했습니다. 해당 값은 원본과 대조하세요.`);
    if (!pages.some(page => page.items.some(item => item.text.trim()))) result.warnings.unshift('이미지로 된 정답표는 로컬 텍스트 판독이 불가능합니다. 텍스트가 있는 PDF나 HWPX·TXT/CSV를 사용하세요.');
    return result;
  } finally { await pdf.destroy(); }
}
