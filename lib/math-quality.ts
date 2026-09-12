import katex from 'katex';
import { hasUnbalancedMathDelimiters, mathForRendering, normalizeQuestionText, splitMathText } from './math-normalization';

export type MathIssue = { code: string; message: string };

type Prescript = { atom: string; lower?: string; upper?: string; lowerText?: string; upperText?: string };
type MathNode = { tag: string; children: Array<MathNode | string> };

// KaTeX represents a left index as scripts on an empty mrow immediately before
// the atom. Reading the generated structure accepts either LaTeX script order
// and ignores harmless \mathrm / \text font wrappers, while distinguishing
// {}^{2}_{1}H from 21H, H^{2}_{1}, and swapped/missing indices.
function sourcePrescripts(value: string, right = false): Prescript[] {
  const result: Prescript[] = [];
  const childNodes = (node: MathNode) => node.children.filter((item): item is MathNode => typeof item !== 'string');
  const nodeText = (node: MathNode): string => node.children.map((item) => typeof item === 'string' ? item : nodeText(item)).join('');
  const unwrap = (node: MathNode): MathNode => {
    const items = childNodes(node);
    return ['mrow', 'mstyle'].includes(node.tag) && items.length === 1 ? unwrap(items[0]) : node;
  };
  const indexNumber = (node: MathNode): string | undefined => {
    // Restrict this completeness guard to source-visible numeric isotope
    // indices. Do not flatten compound mathematical expressions into digits.
    if (!['mrow', 'mstyle', 'mi', 'mn', 'mo'].includes(node.tag)) return undefined;
    if (childNodes(node).some((item) => indexNumber(item) === undefined)) return undefined;
    const text = nodeText(node).replace(/\s/g, '').replace(/−/g, '-');
    return /^[+-]?\d+$/.test(text) || text === '+' || text === '-' ? text : undefined;
  };
  const atomText = (node: MathNode): string => {
    node = unwrap(node);
    if (['msub', 'msup', 'msubsup'].includes(node.tag)) return atomText(childNodes(node)[0]);
    if (node.tag === 'mrow') {
      const atoms = childNodes(node).map(atomText);
      return atoms.every(Boolean) ? atoms.join('') : '';
    }
    return ['mi', 'mtext'].includes(node.tag) ? nodeText(node).replace(/\s/g, '') : '';
  };
  function visit(node: MathNode) {
    if (node.tag === 'annotation') return;
    const items = childNodes(node);
    for (let index = 0; index < items.length; index++) {
      const item = unwrap(items[index]);
      if (['msub', 'msup', 'msubsup'].includes(item.tag)) {
        const args = childNodes(item), base = args[0] && unwrap(args[0]);
        if (right && base && atomText(base)) {
          result.push({ atom: atomText(base), lowerText: item.tag === 'msup' ? undefined : nodeText(args[1]).replace(/\s/g, ''), upperText: item.tag === 'msub' ? undefined : nodeText(args.at(-1)!).replace(/\s/g, '') });
        } else if (!right && base?.tag === 'mrow' && !base.children.length && items[index + 1]) {
          const lower = item.tag === 'msup' ? undefined : indexNumber(args[1]);
          const upper = item.tag === 'msub' ? undefined : indexNumber(args.at(-1)!);
          let atom = atomText(items[index + 1]);
          // \mathrm{He} is emitted as two adjacent mi nodes; \text{He} as one.
          if (/^[A-Z]$/.test(atom) && items[index + 2]) {
            const next = atomText(items[index + 2]);
            // The second element letter may itself carry a molecule subscript,
            // e.g. \mathrm{Cl_2}; that is still Cl, not the separate element C.
            if (/^[a-z]$/.test(next)) atom += next;
          }
          if (/^(?:[A-Za-z]{1,2}|[α-ωΑ-Ω])$/.test(atom)) result.push({ atom, lower, upper, lowerText: item.tag === 'msup' ? undefined : nodeText(args[1]).replace(/\s/g, ''), upperText: item.tag === 'msub' ? undefined : nodeText(args.at(-1)!).replace(/\s/g, '') });
        }
      }
      visit(items[index]);
    }
  }
  for (const part of splitMathText(normalizeQuestionText(value).replace(/<\/?[bu]>/g, ''))) {
    if (!part.math || part.text.length > 20_000) continue;
    let markup: string;
    try {
      markup = katex.renderToString(part.text, { output: 'mathml', throwOnError: true, strict: 'ignore', trust: false, maxExpand: 1000, maxSize: 20 });
    } catch { continue; } // An invalid source is not evidence for a preserved index.
    const math = markup.match(/<math\b[^>]*>[\s\S]*?<\/math>/)?.[0];
    if (!math || math.length > 500_000) continue;
    const root: MathNode = { tag: 'root', children: [] }, stack = [root];
    for (const token of math.match(/<[^>]*>|[^<]+/g) ?? []) {
      if (token.startsWith('</')) { stack.pop(); continue; }
      if (token.startsWith('<')) {
        const node: MathNode = { tag: /^<([a-z][a-z0-9]*)/.exec(token)![1], children: [] };
        stack.at(-1)!.children.push(node);
        if (!token.endsWith('/>')) stack.push(node);
      } else stack.at(-1)!.children.push(token);
    }
    visit(root);
  }
  return result;
}

// A nuclear completeness check must not protect malformed general variables as
// isotopes. In particular, {}^{f_1}_{1}f is not source evidence for a nucleus.
const ELEMENTS = new Set('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og n p e α β γ'.split(' '));
function isNuclearPrescript(item: Prescript) {
  return ELEMENTS.has(item.atom) && (item.lower !== undefined || item.upper !== undefined)
    && (item.lowerText === undefined || item.lower !== undefined)
    && (item.upperText === undefined || item.upper !== undefined);
}

/** Reject demonstrable right-to-left movement, not legitimate general tensors. */
export function hasMisplacedSourceScripts(candidate: string, source: string): boolean {
  const existing = sourcePrescripts(source);
  const right = sourcePrescripts(source, true);
  // A name can be both an element and an ordinary variable (F: force, p:
  // momentum). Explicit right-side geometry is stronger evidence than that
  // ambiguous name. Permit repairing an existing right-side nuclear pair only
  // when both original numbers agree and the original stem is clearly nuclear.
  // A newly recovered isotope with no conflicting right index is still allowed.
  const nuclearContext = /핵\s*(?:반응|융합|분열|붕괴)|원자\s*핵|핵종|동위\s*원소|(?:방사성|알파|베타)\s*붕괴/.test(source);
  const numericIndex = (value: string | undefined) => {
    const normalized = value?.replace(/−/g, '-');
    return normalized && /^[+-]?\d+$/.test(normalized) ? normalized : undefined;
  };
  const isSourceNuclearCorrection = (old: Prescript, item: Prescript) => {
    if (!nuclearContext || !isNuclearPrescript(item)) return false;
    const lower = numericIndex(old.lowerText), upper = numericIndex(old.upperText);
    return lower !== undefined && upper !== undefined && lower === item.lower && upper === item.upper;
  };
  return sourcePrescripts(candidate).some((item) => {
    // Retaining an existing general prescript is not a newly introduced change.
    if (existing.some((old) => old.atom === item.atom && old.lowerText === item.lowerText && old.upperText === item.upperText)) return false;
    const duplicatesBase = item.lowerText && item.upperText && (item.upperText === item.atom + item.lowerText || item.lowerText === item.atom + item.upperText);
    const movedRight = right.some((old) => old.atom === item.atom &&
      ((old.lowerText && old.lowerText === item.lowerText) || (old.upperText && old.upperText === item.upperText)) &&
      !isSourceNuclearCorrection(old, item));
    return Boolean(duplicatesBase || movedRight);
  });
}

/** A renderable AI answer must still retain each source isotope's left indices. */
export function hasMissingSourcePrescripts(candidate: string, source: string): boolean {
  const required = sourcePrescripts(source).filter(isNuclearPrescript);
  if (!required.length) return false;
  const available = sourcePrescripts(candidate).filter(isNuclearPrescript);
  // Match the most specific source atoms first when some source indices are
  // only partially visible. Every occurrence needs its own candidate atom.
  required.sort((a, b) => Number(b.lower !== undefined) + Number(b.upper !== undefined) - Number(a.lower !== undefined) - Number(a.upper !== undefined));
  for (const expected of required) {
    const at = available.findIndex((actual) => actual.atom === expected.atom && (expected.lower === undefined || expected.lower === actual.lower) && (expected.upper === undefined || expected.upper === actual.upper));
    if (at < 0) return true;
    available.splice(at, 1);
  }
  return false;
}

/** Syntax/control validation only. A renderable formula can still be wrong. */
export function mathQualityIssues(value: string): MathIssue[] {
  const text=normalizeQuestionText(value);
  const issues:MathIssue[]=[];
  if (sourcePrescripts(text).some((item) => item.lowerText && item.upperText && (item.upperText === item.atom + item.lowerText || item.lowerText === item.atom + item.upperText)))
    issues.push({code:'misplaced_script',message:'일반 변수와 첨자가 왼쪽에 중복 배치되었습니다. 원문의 오른쪽 첨자와 대조해 주세요.'});
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
