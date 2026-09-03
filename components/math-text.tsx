'use client';

import katex from 'katex';

export default function MathText({ text }: { text: string }) {
  const parts = text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g).filter(Boolean);
  return (
    <div className="whitespace-pre-wrap text-sm leading-7 text-foreground">
      {parts.map((part, index) => {
        const displayMode = part.startsWith('$$') && part.endsWith('$$');
        const inlineMode = !displayMode && part.startsWith('$') && part.endsWith('$');
        if (!displayMode && !inlineMode) return <span key={`${index}-${part.slice(0, 8)}`}>{part}</span>;
        const expression = part.slice(displayMode ? 2 : 1, displayMode ? -2 : -1);
        const html = katex.renderToString(expression, { displayMode, throwOnError: false, strict: false, trust: false, output: 'html' });
        return displayMode
          ? <span key={`${index}-${expression}`} className="my-2 block overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />
          : <span key={`${index}-${expression}`} dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </div>
  );
}
