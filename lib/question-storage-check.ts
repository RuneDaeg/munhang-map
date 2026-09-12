import katex from 'katex';
import { mathForRendering, normalizeQuestionText, splitMathText } from './math-normalization';
import { docxQuestionContent } from './table-export';
import { latexToHwpScript } from './hwpx-math';
import { unformattedText } from './text-formatting';
import { mathQualityIssues } from './math-quality';

/** Same document conversion paths as export; warnings about meaning are not errors. */
export function questionStorageProblem(source: string): string | null {
  if (!source.trim()) return '문항 텍스트가 비어 있습니다.';
  if (source.length > 200000) return '문항 텍스트는 20만 자 이하로 입력해 주세요.';
  const text = normalizeQuestionText(source);
  const syntax = mathQualityIssues(text).find(issue => ['latex_outside_math', 'invalid_control_character'].includes(issue.code));
  if (syntax) return syntax.message;
  try {
    docxQuestionContent(text); // Also traverses nested boxes, table cells and style boundaries.
    for (const part of splitMathText(unformattedText(text))) if (part.math) {
      const expression = mathForRendering(part.text);
      katex.renderToString(expression, { throwOnError: true, strict: 'ignore', trust: false });
      latexToHwpScript(expression);
    }
    return null;
  } catch (reason) {
    return reason instanceof Error ? reason.message.slice(0, 1000) : '수식을 문서로 변환할 수 없습니다.';
  }
}

export function assertQuestionsStorable(questions: Array<{ number: number; text: string }>) {
  const errors = questions.flatMap(q => {
    const error = questionStorageProblem(q.text);
    return error ? [`${q.number}번: ${error}`] : [];
  });
  if (errors.length) throw new Error(`문제함에 저장하지 않았습니다. ${errors.length}문항의 수식·텍스트를 먼저 수정해 주세요.\n${errors.slice(0, 10).join('\n')}${errors.length > 10 ? '\n나머지 오류는 앞의 문항을 수정한 뒤 다시 확인해 주세요.' : ''}`);
}
