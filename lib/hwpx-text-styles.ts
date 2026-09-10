import { textRuns } from './text-formatting';
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
    runs: (text: string, base = '0') =>
      textRuns(text)
        .map(
          (r) =>
            `<hp:run charPrIDRef="${ids.get(`${base}:${r.bold}:${r.underline}`) ?? base}"><hp:t>${xml(r.text)}</hp:t></hp:run>`,
        )
        .join('') || `<hp:run charPrIDRef="${base}"><hp:t/></hp:run>`,
  };
}
