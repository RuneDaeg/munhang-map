// Geometry reconstruction for verified HyhwpEQ/HancomEQN equation runs.
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
  const expr = (r: Run) => r.latex ?? escapeAtom(r.text);
  const latexText = (s: string) => (/[가-힣]/u.test(s) ? `\\text{${s}}` : s);
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
    if (end - x < 3 || end - x > 85) continue;
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
        r.x >= x - 0.8 &&
        right(r) <= end + 0.8 &&
        r.height >= 4 &&
        r.height <= 12 &&
        !bar(r) &&
        !radical(r),
    );
    const a = near.filter(
      (r) => baseOf(r) < y && baseOf(r) > y - r.height * 0.48,
    );
    const d = near.filter(
      (r) => baseOf(r) > y + r.height * 0.65 && baseOf(r) < y + r.height * 1.4,
    );
    if (!a.some((r) => r.equation) || !d.some((r) => r.equation)) continue;
    const h = [...a, ...d].map((r) => r.height).sort((a, b) => a - b)[
      Math.floor((a.length + d.length) / 2)
    ];
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
  for (const root of items.filter(radical)) {
    const candidates = items.filter(
      (r) =>
        bar(r) &&
        Math.abs(r.x - right(root)) < root.height * 0.18 &&
        baseOf(root) - baseOf(r) > root.height * 0.28 &&
        baseOf(root) - baseOf(r) < root.height * 0.75 &&
        r.width > root.width * 0.6 &&
        !across(root, r),
    );
    if (candidates.length === 1) {
      roofFor.set(root.id, candidates[0]);
      roofs.add(candidates[0].id);
    }
  }

  // Nuclear left indices require BOTH a superscript and a subscript; isolated
  // small labels to the left never get interpreted as a nuclide automatically.
  for (const base of items.filter(
    (r) => r.equation && !bar(r) && !radical(r) && /^[A-Z][a-z]?$/.test(r.text),
  )) {
    const possible = active().filter(
      (r) =>
        r.id !== base.id &&
        /^[0-9]+$/.test(r.text) &&
        r.height <= base.height * 0.82 &&
        r.height >= base.height * 0.45 &&
        base.x - right(r) >= -base.height * 0.1 &&
        base.x - right(r) <= base.height * 0.75 &&
        !across(r, base),
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
    const latex = `{}^{${words(s1)}}_{${words(s2)}}${expr(base)}`;
    fold(base, [...s1, ...s2], latex, baseOf(base), base.height);
    events.push({ kind: 'leftScripts', sourceIds: base.sourceIds, latex });
  }

  // Attach smaller right-hand runs to the closest eligible math base. Work on
  // base+script relations before joining baseline runs, preserving CH3OH order.
  const attachments = new Map<number, { base: Run; sup: Run[]; sub: Run[] }>();
  for (const s of active()) {
    if (bar(s) || radical(s) || s.latex || !/^[A-Za-z0-9+−-]+$/.test(s.text))
      continue;
    const candidates = active()
      .filter(
        (b) =>
          b.id !== s.id &&
          b.equation &&
          !bar(b) &&
          !radical(b) &&
          s.height <= b.height * 0.82 &&
          s.height >= b.height * 0.4 &&
          /^[A-Za-z0-9]+$/.test(b.text) &&
          s.x - right(b) >= -b.height * 0.22 &&
          s.x - right(b) <= b.height * 0.28 &&
          !across(b, s),
      )
      .map((b) => ({ b, delta: baseOf(s) - baseOf(b) }))
      .filter(
        ({ b, delta }) =>
          Math.abs(delta) >= b.height * 0.18 &&
          Math.abs(delta) <= b.height * 0.7,
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
  for (const { base, sup, sub } of attachments.values()) {
    if (removed.has(base.id)) continue;
    // Charge/index runs can contain multiple glyphs, e.g. Y^{2−}. Only expand
    // from an already anchored script along its own small-font baseline.
    for (const group of [sup, sub]) {
      if (!group.length) continue;
      for (let pass = 0; pass < 4; pass++) {
        const last = group.reduce((a, b) => (right(a) > right(b) ? a : b));
        const next = active()
          .filter(
            (r) =>
              !group.includes(r) &&
              r.id !== base.id &&
              !r.latex &&
              /^[A-Za-z0-9+−-]+$/.test(r.text) &&
              Math.abs(r.height - last.height) < last.height * 0.16 &&
              Math.abs(baseOf(r) - baseOf(last)) < last.height * 0.18 &&
              r.x - right(last) >= -last.height * 0.1 &&
              r.x - right(last) <= last.height * 0.22 &&
              right(r) - base.x < base.height * 2.5 &&
              !across(last, r),
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
    const latex = `${expr(base)}${s1.length ? `^{${words(s1)}}` : ''}${s2.length ? `_{${words(s2)}}` : ''}`;
    fold(base, eligible, latex, baseOf(base), base.height);
    events.push({ kind: 'rightScripts', sourceIds: base.sourceIds, latex });
  }

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
          !bar(r) &&
          !radical(r) &&
          r.x >= line.x - h * 0.15 &&
          right(r) <= right(line) + h * 0.2 &&
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
    const latex = `\\frac{${latexText(words(numerator))}}{${latexText(words(denominator))}}`;
    fold(
      line,
      [...numerator, ...denominator],
      latex,
      baseOf(line) - h * 0.32,
      h,
    );
    events.push({ kind: 'fraction', sourceIds: line.sourceIds, latex });
  }

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
    const baseline = baseOf(root) - h * 0.32;
    // Multi-baseline content not already a fraction is ambiguous: retain it.
    if (inside.some((r) => Math.abs(baseOf(r) - baseline) > h * 0.3)) continue;
    const latex = `\\sqrt{${words(inside)}}`;
    fold(root, [roof, ...inside], latex, baseline, h);
    events.push({ kind: 'radical', sourceIds: root.sourceIds, latex });
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
          Math.abs(baseOf(r) - baseOf(current)) <=
            Math.min(r.height, current.height) * 0.16 &&
          Math.abs(r.height - current.height) <=
            Math.min(r.height, current.height) * 0.18 &&
          current.x - right(r) >= -Math.min(r.height, current.height) * 0.22 &&
          current.x - right(r) <= Math.min(r.height, current.height) * 0.35 &&
          !across(r, current),
      )
      .sort((a, b) => right(b) - right(a))[0];
    if (!previous) {
      merged.push(current);
      continue;
    }
    const complex = !!previous.latex || !!current.latex,
      combined = complex
        ? expr(previous) + expr(current)
        : previous.text + current.text,
      before = baseOf(previous),
      h = previous.height;
    fold(previous, [current], combined, before, h);
    if (!complex) delete previous.latex;
  }
  for (const r of merged) {
    if (bar(r) || radical(r))
      warnings.push({
        kind: 'unresolvedMathStructure',
        sourceIds: r.sourceIds,
        role: r.mathRole,
        x: r.x,
        y: r.y,
      });
  }
  const coverage = merged.flatMap((r) => r.sourceIds).sort((a, b) => a - b);
  const sourceConserved =
    coverage.length === input.length && coverage.every((id, i) => id === i);
  const result = merged
    .filter((r) => !(r.vectorSource && r.mathRole))
    .map(({ id: _id, latex, sourceIds: _sourceIds, ...r }) => ({
      ...r,
      text: latex ? `$${latex}$` : r.text,
    }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  return { items: result, warnings, events, sourceConserved };
}
