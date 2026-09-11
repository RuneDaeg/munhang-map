import type { AnalyzedQuestion, StandardRecord } from './pdf-analysis';
import { countUnresolvedGlyphs } from './pdf-text';
import { questionPlainText } from './question-content';
import { ownAssessmentText } from './assessment-mapping';
import { mathQualityIssues } from './math-quality';
import { hasDuplicatedStem } from './question-completeness';

export type ValidationFlag = { code: string; message: string };

/** Evidence checks, not model confidence or a promise of semantic correctness. */
export function validateQuestion(
  question: AnalyzedQuestion,
  catalog?: StandardRecord[],
): ValidationFlag[] {
  const flags: ValidationFlag[] = [];
  const add = (code: string, message: string) => flags.push({ code, message });
  const text = question.text;
  flags.push(...mathQualityIssues(text));
  if (hasDuplicatedStem(text))
    add('duplicated_stem', '발문·자료 전체가 두 번 반복되어 있습니다. 원문과 비교해 주세요.');
  const own = ownAssessmentText(question) || text;
  if (own !== text) for (const issue of mathQualityIssues(own))
    if (!flags.some(flag => flag.code === issue.code))
      flags.push({ ...issue, message: `개별 발문: ${issue.message}` });
  const plain = questionPlainText(own);
  if (countUnresolvedGlyphs(text))
    add('pua_present', '복원되지 않은 문자가 있습니다. 원문을 확인해 주세요.');
  if (/\\n(?![A-Za-z])/.test(text))
    add('escaped_newline', '줄바꿈이 문자 \\n으로 남아 있습니다.');
  if (
    /√|[⎧⎨⎩⎪]|(?<![A-Za-z])(?:lim|Σ|∑|∫)(?![A-Za-z])/.test(
      text.replace(/\$[^$]*\$/g, ''),
    )
  )
    add(
      'unresolved_math_layout',
      '연산자·근호·큰 괄호의 배치를 원문과 대조해 주세요.',
    );
  if (/(?:^|[=\s])\(\s*x\s*\)\s*=/.test(plain))
    add('function_name_lost', '함수 이름이 빠졌을 가능성이 있습니다.');
  const labels = new Set(plain.match(/[①②③④⑤]/g) || []);
  if (!labels.size && /그림에서[\s\S]*고르시오/.test(plain))
    add('image_only_choices','선택지 번호가 그림 안에 있어 텍스트로 추출되지 않았습니다. 원문 캡처에서 확인해 주세요.');
  if (labels.size > 0 && labels.size !== 5)
    add(
      'choice_count',
      '선택지 ①~⑤ 중 일부 번호가 없습니다. 그림 선택지도 확인해 주세요.',
    );
  if (/밑줄\s*친/.test(plain) && !/<u>|<b>|\*\*/.test(text))
    add('format_lost', '밑줄을 묻지만 추출문에 강조 서식이 없습니다.');
  if (
    /빈칸/.test(plain) &&
    !/_{3,}|\[\s*빈칸\s*\]|□|\(\s*(?:[A-C가-다㉠-㉻])?\s*\)/.test(text)
  )
    add('blank_missing', '빈칸 위치 표식을 확인해 주세요.');
  if (question.sharedPassage) {
    const [a, b] = question.sharedPassage.range;
    if (question.number < a || question.number > b)
      add(
        'foreign_set_marker',
        '공통 지문 범위가 이 문항 번호와 맞지 않습니다.',
      );
    if (!question.sharedPassage.text.trim())
      add('passage_missing', '공통 지문이 비어 있습니다.');
  }
  if (question.analysisWarning)
    add('source_layout_review', question.analysisWarning);
  if (question.captureWarning && !question.captureReviewed)
    add('capture_review', question.captureWarning);
  if (!question.standardCode)
    add(
      'mapping_unresolved',
      '적합한 성취기준 후보를 찾지 못했습니다. 교과·평가 요소를 확인해 주세요.',
    );
  if (catalog && question.standardCode) {
    const standard = catalog.find((s) => s.code === question.standardCode);
    if (!standard)
      add('code_not_in_catalog', '성취기준 코드가 카탈로그에 없습니다.');
    else if (
      question.selectedSubjectKey
        ? question.selectedSubjectKey !==
          `${standard.school}|${standard.subject}`
        : question.examSubject?.subjectKeys.length &&
          !question.examSubject.subjectKeys.includes(
            `${standard.school}|${standard.subject}`,
          )
    )
      add(
        'code_out_of_scope',
        '머리글에서 감지한 교과 범위 밖의 성취기준입니다.',
      );
  }
  return flags;
}

export function validateExamQuestions(
  questions: AnalyzedQuestion[],
  catalog?: StandardRecord[],
): AnalyzedQuestion[] {
  const counts = new Map<string, number>();
  for (const q of questions)
    if (q.standardCode)
      counts.set(q.standardCode, (counts.get(q.standardCode) || 0) + 1);
  return questions.map((q) => {
    const flags = validateQuestion(q, catalog);
    if (
      questions.length >= 10 &&
      q.standardCode &&
      (counts.get(q.standardCode) || 0) > questions.length * 0.15
    )
      flags.push({
        code: 'code_overused',
        message:
          '같은 성취기준이 전체 문항의 15%를 넘습니다. 실제 평가 요소가 같은지 확인해 주세요.',
      });
    if (q.sharedPassage) {
      const peers = questions.filter(
        (p) =>
          p.sharedPassage?.range.join('-') === q.sharedPassage!.range.join('-'),
      );
      if (
        peers.length > 1 &&
        q.standardCode &&
        peers.every((p) => p.standardCode === q.standardCode)
      )
        flags.push({
          code: 'set_uniform_code',
          message:
            '공통 지문 문항의 추천 코드가 모두 같습니다. 문항별 발문의 차이를 확인해 주세요.',
        });
    }
    return { ...q, validationFlags: flags };
  });
}
