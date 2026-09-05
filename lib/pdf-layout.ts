// Coordinates use the rendered viewport: origin at the top left, including rotation.
export type PageText = { text: string; x: number; y: number; width: number; height: number };
export type CaptureBox = [number, number, number, number];
type Line = PageText & { column: number };
export type PageLayout = {
  page: number;
  width: number;
  height: number;
  headerText: string;
  columns: Array<{ left: number; right: number; top: number; bottom: number; lines: Line[] }>;
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
    const row = rows.find((row) => Math.abs(row.y - item.y) <= Math.max(2.5, Math.min(item.height * 0.32, 4)));
    if (row) row.parts.push(item);
    else rows.push({ y: item.y, parts: [item] });
  }
  return rows.map(({ parts }) => {
    parts.sort((a, b) => a.x - b.x);
    const x = Math.min(...parts.map((part) => part.x));
    const y = Math.min(...parts.map((part) => part.y));
    return {
      column, x, y,
      width: Math.max(...parts.map((part) => part.x + part.width)) - x,
      height: Math.max(...parts.map((part) => part.y + part.height)) - y,
      text: parts.map((part) => part.text).join(' ').replace(/\s+/g, ' ').trim(),
    };
  }).sort((a, b) => a.y - b.y);
}

function questionStart(line: PageText) {
  const match = line.text.match(/^\s*(?:문항\s*)?(\d{1,2})\s*[.)](\s*)(.*)$/);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 80) return null;
  // Decimal measurements and point values are not question numbers.
  if ((!match[2] && /^\d/.test(match[3])) || match[3].startsWith('점')) return null;
  return { number: Number(match[1]), rest: match[3] };
}

export function layoutPage(items: PageText[], width: number, height: number, page: number): PageLayout {
  const midpoint = width / 2;
  // PDF producers may store "17", ".", and the stem as separate glyph runs.
  const detectionLines = [...linesFrom(items.filter((item) => item.x < midpoint), 0), ...linesFrom(items.filter((item) => item.x >= midpoint), 1)];
  const markers = detectionLines.filter((item) => questionStart(item) && item.y > height * 0.035 && item.y < height * 0.96);
  const hasLeft = markers.some((item) => item.x < width * 0.23);
  const hasRight = markers.some((item) => item.x > width * 0.43 && item.x < width * 0.7);
  const spansCenter = items.some((item) => item.y > height * 0.22 && item.x < width * 0.35 && item.x + item.width > width * 0.65);
  const leftBody = items.filter((item) => item.x < width * 0.3 && item.y > height * 0.2).reduce((sum, item) => sum + item.text.length, 0);
  const twoColumns = (hasLeft || leftBody > 40) && hasRight && !spansCenter;
  const allLines = linesFrom(items, 0);
  const firstQuestionY = markers.length ? Math.min(...markers.map((item) => item.y)) : height * 0.2;
  const headerLimit = Math.min(height * 0.23, firstQuestionY - 2);
  const headerLines = allLines.filter((line) => line.y < headerLimit);
  const headerText = headerLines.map((line) => line.text).join('\n');
  // Repeated exam mastheads are excluded, while text continuing above the next
  // question stays in the body. Tall first-page headings may use more space.
  const masthead = headerLines.filter((line) => /영\s*역|교시|학력평가|수능|모의평가|학년도|성명|수험\s*번호/.test(line.text));
  const top = masthead.length ? Math.min(firstQuestionY - 3, Math.max(...masthead.map((line) => line.y + line.height)) + 5) : Math.min(height * 0.065, firstQuestionY - 3);
  const footer = allLines.find((line) => line.y > height * 0.88 && line.width < width * 0.2 && Math.abs((line.x + line.width / 2) / width - 0.5) < 0.1 && /^(?:페이지\s*)?\d{1,3}(?:\s*[/／]?\s*\d{1,3})?$/.test(line.text));
  // Text-item height ends at the baseline; leave room for descenders in the
  // final choices while stopping before the centered footer glyphs.
  const bottom = footer ? Math.min(height * 0.96, footer.y - 2) : height * 0.96;
  const divisions = twoColumns ? [[width * 0.025, midpoint - width * 0.006], [midpoint + width * 0.006, width * 0.975]] : [[width * 0.025, width * 0.975]];
  return {
    page, width, height, headerText,
    columns: divisions.map(([left, right], column) => ({
      left, right, top: Math.max(0, top), bottom,
      lines: linesFrom(items.filter((item) => item.y >= top && item.y < bottom && (!twoColumns || (column === 0 ? item.x < midpoint : item.x >= midpoint))), column),
    })),
  };
}

export function locateQuestions(pages: PageLayout[]): LocatedQuestion[] {
  const columns = pages.flatMap((page) => page.columns.map((column) => ({ ...column, page })));
  const starts = columns.flatMap((column, columnIndex) => column.lines.flatMap((line, lineIndex) => {
    const start = questionStart(line);
    if (!start || line.x > column.left + (column.right - column.left) * 0.2) return [];
    return [{ ...start, columnIndex, lineIndex, line }];
  }));
  if (!starts.length) {
    return pages.map((page) => ({
      number: page.page, page: page.page,
      text: page.columns.flatMap((column) => column.lines.map((line) => line.text)).join('\n'),
      regions: [{ page: page.page, box: [0, 0, 1, 1] as CaptureBox }],
      warning: '문항 번호를 찾지 못해 페이지 전체를 보존했습니다. 문항 경계를 확인해 주세요.',
    }));
  }
  // Local ascending order filters numbered list items; a new subject/page can restart at 1.
  const accepted: typeof starts = [];
  for (const start of starts) {
    const previous = accepted.at(-1);
    if (!previous || start.number > previous.number || (start.number === 1 && columns[start.columnIndex].page.page !== columns[previous.columnIndex].page.page)) accepted.push(start);
  }
  return accepted.map((start, index) => {
    const next = accepted[index + 1];
    const regions: LocatedQuestion['regions'] = [];
    const text: string[] = [];
    const lastColumn = next?.columnIndex ?? columns.length - 1;
    for (let ci = start.columnIndex; ci <= lastColumn; ci += 1) {
      const column = columns[ci];
      const from = ci === start.columnIndex ? start.lineIndex : 0;
      const to = ci === next?.columnIndex ? next.lineIndex : column.lines.length;
      if (to <= from) continue;
      const lines = column.lines.slice(from, to);
      const top = ci === start.columnIndex ? Math.max(column.top, start.line.y - 4) : column.top;
      // Stop before a shared passage belonging to the following question group.
      const nextPassage = next ? lines.findIndex((line) => sharedRange(line.text)?.[0] === next.number) : -1;
      const endLine = nextPassage >= 0 ? lines[nextPassage] : ci === next?.columnIndex ? next.line : undefined;
      const relevant = nextPassage >= 0 ? lines.slice(0, nextPassage) : lines;
      if (!relevant.length) continue;
      const lastBottom = Math.max(...relevant.map((line) => line.y + line.height));
      const bottom = endLine ? endLine.y - Math.max(0, Math.min(4, (endLine.y - lastBottom) / 2)) : column.bottom;
      if (bottom <= top) continue;
      regions.push({ page: column.page.page, box: [column.left / column.page.width, top / column.page.height, (column.right - column.left) / column.page.width, (bottom - top) / column.page.height] });
      text.push(...relevant.map((line, i) => ci === start.columnIndex && i === 0 ? start.rest : line.text));
    }
    // A shared passage is repeated with every question that refers to it.
    let passageStart: { ci: number; li: number } | undefined;
    for (let ci = 0; ci <= start.columnIndex; ci += 1) {
      columns[ci].lines.forEach((line, li) => {
        if (ci === start.columnIndex && li >= start.lineIndex) return;
        const range = sharedRange(line.text);
        if (range && start.number >= range[0] && start.number <= range[1] && columns[ci].page.page >= columns[start.columnIndex].page.page - 1) passageStart = { ci, li };
      });
    }
    if (passageStart) {
      const passage = passageStart as { ci: number; li: number };
      const first = accepted.find((item) => item.columnIndex > passage.ci || (item.columnIndex === passage.ci && item.lineIndex > passage.li));
      if (first && first.columnIndex <= start.columnIndex) {
        const sharedRegions: LocatedQuestion['regions'] = [];
        const sharedText: string[] = [];
        for (let ci = passage.ci; ci <= first.columnIndex; ci += 1) {
          const column = columns[ci];
          const from = ci === passage.ci ? passage.li : 0;
          const to = ci === first.columnIndex ? first.lineIndex : column.lines.length;
          if (to <= from) continue;
          const top = ci === passage.ci ? Math.max(column.top, column.lines[from].y - 4) : column.top;
          const bottom = ci === first.columnIndex ? first.line.y - 5 : column.bottom;
          sharedRegions.push({ page: column.page.page, box: [column.left / column.page.width, top / column.page.height, (column.right - column.left) / column.page.width, (bottom - top) / column.page.height] });
          sharedText.push(...column.lines.slice(from, to).map((line) => line.text));
        }
        regions.unshift(...sharedRegions);
        text.unshift(...sharedText);
      }
    }
    const warning = next && next.number > start.number + 1 ? `다음 문항 번호가 ${next.number}번으로 이어집니다. 캡처에 누락된 문항이 함께 들어갔는지 확인해 주세요.` : undefined;
    return { number: start.number, page: columns[start.columnIndex].page.page, text: text.join('\n').trim(), regions, warning };
  });
}

function sharedRange(text: string) {
  const match = text.match(/^\s*\[\s*(\d{1,2})\s*[~～∼―–-]\s*(\d{1,2})\s*\]/);
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}
