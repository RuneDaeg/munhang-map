import katex from 'katex';
import { hasUnbalancedMathDelimiters, mathForRendering, normalizeQuestionText, splitMathText } from './math-normalization';

export type MathIssue = { code: string; message: string };

/** Syntax/control validation only. A renderable formula can still be wrong. */
export function mathQualityIssues(value: string): MathIssue[] {
  const text=normalizeQuestionText(value);
  const issues:MathIssue[]=[];
  // Newlines and ordinary prose tabs are legitimate; the remaining C0 controls are not.
  // oxlint-disable-next-line no-control-regex -- Detect damaged JSON/LaTeX, not visible glyphs alone.
  if(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text))
    issues.push({code:'invalid_control_character',message:'수식·텍스트에 손상된 제어문자가 있습니다. 원문과 비교해 주세요.'});
  if(hasUnbalancedMathDelimiters(text))
    issues.push({code:'latex_unbalanced',message:'수식 구분자 $의 짝이 맞지 않습니다.'});
  const parts=splitMathText(text.replace(/<\/?[bu]>/g,''));
  if(parts.some(part=>!part.math && /[\^_]\s*\{|\\(?:left|right|begin|end|frac|sqrt|sum|lim)(?![A-Za-z])/.test(part.text)))
    issues.push({code:'latex_outside_math',message:'수식 일부가 수식 영역 밖에 남았습니다. 첨자·괄호와 $ 구분자를 확인해 주세요.'});
  const outsideTables=text.replace(/^:::table[^\n]*\n[\s\S]*?^:::[ \t]*$/gm,'');
  if(/(?:^|\n)[ \t]*\|[ \t]*\|[ \t]*(?:\n|$)/.test(outsideTables))
    issues.push({code:'orphan_absolute_bars',message:'절댓값 막대가 수식과 분리되었을 수 있습니다. 원문과 비교해 주세요.'});
  for(const part of parts) {
    if(!part.math) continue;
    try {
      katex.renderToString(mathForRendering(part.text),{displayMode:part.display,throwOnError:true,strict:false,trust:false,output:'html'});
    } catch {
      issues.push({code:'latex_syntax',message:'표시할 수 없는 LaTeX 수식이 있습니다. 괄호·명령·수식 구분자를 확인해 주세요.'});
      break;
    }
  }
  return issues;
}
