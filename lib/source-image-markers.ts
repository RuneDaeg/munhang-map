/** Source IDs belong to one question; never resolve them across documents. */
export type SourceImagePart =
  | { kind: 'text'; text: string }
  | { kind: 'image'; id: string; marker: string };

/** Only explicit importer markers are actionable. Unknown prose stays intact. */
export function splitSourceImageMarkers(text: string): SourceImagePart[] {
  const parts: SourceImagePart[] = [];
  const markers = /\[삽입 그림:\s*([A-Za-z0-9_.-]{1,100})\s*\]/g;
  let offset = 0;
  for (const match of text.matchAll(markers)) {
    if (match[1] === '.' || match[1] === '..') continue;
    if (match.index > offset) parts.push({ kind: 'text', text: text.slice(offset, match.index) });
    parts.push({ kind: 'image', id: match[1], marker: match[0] });
    offset = match.index + match[0].length;
  }
  if (offset < text.length || parts.length === 0) parts.push({ kind: 'text', text: text.slice(offset) });
  return parts;
}

export function referencedSourceImageIds(text: string): Set<string> {
  return new Set(splitSourceImageMarkers(text).flatMap(part => part.kind === 'image' ? [part.id] : []));
}
