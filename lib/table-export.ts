import {
  approximateTextWidth,
  parseQuestionContent,
  questionTextFromBlocks,
  tableColumnWeights,
  type QuestionBlock,
} from './question-content';
import { textRuns, unformattedText } from './text-formatting';
import { latexToOmml } from './docx-math';
import { hasUnbalancedMathDelimiters, mathForRendering, splitMathText } from './math-normalization';

const escapeXml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[char]!,
  );
type GridBlock = Exclude<QuestionBlock, { kind: 'text' }>;
const rowsOf = (block: GridBlock) =>
  block.kind === 'box' ? [[block.text]] : block.rows;
const widthsOf = (rows: string[][], total: number) => {
  const weights = tableColumnWeights(rows);
  const sum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((weight) => Math.floor((total * weight) / sum));
  widths[widths.length - 1] += total - widths.reduce((a, b) => a + b, 0);
  return widths;
};

// Newlines inside cases/matrices belong to one equation, not separate Word
// paragraphs. Normalize the delimiters while retaining the complete math span.
function paragraphLines(text: string): string[] {
  if (hasUnbalancedMathDelimiters(text) && /(?<!\\)\$(?=[A-Za-z\\{]|[^$\n]*[_^\\])/.test(text)) {
    throw new Error('수식의 $ 구분자가 닫히지 않았습니다. 문항 편집창에서 수식을 확인해 주세요.');
  }
  const lines = [''];
  for (const part of splitMathText(text)) {
    if (part.math) {
      const delimiter = part.display ? '$$' : '$';
      lines[lines.length - 1] += `${delimiter}${part.text}${delimiter}`;
    } else {
      const pieces = part.text.split('\n');
      lines[lines.length - 1] += pieces[0];
      lines.push(...pieces.slice(1));
    }
  }
  return lines;
}

function docxParagraph(
  text: string,
  header = false,
  align = 'left',
  keepNext = false,
) {
  // A partial rich-text selection can cross a TeX delimiter. Never silently
  // serialize the fragments as $...$ text if they cannot be one math object.
  if (hasUnbalancedMathDelimiters(text) && /(?<!\\)\$(?=[A-Za-z\\{]|[^$\n]*[_^\\])/.test(text)) {
    throw new Error('한 줄 수식의 $ 구분자를 확인해 주세요. 여러 줄 수식에는 $$...$$를 사용해 주세요.');
  }
  if (splitMathText(text).some((part) => part.math && /<\/?(?:b|u)>/.test(part.text))) {
    throw new Error('수식 일부에 적용된 굵게·밑줄을 해제하고, $...$ 수식 전체를 선택해 서식을 적용해 주세요.');
  }
  const runs = textRuns(text)
    .map((run) => splitMathText(run.text).map((part) => part.math
      ? latexToOmml(mathForRendering(part.text), { display: part.display, bold: header || run.bold, underline: run.underline })
      : `<w:r><w:rPr>${header || run.bold ? '<w:b/>' : ''}${run.underline ? '<w:u w:val="single"/>' : ''}</w:rPr><w:t xml:space="preserve">${escapeXml(part.text)}</w:t></w:r>`).join(''))
    .join('');
  return `<w:p><w:pPr><w:jc w:val="${align}"/><w:spacing w:after="100" w:line="320" w:lineRule="auto"/>${keepNext ? '<w:keepNext/>' : ''}</w:pPr>${runs}</w:p>`;
}

export function docxQuestionContent(
  text: string,
  availableWidth = 9400,
): string {
  const blocks = parseQuestionContent(text);
  return blocks
    .map((block, index) => {
      if (block.kind === 'text') {
        const lines = paragraphLines(block.text);
        const followedByTable =
          blocks[index + 1] && blocks[index + 1].kind !== 'text';
        return lines
          .map((line, lineIndex) =>
            docxParagraph(
              line,
              false,
              'left',
              Boolean(followedByTable && lineIndex === lines.length - 1),
            ),
          )
          .join('');
      }
      const rows = rowsOf(block);
      const widths = widthsOf(rows, availableWidth);
      const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
        .map((side) => `<w:${side} w:val="single" w:sz="6" w:color="808080"/>`)
        .join('');
      return `${block.title ? docxParagraph(block.title, true, 'center', true) : ''}<w:tbl><w:tblPr><w:tblW w:w="${availableWidth}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${borders}</w:tblBorders><w:tblCellMar><w:top w:w="150" w:type="dxa"/><w:left w:w="150" w:type="dxa"/><w:bottom w:w="150" w:type="dxa"/><w:right w:w="150" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${rows
        .map((row, r) => {
          const header = block.kind === 'table' && block.header && r === 0;
          return `<w:tr>${block.kind === 'table' ? `<w:trPr><w:cantSplit/>${header ? '<w:tblHeader/>' : ''}</w:trPr>` : ''}${row
            .map(
              (cell, c) =>
                `<w:tc><w:tcPr><w:tcW w:w="${widths[c]}" w:type="dxa"/><w:vAlign w:val="center"/>${header ? '<w:shd w:val="clear" w:fill="EAF0F4"/>' : ''}</w:tcPr>${
                  block.kind === 'box' && cell.includes(':::')
                    ? docxQuestionContent(cell, Math.max(1200, widths[c] - 300))
                    : paragraphLines(cell)
                        .map((line) =>
                          docxParagraph(
                            line,
                            header,
                            block.kind === 'table' &&
                              unformattedText(cell).length < 15
                              ? 'center'
                              : 'left',
                          ),
                        )
                        .join('')
                }</w:tc>`,
            )
            .join('')}</w:tr>`;
        })
        .join('')}</w:tbl>${docxParagraph('')}`;
    })
    .join('');
}

export function prepareHwpxTableStyles(header: string) {
  const fills = header.match(
    /<hh:borderFills\b[^>]*>[\s\S]*?<\/hh:borderFills>/,
  )?.[0];
  if (!fills) throw new Error('HWPX 표 테두리 스타일을 찾지 못했습니다.');
  const ids = [...fills.matchAll(/<hh:borderFill\b[^>]*\bid="(\d+)"/g)].map(
    (match) => Number(match[1]),
  );
  const border = Math.max(0, ...ids) + 1;
  const make = (id: number, fill: boolean) =>
    `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>${['left', 'right', 'top', 'bottom'].map((side) => `<hh:${side}Border type="SOLID" width="0.12 mm" color="#808080"/>`).join('')}<hh:diagonal type="NONE" width="0.1 mm" color="#808080"/>${fill ? '<hc:fillBrush><hc:winBrush faceColor="#EAF0F4" hatchColor="#999999" alpha="0"/></hc:fillBrush>' : ''}</hh:borderFill>`;
  return {
    header: header.replace(
      fills,
      fills
        .replace(/itemCnt="\d+"/, `itemCnt="${ids.length + 2}"`)
        .replace(
          '</hh:borderFills>',
          `${make(border, false)}${make(border + 1, true)}</hh:borderFills>`,
        ),
    ),
    border,
    headerBorder: border + 1,
  };
}

type HwpxContext = {
  paragraph: (text: string, charPr?: string) => string;
  nextId: () => number;
  border: number;
  headerBorder: number;
};

export function hwpxQuestionContent(
  text: string,
  context: HwpxContext,
): string {
  return parseQuestionContent(text)
    .map((block) => {
      // Hancom may clip tables nested inside a single very tall cell. Keep every
      // inner table native, but split the enclosing box into consecutive segments.
      if (block.kind === 'box' && block.text.includes(':::')) {
        return (
          (block.title ? context.paragraph(block.title, '6') : '') +
          parseQuestionContent(block.text)
            .map((child) => {
              if (child.kind === 'text' && !child.text.trim()) return '';
              const source =
                child.kind === 'text'
                  ? ':::box\n' + child.text + '\n:::'
                  : child.kind === 'box'
                    ? ':::box ' + child.title + '\n' + child.text + '\n:::'
                    : questionTextFromBlocks([{ ...child, text: '' }])!;
              return hwpxQuestionContent(source, context);
            })
            .join('')
        );
      }
      if (block.kind === 'text')
        return block.text
          .split('\n')
          .filter(Boolean)
          .map((line) => context.paragraph(line))
          .join('');
      const rows = rowsOf(block);
      const widths = widthsOf(rows, 40000);
      // Base template: 10pt body, 160% line spacing. Grow every cell in a row
      // together; never squeeze text or reuse stale line-layout caches.
      const heights = rows.map((row) =>
        Math.max(
          ...row.map((cell, col) =>
            cell.split('\n').reduce((height, line) => {
              const textWidth =
                approximateTextWidth(unformattedText(line), 0.6) * 1000;
              return (
                height +
                Math.max(
                  1,
                  Math.ceil(textWidth / Math.max(1000, widths[col] - 1200)),
                ) *
                  1600
              );
            }, 1200),
          ),
        ),
      );
      const paragraphId = context.nextId();
      const tableId = context.nextId();
      const height = heights.reduce((a, b) => a + b, 0);
      const table = `<hp:p id="${paragraphId}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:tbl id="${tableId}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="${block.kind === 'table' && block.header ? 1 : 0}" rowCnt="${rows.length}" colCnt="${widths.length}" cellSpacing="0" borderFillIDRef="${context.border}" noAdjust="0"><hp:sz width="40000" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="400" bottom="400"/><hp:inMargin left="600" right="600" top="600" bottom="600"/>${rows
        .map(
          (row, r) =>
            `<hp:tr>${row
              .map((cell, c) => {
                const header =
                  block.kind === 'table' && block.header && r === 0;
                return `<hp:tc name="" header="${header ? 1 : 0}" hasMargin="1" protect="0" editable="0" dirty="1" borderFillIDRef="${header ? context.headerBorder : context.border}"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${cell
                  .split('\n')
                  .map((line) => context.paragraph(line))
                  .join(
                    '',
                  )}</hp:subList><hp:cellAddr colAddr="${c}" rowAddr="${r}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${widths[c]}" height="${heights[r]}"/><hp:cellMargin left="600" right="600" top="600" bottom="600"/></hp:tc>`;
              })
              .join('')}</hp:tr>`,
        )
        .join('')}</hp:tbl><hp:t/></hp:run></hp:p>`;
      return `${block.title ? context.paragraph(block.title, '6') : ''}${table}${context.paragraph('')}`;
    })
    .join('');
}
