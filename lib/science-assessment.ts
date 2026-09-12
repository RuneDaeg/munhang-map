import type { AnalyzedQuestion, StandardRecord } from './pdf-analysis';

/** Narrow only evidenced science assessment elements. This is not a 2015→2022
 * equivalence table: a missing topic in the supplied catalogue stays unresolved.
 */
export function scienceAssessmentScope(question: AnalyzedQuestion, catalog: StandardRecord[], selectedSubjectKey?: string) {
  const selected = selectedSubjectKey ?? question.selectedSubjectKey;
  // A teacher's explicit course outside the detected exam family supersedes
  // that heading; never use the old heading to erase the new course's choices.
  if (selected && !question.examSubject?.subjectKeys.includes(selected)) return undefined;
  const label = question.examSubject?.label ?? '';
  const text = (question.textEdited ? question.text : question.assessmentText ?? question.text)
    .normalize('NFKC').replace(/\s/g, '');
  const rules: { subject: RegExp; test: RegExp; context?: RegExp; evidence: RegExp; area: string; statement: RegExp }[] = [
    { subject: /물리/, test: /충격량|운동량/, evidence: /충격량|운동량/, area: '충격량·운동량',
      statement: /충격량|운동량/ },
    { subject: /물리/, test: /전기력|쿨롱|점전하/, evidence: /전기력|쿨롱|점전하/, area: '전하의 전기적 상호작용',
      statement: /전기력|전하.*전기장|전하.*전기적/ },
    { subject: /지구/, test: /속성작용|교결물질|쇄설성퇴적/, evidence: /속성작용|교결물질|쇄설성퇴적/, area: '퇴적물의 속성 작용',
      statement: /속성작용|교결|다짐작용|퇴적암.*형성|퇴적물.*암석/ },
    // A characteristic illustrated by several biological examples is not a
    // human-inheritance problem merely because one row mentions reproduction.
    { subject: /생명|생물/, test: /생물(?:및생명과학)?의?특성/, evidence: /생물(?:및생명과학)?의?특성/, area: '생물의 특성',
      statement: /생물(?:및생명과학)?의?특성/ },
    // Require both the named phenomenon and an assessed physical property;
    // a passing reference to a typhoon or ocean must not hijack another topic.
    { subject: /지구/, test: /태풍/, context: /풍속|풍향|기압|태풍중심|안전반원|위험반원/, evidence: /태풍/, area: '태풍 영향권의 날씨',
      statement: /태풍/ },
    { subject: /지구/, test: /천해파|심해파|해파/, context: /파장|주기|수심|전파|속도|물입자/, evidence: /천해파|심해파|해파/, area: '해파의 전파와 수심',
      statement: /천해파|심해파|해파/ },
    // Hydrostatic balance alone is shared with the atmosphere. Only explicit
    // marine geostrophic-flow evidence selects the ocean-flow criterion.
    { subject: /지구/, test: /지형류/, context: /해수|해역|수압|해류|에크만/, evidence: /지형류/, area: '해수의 지형류 평형',
      statement: /지형류/ },
  ];
  const rule = rules.find((candidate) => candidate.subject.test(label) && candidate.test.test(text) && (!candidate.context || candidate.context.test(text)));
  if (!rule) return undefined;
  const evidence = text.match(rule.evidence)![0];
  return {
    area: rule.area,
    catalog: catalog.filter((row) => rule.statement.test(row.statement.replace(/\s/g, ''))),
    reason: `문항의 「${evidence}」를 근거로 ‘${rule.area}’을 다루는 성취기준만 후보로 제한했습니다. 후보는 교육과정 간 동등성 확정이 아니며 최종 검토가 필요합니다.`,
  };
}
