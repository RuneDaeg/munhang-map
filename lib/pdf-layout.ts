// Coordinates use the rendered viewport: origin at the top left, including rotation.
export type PageText = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  baseline?: number;
  equation?: boolean;
  fontName?: string;
  mathRole?: 'fractionBar' | 'radical';
  sourceBounds?: { x: number; y: number; width: number; height: number };
};
export type CaptureBox = [number, number, number, number];
type Line = PageText & { column: number };

/** Measure a continuous text-free gutter; question numbers are not required on both sides. */
export function measureColumnGutter(items: PageText[], width: number, height: number) {
  const heights = items.filter(i => i.height > 0).map(i => i.height).sort((a, b) => a - b);
  const bodyHeight = heights[Math.floor(heights.length / 2)] ?? 12;
  // Short questions may end in the top fifth of the page. Omitting them makes
  // spaces inside the neighbouring question look like the column gutter.
  // Exclude oversized masthead glyphs, which can span the otherwise empty gap.
  const body = items.filter(i => i.y > height * 0.1 && i.y < height * 0.88 && i.width > 0 && i.height <= Math.min(height * 0.08, bodyHeight * 1.8));
  const gaps: Array<{left:number;right:number}> = [];
  let start: number | undefined;
  const step = width / 500;
  for(let x=width*.4; x<=width*.6; x+=step){
    const occupied=body.some(i=>i.x < x+step/2 && i.x+i.width > x-step/2);
    if(!occupied && start===undefined) start=x;
    if((occupied || x+step>width*.6) && start!==undefined){gaps.push({left:start,right:x});start=undefined;}
  }
  return gaps.filter(g=>g.right-g.left>=width*.008
    && body.filter(i=>i.x+i.width<=g.left).length>=12
    && body.filter(i=>i.x>=g.right).length>=12)
    .sort((a,b)=>Math.abs((a.left+a.right)/2-width/2)-Math.abs((b.left+b.right)/2-width/2))[0];
}
export type PageLayout = {
  page: number;
  width: number;
  height: number;
  headerText: string;
  bodyItems: PageText[];
  columns: Array<{
    left: number;
    right: number;
    top: number;
    bottom: number;
    lines: Line[];
  }>;
};
export type LocatedQuestion = {
  number: number;
  page: number;
  text: string;
  regions: Array<{ page: number; box: CaptureBox }>;
  warning?: string;
};

function linesFrom(items: PageText[], column: number): Line[] {
  const rows: Array<{ y: number; parts: PageText[] }> = [];
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find(
      (row) =>
        Math.abs(row.y - item.y) <=
        Math.max(2.5, Math.min(item.height * 0.32, 4)),
    );
    if (row) row.parts.push(item);
    else rows.push({ y: item.y, parts: [item] });
  }
  return rows
    .map(({ parts }) => {
      parts.sort((a, b) => a.x - b.x);
      const x = Math.min(...parts.map((part) => part.x));
      const y = Math.min(...parts.map((part) => part.y));
      return {
        column,
        x,
        y,
        width: Math.max(...parts.map((part) => part.x + part.width)) - x,
        height: Math.max(...parts.map((part) => part.y + part.height)) - y,
        sourceBounds: {
          x: Math.min(...parts.map(p=>(p.sourceBounds ?? p).x)),
          y: Math.min(...parts.map(p=>(p.sourceBounds ?? p).y)),
          width: Math.max(...parts.map(p=>(p.sourceBounds ?? p).x+(p.sourceBounds ?? p).width))-Math.min(...parts.map(p=>(p.sourceBounds ?? p).x)),
          height: Math.max(...parts.map(p=>(p.sourceBounds ?? p).y+(p.sourceBounds ?? p).height))-Math.min(...parts.map(p=>(p.sourceBounds ?? p).y)),
        },
        text: parts
          .map((part) => part.text)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      };
    })
    .sort((a, b) => a.y - b.y);
}

function questionStart(line: PageText) {
  const match = line.text.match(/^\s*(?:문항\s*)?(\d{1,2})\s*[.)](\s*)(.*)$/);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 80) return null;
  // Decimal measurements and point values are not question numbers.
  if ((!match[2] && /^\d/.test(match[3])) || match[3].startsWith('점'))
    return null;
  return { number: Number(match[1]), rest: match[3] };
}

export function layoutPage(
  items: PageText[],
  width: number,
  height: number,
  page: number,
): PageLayout {
  // Isolate a vertical subject ribbon outside the body. Do not remove arbitrary
  // one-character diagram labels inside a question or a continuation paragraph.
  const ribbonCandidates = items.filter(
    (i) =>
      i.x > width * 0.91 &&
      i.y < height * 0.3 &&
      i.width < i.height * 1.6 &&
      /^[가-힣ⅠⅡⅢIV]{1,3}$/.test(i.text.trim()),
  );
  const ribbons: PageText[] = [];
  for (const seed of ribbonCandidates) {
    const column = ribbonCandidates
      .filter((i) => Math.abs(i.x - seed.x) < 3)
      .sort((a, b) => a.y - b.y);
    if (
      column.length >= 3 &&
      /^(?:물리학|화학|생명과학|지구과학|통합과학|영어|국어)[ⅠⅡⅢIV]*$/.test(
        column.map((i) => i.text.trim()).join(''),
      )
    )
      ribbons.push(...column);
  }
  const excluded = new Set(ribbons);
  items = items.filter((i) => !excluded.has(i));
  const gutter = measureColumnGutter(items,width,height);
  const midpoint = gutter ? (gutter.left+gutter.right)/2 : width/2;
  // PDF producers may store "17", ".", and the stem as separate glyph runs.
  const detectionLines = [
    ...linesFrom(
      items.filter((item) => item.x < midpoint),
      0,
    ),
    ...linesFrom(
      items.filter((item) => item.x >= midpoint),
      1,
    ),
  ];
  const markers = detectionLines.filter(
    (item) =>
      questionStart(item) && item.y > height * 0.035 && item.y < height * 0.96,
  );
  const hasLeft = markers.some((item) => item.x < width * 0.23);
  const hasRight = markers.some(
    (item) => item.x > width * 0.43 && item.x < width * 0.7,
  );
  const spansCenter = items.some(
    (item) =>
      item.y > height * 0.22 &&
      item.x < width * 0.35 &&
      item.x + item.width > width * 0.65,
  );
  const leftBody = items
    .filter((item) => item.x < width * 0.3 && item.y > height * 0.2)
    .reduce((sum, item) => sum + item.text.length, 0);
  const twoColumns = Boolean(gutter) || ((hasLeft || leftBody > 40) && hasRight && !spansCenter);
  const allLines = linesFrom(items, 0);
  const firstQuestionY = markers.length
    ? Math.min(...markers.map((item) => item.y))
    : height * 0.2;
  const headerLimit = Math.min(height * 0.23, firstQuestionY - 2);
  const headerLines = allLines.filter((line) => line.y < headerLimit);
  const headerText = headerLines.map((line) => line.text).join('\n');
  // Repeated exam mastheads are excluded, while text continuing above the next
  // question stays in the body. Tall first-page headings may use more space.
  const masthead = headerLines.filter((line) =>
    /영\s*역|교시|학력평가|수능|모의평가|학년도|성명|수험\s*번호/.test(
      line.text,
    ),
  );
  const top = masthead.length
    ? Math.min(
        firstQuestionY - 3,
        Math.max(...masthead.map((line) => line.y + line.height)) + 5,
      )
    : Math.min(height * 0.065, firstQuestionY - 3);
  const footer = allLines.find(
    (line) =>
      line.y > height * 0.88 &&
      line.width < width * 0.2 &&
      Math.abs((line.x + line.width / 2) / width - 0.5) < 0.1 &&
      /^(?:페이지\s*)?\d{1,3}(?:\s*[/／]?\s*\d{1,3})?$/.test(line.text),
  );
  // Text-item height ends at the baseline; leave room for descenders in the
  // final choices while stopping before the centered footer glyphs.
  const bottom = footer ? Math.min(height * 0.96, footer.y - 2) : height * 0.96;
  const divisions = twoColumns
    ? [
        [Math.max(0,Math.min(...items.filter(i=>i.x<midpoint&&i.y>top&&i.y<bottom).map(i=>i.x))-8), gutter ? gutter.left+2 : midpoint],
        [gutter ? gutter.right-2 : midpoint + width * 0.006, Math.min(width,Math.max(...items.filter(i=>i.x>=midpoint&&i.y>top&&i.y<bottom).map(i=>i.x+i.width))+8)],
      ]
    : [[width * 0.025, width * 0.975]];
  const bodyItems: PageText[] = [];
  const columns = divisions.map(([left, right], column) => {
    let content = items.filter(
      (i) =>
        i.y >= top &&
        i.y < bottom &&
        (!twoColumns || (column === 0 ? i.x < midpoint : i.x >= midpoint)),
    );
    const lines = linesFrom(content, column);
    const notice = lines.find(
      (line, index) =>
        line.y > height * 0.75 &&
        /^[＊*]?\s*확인\s*사항\s*$/.test(line.text) &&
        lines
          .slice(index + 1, index + 4)
          .some((l) => /답안지.*(?:기입|표기|해당)/.test(l.text)),
    );
    const end = notice ? Math.min(bottom, notice.y - 8) : bottom;
    content = content.filter((i) => i.y < end);
    bodyItems.push(...content);
    return {
      left,
      right,
      top: Math.max(0, top),
      bottom: end,
      lines: linesFrom(content, column),
    };
  });
  return {
    page,
    width,
    height,
    headerText,
    bodyItems,
    columns,
  };
}

export function locateQuestions(pages: PageLayout[]): LocatedQuestion[] {
  const columns = pages.flatMap((page) =>
    page.columns.map((column) => ({ ...column, page })),
  );
  const starts = columns.flatMap((column, columnIndex) =>
    column.lines.flatMap((line, lineIndex) => {
      const start = questionStart(line);
      if (!start || line.x > column.left + (column.right - column.left) * 0.2)
        return [];
      return [{ ...start, columnIndex, lineIndex, line }];
    }),
  );
  if (!starts.length) {
    return pages.map((page) => ({
      number: page.page,
      page: page.page,
      text: page.columns
        .flatMap((column) => column.lines.map((line) => line.text))
        .join('\n'),
      regions: [{ page: page.page, box: [0, 0, 1, 1] as CaptureBox }],
      warning:
        '문항 번호를 찾지 못해 페이지 전체를 보존했습니다. 문항 경계를 확인해 주세요.',
    }));
  }
  // Local ascending order filters numbered list items; a new subject/page can restart at 1.
  const accepted: typeof starts = [];
  for (const start of starts) {
    const previous = accepted.at(-1);
    if (
      !previous ||
      start.number > previous.number ||
      (start.number === 1 &&
        columns[start.columnIndex].page.page !==
          columns[previous.columnIndex].page.page)
    )
      accepted.push(start);
  }
  return accepted.map((start, index) => {
    const next = accepted[index + 1];
    const regions: LocatedQuestion['regions'] = [];
    const text: string[] = [];
    const lastColumn = next?.columnIndex ?? columns.length - 1;
    // Include the complete source bounds of tall formulas on the number row.
    // Nearby mathematical-only rows above it are part of that first formula,
    // not the tail of the preceding question (e.g. a radical roof).
    const startTop = (s: typeof start) => {
      const col=columns[s.columnIndex], h=s.line.height;
      const near=col.lines.slice(0,s.lineIndex).filter(l=>l.y>s.line.y-Math.max(24,h*2.4)
        && !/[가-힣①②③④⑤]/.test(l.text) && /[0-9A-Za-z√─$Σ⎧⎨⎩]/.test(l.text)
        && l.x>col.left+12 && l.x<col.left+(col.right-col.left)*.6);
      return Math.max(col.top,Math.min(s.line.sourceBounds?.y ?? s.line.y,...near.map(l=>l.sourceBounds?.y??l.y))-4);
    };
    for (let ci = start.columnIndex; ci <= lastColumn; ci += 1) {
      const column = columns[ci];
      const from = ci === start.columnIndex ? Math.max(0,column.lines.findIndex(l=>l.y>=startTop(start))) : 0;
      const to =
        ci === next?.columnIndex ? Math.max(0,column.lines.findIndex(l=>l.y>=startTop(next))) : column.lines.length;
      if (to <= from) continue;
      const lines = column.lines.slice(from, to);
      const top =
        ci === start.columnIndex
          ? startTop(start)
          : column.top;
      // Stop before a shared passage belonging to the following question group.
      const nextPassage = next
        ? lines.findIndex((line) => sharedRange(line.text)?.[0] === next.number)
        : -1;
      const endLine =
        nextPassage >= 0
          ? lines[nextPassage]
          : ci === next?.columnIndex
            ? next.line
            : undefined;
      const relevant = nextPassage >= 0 ? lines.slice(0, nextPassage) : lines;
      if (!relevant.length) { if(nextPassage>=0) break; continue; }
      const lastBottom = Math.max(
        ...relevant.map((line) => line.y + line.height),
      );
      const bottom = endLine
        ? Math.min(endLine.y, ci===next?.columnIndex && nextPassage<0 ? startTop(next) : endLine.y) - Math.max(0, Math.min(2, (endLine.y - lastBottom) / 2))
        : column.bottom;
      if (bottom <= top) continue;
      regions.push({
        page: column.page.page,
        box: [
          column.left / column.page.width,
          top / column.page.height,
          (column.right - column.left) / column.page.width,
          (bottom - top) / column.page.height,
        ],
      });
      text.push(
        ...relevant.map((line) =>
          ci === start.columnIndex && line === start.line ? start.rest : line.text,
        ),
      );
      if(nextPassage>=0) break;
    }
    // A shared passage is repeated with every question that refers to it.
    let passageStart: { ci: number; li: number } | undefined;
    for (let ci = 0; ci <= start.columnIndex; ci += 1) {
      columns[ci].lines.forEach((line, li) => {
        if (ci === start.columnIndex && li >= start.lineIndex) return;
        const range = sharedRange(line.text);
        if (
          range &&
          start.number >= range[0] &&
          start.number <= range[1]
        )
          passageStart = { ci, li };
      });
    }
    if (passageStart) {
      const passage = passageStart as { ci: number; li: number };
      const first = accepted.find(
        (item) =>
          item.columnIndex > passage.ci ||
          (item.columnIndex === passage.ci && item.lineIndex > passage.li),
      );
      if (first && first.columnIndex <= start.columnIndex) {
        const sharedRegions: LocatedQuestion['regions'] = [];
        const sharedText: string[] = [];
        for (let ci = passage.ci; ci <= first.columnIndex; ci += 1) {
          const column = columns[ci];
          const from = ci === passage.ci ? passage.li : 0;
          const to =
            ci === first.columnIndex ? first.lineIndex : column.lines.length;
          if (to <= from) continue;
          const top =
            ci === passage.ci
              ? Math.max(column.top, column.lines[from].y - 4)
              : column.top;
          const bottom =
            ci === first.columnIndex ? first.line.y - 5 : column.bottom;
          sharedRegions.push({
            page: column.page.page,
            box: [
              column.left / column.page.width,
              top / column.page.height,
              (column.right - column.left) / column.page.width,
              (bottom - top) / column.page.height,
            ],
          });
          sharedText.push(
            ...column.lines.slice(from, to).map((line) => line.text),
          );
        }
        regions.unshift(...sharedRegions);
        text.unshift(...sharedText);
      }
    }
    const warning =
      next && next.number > start.number + 1
        ? `다음 문항 번호가 ${next.number}번으로 이어집니다. 캡처에 누락된 문항이 함께 들어갔는지 확인해 주세요.`
        : undefined;
    return {
      number: start.number,
      page: columns[start.columnIndex].page.page,
      text: text.join('\n').trim(),
      regions,
      warning,
    };
  });
}

function sharedRange(text: string) {
  const match = text.match(/^\s*\[\s*(\d{1,2})\s*[~～∼―–-]\s*(\d{1,2})\s*\]/);
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}
