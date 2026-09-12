import { textRuns } from './text-formatting';
import { hasUnbalancedMathDelimiters, mathForRendering, splitMathText } from './math-normalization';
import { latexToHwpxEquation } from './hwpx-math';
const xml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[c]!,
  );
export function prepareHwpxTextStyles(header: string) {
  const section = header.match(
    /<hh:charProperties\b[^>]*>[\s\S]*?<\/hh:charProperties>/,
  )?.[0];
  if (!section) throw new Error('HWPX 글자 스타일이 없습니다.');
  const originals = [
    ...section.matchAll(/<hh:charPr\b[^>]*>[\s\S]*?<\/hh:charPr>/g),
  ].map((m) => m[0]);
  let id =
    Math.max(...originals.map((s) => Number(s.match(/\bid="(\d+)"/)![1]))) + 1;
  const additions: string[] = [],
    ids = new Map<string, string>();
  const fontSizes = new Map(originals.map((style) => [
    style.match(/\bid="(\d+)"/)![1],
    Number(style.match(/\bheight="(\d+)"/)?.[1] ?? 1000) / 100,
  ]));
  for (const base of originals)
    for (const [bold, underline] of [
      [true, false],
      [false, true],
      [true, true],
    ]) {
      const oldId = base.match(/\bid="(\d+)"/)![1],
        next = String(id++);
      let style = base.replace(/\bid="\d+"/, `id="${next}"`);
      if (bold && !style.includes('<hh:bold'))
        style = style.replace('<hh:underline', '<hh:bold/><hh:underline');
      if (underline)
        style = style.replace(
          /<hh:underline\b[^>]*\/>/,
          '<hh:underline type="BOTTOM" shape="SOLID" color="#000000"/>',
        );
      additions.push(style);
      ids.set(`${oldId}:${bold}:${underline}`, next);
    }
  return {
    header: header.replace(
      section,
      section
        .replace(
          /itemCnt="\d+"/,
          `itemCnt="${originals.length + additions.length}"`,
        )
        .replace(
          '</hh:charProperties>',
          additions.join('') + '</hh:charProperties>',
        ),
    ),
    runs: (text: string, base = '0', nextId?: () => number) => {
      if (hasUnbalancedMathDelimiters(text) && /(?<!\\)\$(?=[A-Za-z\\{]|[^$\n]*[_^\\])/.test(text)) {
        throw new Error('수식의 $ 구분자가 닫히지 않았습니다. 문항 편집창에서 수식을 확인해 주세요.');
      }
      if (splitMathText(text).some((part) => part.math && /<\/?(?:b|u)>|\[\/?(?:b|u)\]/.test(part.text))) {
        throw new Error('수식 일부에 적용된 굵게·밑줄을 해제하고, $...$ 수식 전체를 선택해 서식을 적용해 주세요.');
      }
      return textRuns(text).map((run) => {
        const styleId = ids.get(`${base}:${run.bold}:${run.underline}`) ?? base;
        return splitMathText(run.text).map((part) => {
          if (!part.math) return `<hp:run charPrIDRef="${styleId}"><hp:t>${xml(part.text)}</hp:t></hp:run>`;
          if (!nextId) throw new Error('HWPX 수식의 개체 ID 생성기가 없습니다.');
          const equation = latexToHwpxEquation(mathForRendering(part.text), {
            id: nextId(), fontSizePt: fontSizes.get(base) ?? 10,
            display: part.display, bold: run.bold, underline: run.underline,
          });
          return `<hp:run charPrIDRef="${styleId}">${equation}<hp:t/></hp:run>`;
        }).join('');
      }).join('') || `<hp:run charPrIDRef="${base}"><hp:t/></hp:run>`;
    },
  };
}
