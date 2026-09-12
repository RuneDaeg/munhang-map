// Geometry reconstruction for verified equation glyphs and positioned operands.
// No OCR guesses. An orphan fraction bar is retained and reported, not changed to '-'.
import type { PageText } from './pdf-layout';
import type { Rule } from './pdf-structures';
type Run = PageText & {
  id: number;
  baseline: number;
  equation: boolean;
  sourceIds: number[];
  latex?: string;
  vectorSource?: boolean;
  sourceFontName?: string;
  // Literal text with only source-verified font commands. Keep it separate from
  // reconstructed latex so atom geometry and index ownership remain unchanged.
  sourceMathLatex?: string;
};
type MathWarning = {
  kind: string;
  sourceIds: number[];
  role?: string;
  x: number;
  y: number;
};
type MathEvent = { kind: string; sourceIds: number[]; latex: string };
export function reconstructMathRuns(input: PageText[], rules: Rule[] = []) {
  const items: Run[] = input.map((r, id) => ({
    ...r,
    id,
    baseline: r.baseline ?? r.y + r.height,
    equation: !!r.equation,
    sourceIds: [id],
    latex: r.equation && /^(?:sin|cos|tan|log|ln)$/.test(r.text) ? `\\${r.text}` : undefined,
  }));
  const removed = new Set<number>(),
    warnings: MathWarning[] = [],
    events: MathEvent[] = [];
  const baseOf = (r: Run) => r.baseline;
  const right = (r: Run) => r.x + r.width;
  const bar = (r: Run) => r.mathRole === 'fractionBar';
  const radical = (r: Run) => r.mathRole === 'radical';
  const active = () => items.filter((r) => !removed.has(r.id));
  const across = (a: Run, b: Run) =>
    rules.some(
      (r) =>
        Math.abs(r.x1 - r.x2) < 0.5 &&
        r.x1 > Math.min(right(a), right(b)) - 0.1 &&
        r.x1 < Math.max(a.x, b.x) + 0.1 &&
        Math.max(r.y1, r.y2) > Math.min(a.y, b.y) &&
        Math.min(r.y1, r.y2) < Math.max(baseOf(a), baseOf(b)),
    );
  const escapeAtom = (s: string) =>
    s.replace(/[\u005c$%#&_{}]/g, (c) =>
      c === '\\' ? '\\backslash{}' : `\\${c}`,
    );
  const expr = (r: Run): string => r.latex ?? r.sourceMathLatex ?? (/^[\u2160-\u217f]+$/u.test(r.text)
    ? `\\mathrm{${r.text.normalize('NFKC')}}`
    : /[가-힣]/u.test(r.text)
    ? `\\text{${escapeAtom(r.text)}}`
    : !r.equation && r.sourceFontName && !/italic|oblique/i.test(r.sourceFontName) && /[A-Za-z]/.test(r.text)
      ? r.text.split(/([A-Za-z]+)/).map(part => /^[A-Za-z]+$/.test(part) ? `\\mathrm{${part}}` : escapeAtom(part)).join('')
      : escapeAtom(r.text));
  const words = (list: Run[]) =>
    list
      .sort((a, b) => a.x - b.x)
      .map(
        (r, i, a) =>
          `${i && r.x - right(a[i - 1]) > Math.min(r.height, a[i - 1].height) * 0.26 ? ' ' : ''}${expr(r)}`,
      )
      .join('');
  const fold = (
    target: Run,
    members: Run[],
    latex: string,
    baseline: number,
    height: number,
  ) => {
    const all = [target, ...members];
    const x = Math.min(...all.map((r) => r.x)),
      end = Math.max(...all.map(right));
    const bounds = all.map(
      (r) =>
        r.sourceBounds ?? { x: r.x, y: r.y, width: r.width, height: r.height },
    );
    const sourceX = Math.min(...bounds.map((r) => r.x)),
      sourceY = Math.min(...bounds.map((r) => r.y));
    target.sourceBounds = {
      x: sourceX,
      y: sourceY,
      width: Math.max(...bounds.map((r) => r.x + r.width)) - sourceX,
      height: Math.max(...bounds.map((r) => r.y + r.height)) - sourceY,
    };
    target.sourceIds = all.flatMap((r) => r.sourceIds);
    target.x = x;
    target.width = end - x;
    target.baseline = baseline;
    target.height = height;
    target.y = baseline - height;
    target.text = latex;
    target.latex = latex;
    target.equation = true;
    for (const r of members) removed.add(r.id);
    delete target.mathRole;
    return target;
  };

  // Vector-stroke fraction bars are also common (e.g. chemistry q20).
  // Require compact math-containing operands on BOTH sides and reject any
  // junction with a vertical rule: a table border must never become division.
  const virtualBars: Array<{ x: number; end: number; y: number }> = [];
  for (const rule of rules) {
    if (Math.abs(rule.y1 - rule.y2) > 0.4) continue;
    const x = Math.min(rule.x1, rule.x2),
      end = Math.max(rule.x1, rule.x2),
      y = rule.y1;
    if (end - x < 3 || end - x > 240) continue;
    if (
      virtualBars.some(
        (bar) =>
          Math.abs(bar.x - x) < 0.5 &&
          Math.abs(bar.end - end) < 0.5 &&
          Math.abs(bar.y - y) < 0.5,
      )
    )
      continue;
    if (
      rules.some(
        (r) =>
          Math.abs(r.x1 - r.x2) < 0.5 &&
          r.x1 >= x - 0.7 &&
          r.x1 <= end + 0.7 &&
          Math.min(r.y1, r.y2) <= y + 0.7 &&
          Math.max(r.y1, r.y2) >= y - 0.7,
      )
    )
      continue;
    const near = items.filter(
      (r) =>
        r.x >= x - r.height * 0.22 &&
        right(r) <= end + r.height * 0.22 &&
        r.height >= 4 &&
        r.height <= 12 &&
        !bar(r) &&
        !radical(r),
    );
    const aRaw = near.filter(
      (r) => baseOf(r) < y && baseOf(r) > y - r.height * 0.62,
    );
    const dRaw = near.filter(
      (r) => baseOf(r) > y + r.height * 0.65 && baseOf(r) < y + r.height * 1.4,
    );
    const mainSize = (row: Run[]) => row.filter(r => r.height >= Math.max(...row.map(a => a.height)) * 0.82);
    const a = mainSize(aRaw), d = mainSize(dRaw);
    // Scientific prose and numeric choices are often in ordinary body fonts,
    // not the equation font. The two compact, vertically stacked rows and the
    // explicit stroke are the evidence of division, not a font-family guess.
    const operand = (row: Run[]) => row.length && row.some(r => /[\p{L}\p{N}]/u.test(r.text)) &&
      row.every(r => !/[①-⑤]|^\d+\.$/.test(r.text));
    if (!operand(a) || !operand(d)) continue;
    const h = [...a, ...d].map((r) => r.height).sort((a, b) => a - b)[
      Math.floor((a.length + d.length) / 2)
    ];
    // An underline plus the next prose line can imitate stacked operands.
    // Division must consume complete local rows: never cut a continuous
    // sentence at the stroke's edge or detach its immediately adjacent words.
    // Underline metadata alone is not sufficient here, since an actual
    // word-fraction numerator can also have been tagged as underlined.
    const cutsContinuousRow = (row: Run[]) => {
      const start = Math.min(...row.map(r => r.x)), finish = Math.max(...row.map(right));
      return items.some(r => !row.includes(r) && !bar(r) && !radical(r) &&
        r.height >= h * 0.82 && Math.abs(baseOf(r) - baseOf(row[0])) < h * 0.2 &&
        ((r.x < x - h * 0.3 && right(r) > x + h * 0.3) ||
          (r.x < end - h * 0.3 && right(r) > end + h * 0.3) ||
          (r.x - finish >= -h * 0.25 && r.x - finish < h * 0.9) ||
          (start - right(r) >= -h * 0.25 && start - right(r) < h * 0.9)));
    };
    if (cutsContinuousRow(a) || cutsContinuousRow(d)) continue;
    if (
      Math.abs(
        Math.min(...a.map((r) => baseOf(r))) -
          Math.max(...a.map((r) => baseOf(r))),
      ) >
        h * 0.2 ||
      Math.abs(
        Math.min(...d.map((r) => baseOf(r))) -
          Math.max(...d.map((r) => baseOf(r))),
      ) >
        h * 0.2
    )
      continue;
    const baseline = y + h * 0.76;
    virtualBars.push({ x, end, y });
    items.push({
      id: items.length,
      text: '─',
      x,
      y: baseline - h,
      baseline,
      width: end - x,
      height: h,
      equation: true,
      mathRole: 'fractionBar',
      sourceIds: [],
      vectorSource: true,
    });
  }

  // Pair only explicit radical outlines with the adjacent roof. The roof is
  // reserved before fraction parsing so it cannot become a spurious numerator.
  const roofFor = new Map<number, Run>(),
    roofs = new Set<number>();
  // A verified arrowhead beside a short upper stroke is a vector accent, not
  // a fraction numerator. Reserve it until its base's right indices are built.
  const vectorPairs = new Map<number, Run>();
  for (const head of items.filter(r => r.mathRole === 'vectorArrow')) {
    const stems = items.filter(r => bar(r) &&
      Math.abs(baseOf(r) - baseOf(head)) < head.height * 0.12 &&
      head.x >= r.x && head.x <= right(r) + head.height * 0.15 &&
      right(r) - head.x < head.height * 0.4 && !across(r, head));
    if (stems.length === 1) {
      vectorPairs.set(stems[0].id, head);
      roofs.add(stems[0].id);
    }
  }
  for (const root of items.filter(radical)) {
    const candidates = items.filter(
      (r) =>
        bar(r) &&
        Math.abs(r.x - right(root)) < root.height * 0.18 &&
        baseOf(root) - baseOf(r) > root.height * 0.1 &&
        baseOf(root) - baseOf(r) < root.height * 0.75 &&
        r.width > root.width * 0.6 &&
        !across(root, r),
    );
    if (candidates.length === 1) {
      roofFor.set(root.id, candidates[0]);
      roofs.add(candidates[0].id);
    }
  }

  // A segment accent has contiguous capitals below it and no math numerator.
  // Prose punctuation on the preceding line cannot become a numerator.
  for (const line of active().filter((r) => bar(r) && !roofs.has(r.id))) {
    const h = line.height;
    const contained = active().filter((r) => r.id !== line.id &&
      r.x >= line.x - h * 0.1 && right(r) <= right(line) + h * 0.1 && !across(line, r));
    const letters = contained.filter((r) => r.equation && /^[A-Z]+$/.test(r.text) &&
      Math.abs(r.height - h) < h * 0.2 &&
      baseOf(r) - baseOf(line) >= h * 0.18 && baseOf(r) - baseOf(line) <= h * 0.5);
    const numerator = contained.some((r) => r.equation && !bar(r) &&
      baseOf(r) - baseOf(line) >= -h * 1.6 && baseOf(r) - baseOf(line) <= -h * 0.55);
    if (!letters.length || numerator) continue;
    letters.sort((a,b) => a.x-b.x);
    if (letters.some((r,i) => i && r.x-right(letters[i-1]) > h * 0.2) ||
      Math.abs(letters[0].x-line.x) > h * 0.12 || Math.abs(right(letters[letters.length-1])-right(line)) > h * 0.15) continue;
    const latex = `\\overline{${words(letters)}}`;
    fold(line, letters, latex, Math.max(...letters.map(baseOf)), h);
    events.push({kind:'overline',sourceIds:line.sourceIds,latex});
  }

  // These annotations are centered on operators, not right-hand scripts.
  for (const op of active().filter((r) => r.equation && /^(?:lim|Σ|∑)$/.test(r.text))) {
    const isLimit = op.text === 'lim', h = op.height;
    const nearby = active().filter((r) => r.id !== op.id && r.equation &&
      !bar(r) && !radical(r) && r.height >= h * 0.25 && r.height <= h * (isLimit ? 0.75 : 0.55) &&
      r.x >= op.x - h * 0.55 && right(r) <= right(op) + h * 0.55 && !across(op,r));
    const row = (above: boolean) => {
      const list = nearby.filter((r) => {
        const delta = baseOf(r)-baseOf(op);
        return above ? delta < -h * 0.5 && delta > -h * 1.2 : delta > h * 0.2 && delta < h * 0.9;
      }).sort((a,b)=>a.x-b.x);
      if (!list.length || list.some((r) => Math.abs(baseOf(r)-baseOf(list[0])) > list[0].height * 0.2) ||
        list.some((r,i) => i && r.x-right(list[i-1]) > list[0].height * 0.4)) return [];
      return list;
    };
    const lower = row(false), upper = isLimit ? [] : row(true);
    if (!lower.length || (isLimit ? !lower.some((r)=>r.text === '→') : !lower.some((r)=>r.text === '='))) continue;
    const latex = `${isLimit ? '\\lim' : '\\sum'}_{${words(lower)}}${upper.length ? `^{${words(upper)}}` : ''}`;
    const textHeight = isLimit ? h / 1.2 : h / 1.8;
    const baseline = baseOf(op) - (isLimit ? textHeight * 0.1 : textHeight * 0.28);
    fold(op,[...lower,...upper],latex,baseline,textHeight);
    events.push({kind:'operatorLimits',sourceIds:op.sourceIds,latex});
  }

  // Operands enclosed by a bar cannot escape as scripts of an outside base.
  const operandOwners = (atom: Run) => active().filter((line) => bar(line) && !roofs.has(line.id) &&
    atom.x >= line.x-line.height*0.2 && right(atom) <= right(line)+line.height*0.4 &&
    baseOf(atom)-baseOf(line) >= -line.height*1.8 && baseOf(atom)-baseOf(line) <= line.height*0.9)
    .map((line)=>`${line.id}:${baseOf(atom)<baseOf(line)-line.height*0.3 ? 'above' : 'below'}`).sort().join(',');
  const sameScriptContainer = (a: Run, b: Run) =>
    operandOwners(a).replace(/:(?:above|below)/g, '') === operandOwners(b).replace(/:(?:above|below)/g, '');

  const atomicText = /^[A-Za-z\u0370-\u03ff][A-Za-z\u0370-\u03ff0-9]*$/u;
  const scriptText = /^[A-Za-z\u0370-\u03ff\u2160-\u217f0-9+＋−*′'\s-]+$/u;
  // A source run may already contain an operator or a decimal coefficient.
  // Its right script belongs to the final atom, never to a guessed new base.
  const plainBase = (r: Run) => !r.latex && !bar(r) && !radical(r) &&
    r.mathRole !== 'vectorArrow' && (r.equation
      ? /^[A-Za-z\u0370-\u03ff0-9.,+−×÷/<>=→←↔⇌()[\]\s-]*[A-Za-z\u0370-\u03ff0-9]$/u.test(r.text) && r.text !== 'lim'
      : atomicText.test(r.text) || /^\d+(?:\.\d+)?$/.test(r.text) || /^,?\s*[A-Za-z]+(?:,\s*[A-Za-z]+)+$/.test(r.text) ||
        (/^[가-힣]{1,8}$/u.test(r.text) && !!operandOwners(r)));
  const elementSymbols = new Set(('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og').split(' '));

  // Nuclear left indices require BOTH a superscript and a subscript; isolated
  // small labels to the left never get interpreted as a nuclide automatically.
  // A PDF text run may include the following reaction operator ("He +", "H →").
  // Prefix its leading element without inventing per-glyph widths or moving
  // the operator into the nucleus. A coefficient or word is not an element.
  const leftScriptBase = (r: Run) => r.equation && !bar(r) && !radical(r) &&
    /^[A-Z][a-z]?(?:$|\s*(?=[+−\-→←↔⇌=]))/.test(r.text) &&
    elementSymbols.has(r.text.match(/^[A-Z][a-z]?/)![0]);
  const horizontalScriptBorder = (a: Run, b: Run) => rules.some((line) =>
    Math.abs(line.y1 - line.y2) < 0.5 &&
    Math.min(line.x1, line.x2) < Math.max(right(a), right(b)) &&
    Math.max(line.x1, line.x2) > Math.min(a.x, b.x) &&
    line.y1 > Math.min(a.y + a.height / 2, b.y + b.height / 2) &&
    line.y1 < Math.max(a.y + a.height / 2, b.y + b.height / 2));
  for (const base of items.filter(
    leftScriptBase,
  )) {
    const possible = active().filter(
      (r) =>
        r.id !== base.id &&
        r.equation && !r.latex &&
        /^[0-9]+$/.test(r.text) &&
        r.height <= base.height * 0.82 &&
        r.height >= base.height * 0.45 &&
        base.x - right(r) >= -base.height * 0.1 &&
        base.x - right(r) <= base.height * 0.75 &&
        !across(r, base) && !horizontalScriptBorder(r, base) &&
        operandOwners(r) === operandOwners(base),
    );
    const sup = possible.filter(
      (r) =>
        baseOf(base) - baseOf(r) > base.height * 0.18 &&
        baseOf(base) - baseOf(r) < base.height * 0.7,
    );
    const sub = possible.filter(
      (r) =>
        baseOf(r) - baseOf(base) > base.height * 0.13 &&
        baseOf(r) - baseOf(base) < base.height * 0.65,
    );
    if (!sup.length || !sub.length) continue;
    const nearest = Math.min(
      ...sup.map((r) => Math.abs(base.x - right(r))),
      ...sub.map((r) => Math.abs(base.x - right(r))),
    );
    const s1 = sup.filter(
        (r) => base.x - right(r) <= nearest + base.height * 0.6,
      ),
      s2 = sub.filter((r) => base.x - right(r) <= nearest + base.height * 0.6);
    if (
      Math.abs(Math.max(...s1.map(right)) - Math.max(...s2.map(right))) >
      base.height * 0.3
    )
      continue;
    // Both rows must describe one compact index column. Nearby table values
    // or another expression's right-hand scripts must not become left indices.
    const coherentRow = (row: Run[]) => {
      const sorted = [...row].sort((a, b) => a.x - b.x);
      return sorted.every((r, i) =>
        Math.abs(r.height - sorted[0].height) < sorted[0].height * 0.16 &&
        Math.abs(baseOf(r) - baseOf(sorted[0])) < sorted[0].height * 0.18 &&
        (!i || (r.x - right(sorted[i - 1]) >= -r.height * 0.1 &&
          r.x - right(sorted[i - 1]) <= r.height * 0.35)));
    };
    if (!coherentRow(s1) || !coherentRow(s2)) continue;
    const previousOwns = [...s1, ...s2].some((s) => active().some((b) =>
      b.id !== base.id && b.id !== s.id && b.equation && !b.latex &&
      /^[A-Za-z0-9]+$/.test(b.text) && b.text !== 'lim' &&
      s.height <= b.height * 0.82 && s.height >= b.height * 0.4 &&
      s.x - right(b) >= -b.height * 0.22 && s.x - right(b) <= b.height * 0.28 &&
      Math.abs(baseOf(s) - baseOf(b)) >= b.height * 0.18 &&
      Math.abs(baseOf(s) - baseOf(b)) <= b.height * 0.7 &&
      Math.abs(s.x - right(b)) <= Math.abs(base.x - right(s)) &&
      !across(b, s) && operandOwners(b) === operandOwners(s)));
    if (previousOwns) continue;
    const latex = `{}^{${words(s1)}}_{${words(s2)}}${expr(base)}`;
    fold(base, [...s1, ...s2], latex, baseOf(base), base.height);
    events.push({ kind: 'leftScripts', sourceIds: base.sourceIds, latex });
  }

  // Mass-only isotope notation (e.g. labelled oxygen) has no atomic-number
  // row. Require a real element, an adjacent raised integer, and nearby source
  // language identifying atomic/isotopic material. Ordinary f_1 and detached
  // numbers cannot enter this path. This is geometric attachment, not a
  // periodic-table guess of a missing mass or charge.
  for (const base of active().filter(r => !r.latex && elementSymbols.has(r.text))) {
    const context = input.some(r => /동위\s*원소|질량수|원자|핵반응|중성자|양성자/.test(r.text) &&
      Math.abs((r.baseline ?? r.y + r.height) - baseOf(base)) < base.height * 24 &&
      r.x < right(base) + base.height * 18 && r.x + r.width > base.x - base.height * 18);
    if (!context) continue;
    const candidates = active().filter(r => r.id !== base.id && !r.latex && /^\d+$/.test(r.text) &&
      r.height <= base.height * 0.82 && r.height >= base.height * 0.45 &&
      base.x - right(r) >= -base.height * 0.12 && base.x - right(r) <= base.height * 0.2 &&
      baseOf(base) - baseOf(r) > base.height * 0.23 && baseOf(base) - baseOf(r) < base.height * 0.7 &&
      !across(r, base) && !horizontalScriptBorder(r, base) && operandOwners(r) === operandOwners(base));
    if (candidates.length !== 1) continue;
    const mass = candidates[0];
    const prior = active().some(r => r.id !== base.id && r.id !== mass.id && plainBase(r) &&
      Math.abs(baseOf(r) - baseOf(base)) < base.height * 0.16 &&
      mass.x - right(r) >= -base.height * 0.12 && mass.x - right(r) <= base.height * 0.28 &&
      Math.abs(mass.x - right(r)) < Math.abs(base.x - right(mass)));
    if (prior) continue;
    const latex = `{}^{${expr(mass)}}${expr(base)}`;
    fold(base, [mass], latex, baseOf(base), base.height);
    events.push({ kind: 'isotopeMass', sourceIds: base.sourceIds, latex });
  }

  // Attach smaller right-hand runs to the closest eligible math base. Work on
  // base+script relations before joining baseline runs, preserving CH3OH order.
  // Keep occupied slots separately from LaTeX: a nested power inside a fraction
  // does not occupy the fraction's own superscript slot. Folding also expands
  // the base's bounds, so the second pass must not append another superscript
  // merely because a detached glyph is now close to that expanded edge.
  const rightScriptSlots = new Map<number, { sup: boolean; sub: boolean }>();
  const attachScripts = (compounds = false) => {
  const attachments = new Map<number, { base: Run; sup: Run[]; sub: Run[] }>();
  for (const s of active()) {
    if (bar(s) || radical(s) || s.mathRole === 'vectorArrow' || (s.latex ? !compounds : !scriptText.test(s.text)))
      continue;
    const candidates = active()
      .filter(
        (b) =>
          b.id !== s.id &&
          !bar(b) &&
          !radical(b) &&
          s.height <= b.height * 0.82 &&
          s.height >= b.height * 0.4 &&
          (b.latex ? compounds && !/^\\(?:lim|sum)/.test(b.latex) : plainBase(b)) &&
          s.x - right(b) >= -b.height * 0.22 &&
          s.x - right(b) <= b.height * 0.28 &&
          !across(b, s) && sameScriptContainer(b, s),
      )
      .map((b) => ({ b, delta: baseOf(s) - baseOf(b) }))
      .filter(
        ({ b, delta }) =>
          !rightScriptSlots.get(b.id)?.[delta < 0 ? 'sup' : 'sub'] &&
          Math.abs(delta) >= b.height * (b.equation && delta < 0 ? 0.18 : 0.08) &&
          Math.abs(delta) <= b.height * (s.latex ? 1.3 : 0.7),
      )
      .sort((a, b) => Math.abs(s.x - right(a.b)) - Math.abs(s.x - right(b.b)));
    if (!candidates.length) continue;
    if (
      candidates[1] &&
      Math.abs(
        Math.abs(s.x - right(candidates[0].b)) -
          Math.abs(s.x - right(candidates[1].b)),
      ) < 0.1
    )
      continue;
    const { b, delta } = candidates[0];
    if (!attachments.has(b.id))
      attachments.set(b.id, { base: b, sup: [], sub: [] });
    attachments.get(b.id)![delta < 0 ? 'sup' : 'sub'].push(s);
  }
  // Resolve inner scripts before their parent consumes the same run. PDF text
  // order can be reversed and is not a reliable nesting order.
  for (const { base, sup, sub } of [...attachments.values()].sort((a, b) => a.base.height - b.base.height)) {
    if (removed.has(base.id)) continue;
    // Charge/index runs can contain multiple glyphs, e.g. Y^{2−}. Only expand
    // from an already anchored script along its own small-font baseline.
    for (const group of [sup, sub]) {
      if (!group.length) continue;
      for (;;) {
        const last = group.reduce((a, b) => (right(a) > right(b) ? a : b));
        const next = active()
          .filter(
            (r) =>
              !group.includes(r) &&
              r.id !== base.id &&
              r.equation === last.equation &&
              !r.latex &&
              scriptText.test(r.text) &&
              Math.abs(r.height - last.height) < last.height * 0.16 &&
              Math.abs(baseOf(r) - baseOf(last)) < last.height * 0.18 &&
              r.x - right(last) >= -last.height * 0.1 &&
              // Use the same local-row tolerance as baseline composition;
              // signed exponents have wider spacing after the sign glyph.
              r.x - right(last) <= last.height * 0.35 &&
              right(r) - base.x < base.height * 2.5 &&
              !across(last, r) && operandOwners(last) === operandOwners(r),
          )
          .sort((a, b) => a.x - b.x)[0];
        if (!next) break;
        if (
          Array.from(attachments.values()).some(
            (a) =>
              a.base.id !== base.id &&
              (a.sup.includes(next) || a.sub.includes(next)),
          )
        )
          break;
        group.push(next);
      }
    }
    const eligible = [...sup, ...sub].filter((r) => !removed.has(r.id));
    if (!eligible.length) continue;
    const s1 = sup.filter((r) => !removed.has(r.id)),
      s2 = sub.filter((r) => !removed.has(r.id));
    const scriptWords = (group: Run[]) => group.sort((a, b) => a.x - b.x).map(expr).join('');
    const latex = `${expr(base)}${s1.length ? `^{${scriptWords(s1)}}` : ''}${s2.length ? `_{${scriptWords(s2)}}` : ''}`;
    fold(base, eligible, latex, baseOf(base), base.height);
    const occupied = rightScriptSlots.get(base.id);
    rightScriptSlots.set(base.id, {
      sup: !!s1.length || !!occupied?.sup,
      sub: !!s2.length || !!occupied?.sub,
    });
    events.push({ kind: 'rightScripts', sourceIds: base.sourceIds, latex });
  }
  };
  attachScripts();
  attachScripts(true);

  const reduceRadicals = () => {
  for (const root of items.filter(radical)) {
    const roof = roofFor.get(root.id);
    if (!roof || removed.has(roof.id)) continue;
    const h = roof.height;
    const inside = active().filter(
      (r) =>
        r.id !== root.id &&
        r.id !== roof.id &&
        !bar(r) &&
        !radical(r) &&
        r.x >= roof.x - h * 0.1 &&
        right(r) <= right(roof) + h * 0.1 &&
        baseOf(r) > baseOf(roof) + h * 0.14 &&
        baseOf(r) < baseOf(root) + h * 0.7 &&
        !across(root, r),
    );
    if (!inside.length) continue;
    const baseline = inside.reduce((a,b) => a.height >= b.height ? a : b).baseline;
    // Multi-baseline content not already a fraction is ambiguous: retain it.
    if (inside.some((r) => Math.abs(baseOf(r) - baseline) > h * 0.3)) continue;
    const latex = `\\sqrt{${words(inside)}}`;
    fold(root, [roof, ...inside], latex, baseline, h);
    events.push({ kind: 'radical', sourceIds: root.sourceIds, latex });
  }

  };
  reduceRadicals();

  // A verified HyhwpEQ fraction-bar glyph has its text baseline BELOW the
  // actual bar. Its operands occupy baseline bands -1.0em and +0.34em.
  // No page-row ordering is used; x containment keeps neighboring choices apart.
  for (const line of items
    .filter((r) => bar(r) && !roofs.has(r.id))
    .sort((a, b) => a.width - b.width)) {
    const h = line.height,
      candidates = active().filter(
        (r) =>
          r.id !== line.id &&
          !/^[①-⑤]$/.test(r.text) &&
          !bar(r) &&
          !radical(r) &&
          r.x >= line.x - h * 0.2 &&
          right(r) <= right(line) + h * 0.4 &&
          r.height <= h * 1.35 &&
          !across(line, r),
      );
    const above = candidates.filter(
      (r) =>
        baseOf(r) - baseOf(line) >= -h * 1.6 &&
        baseOf(r) - baseOf(line) <= -h * 0.55,
    );
    const below = candidates.filter(
      (r) =>
        baseOf(r) - baseOf(line) >= -h * 0.08 &&
        baseOf(r) - baseOf(line) <= h * 0.75,
    );
    const band = (list: Run[], target: number) => {
      if (!list.length) return [];
      const chosen = list.reduce((a, b) =>
        Math.abs(baseOf(a) - target) <= Math.abs(baseOf(b) - target) ? a : b,
      );
      return list.filter(
        (r) => Math.abs(baseOf(r) - baseOf(chosen)) <= h * 0.18,
      );
    };
    const numerator = band(above, baseOf(line) - h * 0.98),
      denominator = band(below, baseOf(line) + h * 0.34);
    if (!numerator.length || !denominator.length) continue;
    const latex = `\\frac{${words(numerator)}}{${words(denominator)}}`;
    fold(
      line,
      [...numerator, ...denominator],
      latex,
      baseOf(line) - h * 0.32,
      h,
    );
    events.push({ kind: 'fraction', sourceIds: line.sourceIds, latex });
  }


  reduceRadicals();
  attachScripts(true);

  for (const [stemId, head] of vectorPairs) {
    const stem = items[stemId];
    const h = stem.height;
    const bases = active().filter(r => r.id !== stem.id && r.id !== head.id &&
      r.equation && !bar(r) && !radical(r) && r.mathRole !== 'vectorArrow' &&
      r.x >= stem.x - h * 0.12 && right(r) <= right(head) + h * 0.1 &&
      baseOf(r) - baseOf(stem) > h * 0.2 && baseOf(r) - baseOf(stem) < h * 0.8);
    if (bases.length !== 1) continue;
    const base = bases[0], latex = `\\vec{${expr(base)}}`;
    fold(base, [stem, head], latex, baseOf(base), base.height);
    events.push({ kind: 'vectorAccent', sourceIds: base.sourceIds, latex });
  }

  // Tall delimiters have stretched glyph metrics that are not the baseline of
  // their contents. Pair them first, then retain the contents' baseline; a
  // raised atom beside the original closing glyph is an outer power.
  const opening: Record<string,string> = {')':'(',']':'[','}':'{'};
  for (const close of active().filter((r)=>opening[r.text]).sort((a,b)=>a.x-b.x)) {
    const open = active().filter((r)=>r.text===opening[close.text] && r.x<close.x &&
      Math.abs(r.height-close.height)<close.height*0.18 &&
      Math.abs(baseOf(r)-baseOf(close))<close.height*0.18 && !across(r,close))
      .sort((a,b)=>b.x-a.x)[0];
    if (!open) continue;
    const glyphHeight=Math.min(open.height,close.height);
    const inside=active().filter((r)=>r.id!==open.id && r.id!==close.id &&
      r.x>=right(open)-glyphHeight*0.12 && right(r)<=close.x+glyphHeight*0.12 &&
      baseOf(r)>Math.min(open.y,close.y)-glyphHeight*0.1 &&
      r.y<Math.max(baseOf(open),baseOf(close))+glyphHeight*0.2);
    if (!inside.length || inside.some((r)=>!r.equation || bar(r) || radical(r) || /[⎧⎨⎩⎪]/.test(r.text))) continue;
    const main=inside.reduce((a,b)=>a.height>=b.height?a:b), h=main.height, baseline=baseOf(main);
    if (inside.some((r)=>Math.abs(baseOf(r)-baseline)>h*0.2)) continue;
    const powers=active().filter((r)=>r.id!==close.id && !inside.includes(r) && !r.latex &&
      /^[A-Za-z0-9+−-]+$/.test(r.text) && r.height<=h*0.82 && r.height>=h*0.4 &&
      r.x-right(close)>=-h*0.15 && r.x-right(close)<=h*0.28 &&
      baseOf(close)-baseOf(r)>glyphHeight*0.18 && baseOf(close)-baseOf(r)<glyphHeight*0.8 && !across(close,r));
    // Two vertically distinct candidates are ambiguous; retain both as atoms.
    const sup=powers.length && powers.every((r)=>Math.abs(baseOf(r)-baseOf(powers[0]))<h*0.16)?powers:[];
    const indices=active().filter(r=>r.id!==close.id && !inside.includes(r) && !r.latex &&
      /^\d+$/.test(r.text) && r.equation && r.height<=h*.82 && r.height>=h*.4 &&
      r.x-right(close)>=-h*.15 && r.x-right(close)<=h*.28 &&
      baseOf(r)-baseline>h*.18 && baseOf(r)-baseline<h*.7 && !across(close,r));
    const sub=indices.length && indices.every(r=>Math.abs(baseOf(r)-baseOf(indices[0]))<h*.16)?indices:[];
    if(glyphHeight<h*1.15 && !sup.length && !sub.length) continue;
    const latex=`\\left${expr(open)}${words(inside)}\\right${expr(close)}${sup.length?`^{${words(sup)}}`:''}${sub.length?`_{${words(sub)}}`:''}`;
    fold(open,[...inside,close,...sup,...sub],latex,baseline,h);
    events.push({kind:'delimitedExpression',sourceIds:open.sourceIds,latex});
  }

  // A producer can switch to a body font for just the multiplication dot
  // inside an equation (e.g. a compound unit). Its two adjacent equation
  // operands and shared baseline are the evidence, not the surrounding topic.
  // Without this bridge, composing only equation-font atoms would skip the
  // dot and move it after the whole expression in reading order.
  for (const dot of active().filter(r => !r.equation && /^[·‧⋅]$/.test(r.text))) {
    const h = dot.height;
    if (dot.width <= 0 || dot.width > h * 0.7) continue;
    const neighbors = active().filter(r => r.equation && !bar(r) && !radical(r) &&
      !r.mathRole && Math.abs(baseOf(r) - baseOf(dot)) < h * 0.12 &&
      Math.abs(r.height - h) < h * 0.18 && !across(r, dot));
    const left = neighbors.filter(r => r.x < dot.x &&
      dot.x - right(r) >= -h * 0.22 && dot.x - right(r) <= h * 0.35)
      .sort((a, b) => right(b) - right(a))[0];
    const next = neighbors.filter(r => r.x > dot.x &&
      r.x - right(dot) >= -h * 0.22 && r.x - right(dot) <= h * 0.35)
      .sort((a, b) => a.x - b.x)[0];
    if (!left || !next) continue;
    dot.equation = true;
    dot.latex = '\\cdot ';
    events.push({ kind: 'inlineMathOperator', sourceIds: dot.sourceIds, latex: dot.latex });
  }

  // Compose only confirmed equation atoms in a local baseline neighborhood.
  const merged: Run[] = [];
  for (const current of active().sort((a, b) => a.x - b.x)) {
    const previous = merged
      .filter(
        (r) =>
          r.equation &&
          current.equation &&
          !bar(r) &&
          !bar(current) &&
          !radical(r) &&
          !radical(current) &&
          !/[⎧⎨⎩⎪]/.test(r.text) &&
          !/[⎧⎨⎩⎪]/.test(current.text) &&
          Math.abs(baseOf(r) - baseOf(current)) <=
            Math.min(r.height, current.height) * 0.16 &&
          Math.abs(r.height - current.height) <=
            Math.min(r.height, current.height) * 0.18 &&
          current.x - right(r) >= -Math.min(r.height, current.height) * 0.22 &&
          current.x - right(r) <= Math.min(r.height, current.height) * 0.35 &&
          // Never jump over an unclassified in-line character. Keep the math
          // split instead of moving that character past its right operand.
          !merged.some(between => between.id !== r.id && !between.equation &&
            between.x > r.x && between.x < current.x &&
            right(between) > right(r) - r.height * 0.22 &&
            Math.abs(baseOf(between) - baseOf(current)) < current.height * 0.2) &&
          !across(r, current),
      )
      .sort((a, b) => right(b) - right(a))[0];
    if (!previous) {
      merged.push(current);
      continue;
    }
    const complex = !!previous.latex || !!current.latex || !!previous.sourceMathLatex || !!current.sourceMathLatex,
      combined = complex
        ? expr(previous) + expr(current)
        : previous.text + current.text,
      before = baseOf(previous),
      h = previous.height;
    fold(previous, [current], combined, before, h);
    if (!complex) delete previous.latex;
  }
  // A cases brace is assembled only from explicit top/middle/bottom glyphs.
  // Its branches must start next to it and form separate coherent baselines.
  for (const middle of merged.filter((r)=>r.text==='⎨')) {
    const h=middle.height;
    const pieces=merged.filter((r)=>/[⎧⎨⎩⎪]/.test(r.text) &&
      Math.abs(r.x-middle.x)<h*0.12 && Math.abs(r.width-middle.width)<h*0.2);
    const top=pieces.filter((r)=>r.text==='⎧' && baseOf(r)<baseOf(middle)).sort((a,b)=>b.y-a.y)[0];
    const bottom=pieces.filter((r)=>r.text==='⎩' && baseOf(r)>baseOf(middle)).sort((a,b)=>a.y-b.y)[0];
    if (!top || !bottom || baseOf(bottom)-top.y>h*12) continue;
    const brace=pieces.filter((r)=>r.y>=top.y-h*0.1 && baseOf(r)<=baseOf(bottom)+h*0.1);
    const candidates=merged.filter((r)=>!removed.has(r.id) && r.equation && !brace.includes(r) &&
      r.x>=right(middle)-h*0.1 && baseOf(r)>=top.y && baseOf(r)<=baseOf(bottom)+h*0.2 &&
      !bar(r) && !radical(r) && !/[⎧⎨⎩⎪]/.test(r.text) && !across(middle,r));
    const seeds=candidates.filter((r)=>r.x-right(middle)<h*1.25).sort((a,b)=>baseOf(a)-baseOf(b));
    const rows: Run[][]=[];
    for (const seed of seeds) {
      if (rows.some((row)=>row.includes(seed))) continue;
      const row=[seed];
      for (const next of candidates.filter((r)=>r.x>seed.x && Math.abs(baseOf(r)-baseOf(seed))<h*0.2).sort((a,b)=>a.x-b.x)) {
        if (next.x-right(row[row.length-1])>h*2.5) break;
        row.push(next);
      }
      rows.push(row);
    }
    if (rows.length<2 || rows.some((row,i)=>i && baseOf(row[0])-baseOf(rows[i-1][0])<h*0.7)) continue;
    const cuts=rows.map((row)=>{
      const gaps=row.slice(1).map((r,i)=>({index:i+1,gap:r.x-right(row[i])})).sort((a,b)=>b.gap-a.gap);
      return gaps[0]?.gap>h*0.8?gaps[0].index:0;
    });
    const columns=cuts.every(Boolean) && Math.max(...rows.map((row,i)=>row[cuts[i]].x))-Math.min(...rows.map((row,i)=>row[cuts[i]].x))<h*0.35;
    const content=rows.map((row,i)=>columns?`${words(row.slice(0,cuts[i]))}&${words(row.slice(cuts[i]))}`:words(row)).join('\\\\');
    const latex=`\\begin{cases}${content}\\end{cases}`;
    const baseline=baseOf(middle)+h*0.05;
    fold(middle,[...brace.filter((r)=>r.id!==middle.id),...rows.flat()],latex,baseline,h);
    const lhs=merged.filter((r)=>!removed.has(r.id) && r.id!==middle.id && r.equation && /=\s*$/.test(r.latex??r.text) &&
      middle.x-right(r)>=-h*0.15 && middle.x-right(r)<=h*0.35 && Math.abs(baseOf(r)-baseline)<h*0.2 && !across(r,middle))[0];
    if (lhs) fold(lhs,[middle],expr(lhs)+latex,baseOf(lhs),lhs.height);
    events.push({kind:'cases',sourceIds:lhs?.sourceIds??middle.sourceIds,latex:lhs?.latex??latex});
  }
  const finalRuns=merged.filter((r)=>!removed.has(r.id));
  for (const r of finalRuns) {
    if (bar(r) || radical(r) || /[⎧⎨⎩⎪]/.test(r.text) || /^(lim|Σ|∑)$/.test(r.text))
      warnings.push({
        kind: 'unresolvedMathStructure',
        sourceIds: r.sourceIds,
        role: r.mathRole ?? (/[⎧⎨⎩⎪]/.test(r.text)?'casesBrace':'operatorLimits'),
        x: r.x,
        y: r.y,
      });
  }
  const coverage = finalRuns.flatMap((r) => r.sourceIds).sort((a, b) => a - b);
  const sourceConserved =
    coverage.length === input.length && coverage.every((id, i) => id === i);
  const result = finalRuns
    .filter((r) => !(r.vectorSource && r.mathRole))
    .map(({ id: _id, latex, sourceMathLatex, sourceIds: _sourceIds, ...r }) => ({
      ...r,
      // Some producers store l/o/g as three glyphs. Promote names only after
      // those atoms have been joined inside a reconstructed math expression.
      text: latex || sourceMathLatex ? `$${(latex ?? sourceMathLatex!).replace(/(?<![\\A-Za-z])(sin|cos|tan|log|ln)(?![A-Za-z])/g, '\\$1')}$` : r.text,
    }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  return { items: result, warnings, events, sourceConserved };
}
