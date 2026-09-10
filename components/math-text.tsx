'use client';

import { memo } from 'react';
import katex from 'katex';
import { normalizeQuestionText, splitMathText } from '../lib/math-normalization';
import { parseQuestionContent, questionPlainText, tableColumnWeights } from '../lib/question-content';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { textRuns } from '../lib/text-formatting';

function MathParts({ text }: { text: string }) {
  const parts = splitMathText(normalizeQuestionText(text));
  return (
    <>
      {parts.map((part, index) => {
        if (!part.math) return <span key={index}>{part.text}</span>;
        const { text: expression, display: displayMode } = part;
        const html = katex.renderToString(expression, { displayMode, throwOnError: false, strict: false, trust: false, output: 'html' });
        return displayMode
          ? <span key={`${index}-${expression}`} className="my-2 block overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />
          : <span key={`${index}-${expression}`} dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </>
  );
}

function InlineMath({ text }: { text: string }) {
  return <>{textRuns(text).map((run,index)=>{
    let content=<MathParts text={run.text}/>;
    if(run.underline) content=<u>{content}</u>;
    if(run.bold) content=<strong>{content}</strong>;
    return <span key={index}>{content}</span>;
  })}</>;
}

function MathText({ text, compact = false }: { text: string; compact?: boolean }) {
  if (compact) return <span className="whitespace-pre-line text-inherit"><InlineMath text={questionPlainText(text)} /></span>;
  return <div className="whitespace-pre-wrap text-sm leading-7 text-foreground">
    {parseQuestionContent(text).map((block, index) => {
      if (block.kind === 'text') return <div key={index}><InlineMath text={block.text} /></div>;
      if (block.kind === 'box') return <section key={index} className="my-4 min-w-0 border border-foreground/60 px-4 py-3" aria-label={block.title || '자료 상자'}>
        {block.title && <p className="mb-2 text-center font-semibold"><InlineMath text={block.title} /></p>}
        {block.text.includes(':::') ? <MathText text={block.text} /> : <InlineMath text={block.text} />}
      </section>;
      const weights = tableColumnWeights(block.rows);
      const total = weights.reduce((sum, width) => sum + width, 0);
      const renderRow = (row: string[], rowIndex: number, header = false) => <TableRow key={rowIndex}>
        {row.map((cell, col) => {
          const Cell = header ? TableHead : TableCell;
          return <Cell key={col} scope={header ? 'col' : undefined} className="h-auto whitespace-pre-wrap break-words border border-foreground/40 px-3 py-2 align-middle"><InlineMath text={cell} /></Cell>;
        })}
      </TableRow>;
      return <div key={index} className="my-4 min-w-0">
        {weights.length>3 && <p className="mb-1 text-xs text-muted-foreground">넓은 표는 좌우로 스크롤해 확인하세요.</p>}
        <Table className="table-fixed border-collapse" style={{minWidth:weights.length>3?Math.ceil(total*13):undefined}} tabIndex={weights.length>3?0:undefined} aria-label={block.title || '문항 자료표'}>
          {block.title && <caption className="caption-top mb-2 text-center font-semibold"><InlineMath text={block.title} /></caption>}
          <colgroup>{weights.map((weight, col) => <col key={col} style={{ width: `${weight / total * 100}%` }} />)}</colgroup>
          {block.header && <TableHeader className="bg-muted">{renderRow(block.rows[0], 0, true)}</TableHeader>}
          <TableBody>{block.rows.slice(block.header ? 1 : 0).map((row, i) => renderRow(row, i))}</TableBody>
        </Table>
      </div>;
    })}
  </div>;
}

export default memo(MathText);
