'use client';

import { memo } from 'react';
import katex from 'katex';
import { normalizeQuestionText, splitMathText } from '../lib/math-normalization';

function MathText({ text, compact = false }: { text: string; compact?: boolean }) {
  const parts = splitMathText(normalizeQuestionText(text));
  const Container = compact ? 'span' : 'div';
  return (
    <Container className={compact ? 'text-inherit' : 'whitespace-pre-wrap text-sm leading-7 text-foreground'}>
      {parts.map((part, index) => {
        if (!part.math) return <span key={index}>{part.text}</span>;
        const { text: expression, display: displayMode } = part;
        const html = katex.renderToString(expression, { displayMode, throwOnError: false, strict: false, trust: false, output: 'html' });
        return displayMode
          ? <span key={`${index}-${expression}`} className="my-2 block overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />
          : <span key={`${index}-${expression}`} dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </Container>
  );
}

export default memo(MathText);
