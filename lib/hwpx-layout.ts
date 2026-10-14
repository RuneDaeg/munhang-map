/** Presentation-only normalization. The original cells/spans/runs stay intact. */
type LayoutCell = {
  row: number; column: number; rowSpan: number; colSpan: number;
  text: string; plainText: string;
  borders?: { left: boolean; right: boolean; top: boolean; bottom: boolean };
  blocks: Array<{ kind: string }>;
};

export function hwpxViewBox(cells: LayoutCell[]): { title: string; text: string } | undefined {
  const populated = cells.filter((cell) => cell.plainText.trim());
  const titles = populated.filter((cell) => /^[<〈＜[]\s*보\s*기\s*[>〉＞\]]$/.test(cell.plainText.trim()));
  if (titles.length !== 1) return;
  const title = titles[0], body = populated.filter((cell) => cell !== title)
    .sort((a, b) => a.row - b.row || a.column - b.column);
  // Never flatten a data grid, multiple text columns, or an embedded data table.
  if (!body.length || body.some((cell) => cell.row < title.row + title.rowSpan
    || cell.blocks.some((block) => block.kind !== 'paragraph'))) return;
  const first = body[0];
  if (body.some((cell, index) => cell.column !== first.column || cell.colSpan !== first.colSpan
    || (index > 0 && cell.row < body[index - 1].row + body[index - 1].rowSpan))) return;
  // Only known invisible borders establish that these are layout cells. Missing
  // style data is not evidence of an invisible divider. This also excludes a
  // real multi-row data table which happens to have a <보기> caption.
  if (![title, ...body].every((cell) => cell.borders
    && !cell.borders.left && !cell.borders.right && !cell.borders.top && !cell.borders.bottom)) return;
  const text = body.map((cell) => cell.text.trim()).filter(Boolean).join('\n');
  if (!text || /(?:^|\n)\s*:::/m.test(text)) return;
  return { title: '<보기>', text };
}
