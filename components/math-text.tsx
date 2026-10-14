'use client';

import { memo, useMemo } from 'react';
import katex from 'katex';
import { mathForRendering, normalizeQuestionText, splitMathText } from '../lib/math-normalization';
import { parseQuestionContent, tableColumnWeights } from '../lib/question-content';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { textRuns } from '../lib/text-formatting';
import { readSourceImages } from '../lib/question-context';
import { referencedSourceImageIds, splitSourceImageMarkers } from '../lib/source-image-markers';
import type { AnalyzedQuestion } from '../lib/pdf-analysis';

type SourceImages = NonNullable<AnalyzedQuestion['sourceImages']>;
type ImageMap = ReadonlyMap<string, SourceImages[number]>;

function contentLabel(text: string, images?: ImageMap): string {
  if (images === undefined) return text;
  return splitSourceImageMarkers(text).map(part => part.kind === 'text' ? part.text : images.get(part.id)?.label || `삽입 그림 ${part.id}`).join('');
}

function SourceImage({ id, images }: { id: string; images: ImageMap }) {
  const image = images.get(id);
  if (!image) return <span role="alert" className="inline-block rounded border border-amber-500 bg-amber-50 px-2 py-1 text-sm text-amber-900">삽입 그림 누락: {id} · 원본 파일을 확인하세요.</span>;
  // Only validated local raster data reaches this element. Never send private
  // book illustrations to a remote optimizer or resolve remote/SVG sources.
  return <span className="my-2 inline-block max-w-full align-middle" data-source-image-id={id}>
    {/* oxlint-disable-next-line next/no-img-element */}
    <img src={image.image} alt={image.label || `HWPX 삽입 그림 ${id}`} loading="lazy" className="h-auto max-w-full bg-white object-contain" />
  </span>;
}

function MathParts({ text, underline = false }: { text: string; underline?: boolean }) {
  const parts = splitMathText(normalizeQuestionText(text));
  return (
    <>
      {parts.map((part, index) => {
        if (!part.math) return <span key={index}>{part.text}</span>;
        const { display: displayMode } = part;
        // Exam operators place limits above/below even inside a Korean sentence.
        // KaTeX has no height/depth metrics for these fallback circled labels.
        // Reserve a letter's vertical extent for screen boxes only; the saved
        // formula and native DOCX/HWPX remain unchanged (no phantom content).
        const expression=mathForRendering(part.text).replace(
          /\\boxed\s*\{\s*\\text\s*\{([㉠-㉻ⓐ-ⓩ①-⑳ㄱ-ㅎ])\}\s*\}/g,
          '\\boxed{\\vphantom{Hg}\\text{$1}}',
        );
        const html = katex.renderToString(expression, { displayMode, throwOnError: false, strict: false, trust: false, output: 'html' });
        // Parent text-decoration does not cross KaTeX's inline-block boxes.
        // Give just the expression its own bottom border (not the whole row).
        const rendered = <span className={underline ? 'inline-block border-b border-current' : undefined} dangerouslySetInnerHTML={{ __html: html }} />;
        return displayMode
          ? <span key={`${index}-${expression}`} className="my-2 block overflow-x-auto">{rendered}</span>
          : <span key={`${index}-${expression}`}>{rendered}</span>;
      })}
    </>
  );
}

function InlineMath({ text, images }: { text: string; images?: ImageMap }) {
  return <>{textRuns(text).map((run,index)=>{
    let content=images === undefined ? <MathParts text={run.text} underline={run.underline}/> : <>{splitSourceImageMarkers(run.text).map((part, partIndex) => part.kind === 'image'
      ? <SourceImage key={partIndex} id={part.id} images={images} />
      : <MathParts key={partIndex} text={part.text} underline={run.underline} />)}</>;
    if(run.underline) content=<u>{content}</u>;
    if(run.bold) content=<strong>{content}</strong>;
    return <span key={index}>{content}</span>;
  })}</>;
}

function ContentBlocks({ text, compact, images }: { text: string; compact: boolean; images?: ImageMap }) {
  // Compact changes spacing only: list and inspector share the same structure.
  return <div className={`min-w-0 whitespace-pre-wrap ${compact ? 'text-inherit leading-6' : 'text-sm leading-7 text-foreground'}`}>
    {parseQuestionContent(text).map((block, index) => {
      if (block.kind === 'text') return <div key={index}><InlineMath text={block.text} images={images} /></div>;
      if (block.kind === 'box') return <section key={index} className={`min-w-0 border border-foreground/60 ${compact ? 'my-3 px-3 py-2' : 'my-4 px-4 py-3'}`} aria-label={contentLabel(block.title, images) || '자료 상자'}>
        {block.title && <p className="mb-2 text-center font-semibold"><InlineMath text={block.title} images={images} /></p>}
        {block.text.includes(':::') ? <ContentBlocks text={block.text} compact={compact} images={images} /> : <InlineMath text={block.text} images={images} />}
      </section>;
      const weights = tableColumnWeights(block.rows);
      const total = weights.reduce((sum, width) => sum + width, 0);
      const renderRow = (row: string[], rowIndex: number, header = false) => <TableRow key={rowIndex}>
        {row.map((cell, col) => {
          const Cell = header ? TableHead : TableCell;
          return <Cell key={col} scope={header ? 'col' : undefined} className="h-auto whitespace-pre-wrap break-words border border-foreground/40 px-3 py-2 align-middle"><InlineMath text={cell} images={images} /></Cell>;
        })}
      </TableRow>;
      return <div key={index} className="my-4 min-w-0">
        {weights.length>3 && <p className="mb-1 text-xs text-muted-foreground">넓은 표는 좌우로 스크롤해 확인하세요.</p>}
        <Table className="table-fixed border-collapse" style={{minWidth:weights.length>3?Math.ceil(total*13):undefined}} tabIndex={weights.length>3?0:undefined} aria-label={contentLabel(block.title || '', images) || '문항 자료표'}>
          {block.title && <caption className="caption-top mb-2 text-center font-semibold"><InlineMath text={block.title} images={images} /></caption>}
          <colgroup>{weights.map((weight, col) => <col key={col} style={{ width: `${weight / total * 100}%` }} />)}</colgroup>
          {block.header && <TableHeader className="bg-muted">{renderRow(block.rows[0], 0, true)}</TableHeader>}
          <TableBody>{block.rows.slice(block.header ? 1 : 0).map((row, i) => renderRow(row, i))}</TableBody>
        </Table>
      </div>;
    })}
  </div>;
}

function MathText({ text, compact = false, sourceImages }: { text: string; compact?: boolean; sourceImages?: SourceImages }) {
  const sources = useMemo(() => {
    if (sourceImages === undefined) return undefined;
    try { return { images: new Map(readSourceImages(sourceImages).map(image => [image.id, image])), invalid: false }; }
    catch { return { images: new Map<string, SourceImages[number]>(), invalid: true }; }
  }, [sourceImages]);
  const referenced = useMemo(() => sources ? referencedSourceImageIds(text) : new Set<string>(), [sources, text]);
  return <>
    {sources?.invalid && <p role="alert" className="mb-2 rounded border border-amber-500 bg-amber-50 px-2 py-1 text-sm text-amber-900">삽입 그림 데이터가 올바르지 않아 표시하지 않았습니다. 원본 파일을 다시 불러와 주세요.</p>}
    <ContentBlocks text={text} compact={compact} images={sources?.images} />
    {sources && [...sources.images.values()].filter(image => !referenced.has(image.id)).map(image => <figure key={image.id} className="my-3 min-w-0 rounded border border-amber-500 p-2">
      <figcaption className="text-xs text-amber-900">위치 미지정 삽입 그림 · {image.label || image.id} · 본문에 [삽입 그림: {image.id}] 표식을 넣으면 그 위치에 표시됩니다.</figcaption>
      <SourceImage id={image.id} images={sources.images} />
    </figure>)}
  </>;
}

export default memo(MathText);
