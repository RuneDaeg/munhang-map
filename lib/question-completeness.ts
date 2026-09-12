import { normalizeQuestionText, splitMathText } from './math-normalization';
import { hasMissingSourcePrescripts, hasMisplacedSourceScripts } from './math-quality';
import { questionPlainText } from './question-content';

const LABELS = ['①', '②', '③', '④', '⑤'];
type Choice = { label: string; text: string };
const compact = (text: string) => text.replace(/\s/g, '').replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
const inlineQuestion = (text: string) => /밑줄\s*친|어법상|문맥상.*(?:낱말|어휘)|문장.*넣기에.*위치/.test(text.slice(0, 350));

/** Flag an entire long stem repeated twice, not repeated phrases inside a passage. */
export function hasDuplicatedStem(text: string): boolean {
  const stem = text.split(/(?:^|\n)\s*①\s/)[0].replace(/\s/g, '');
  return stem.length >= 240 && stem.length % 2 === 0 && stem.slice(0, stem.length / 2) === stem.slice(stem.length / 2);
}

function indexText(text: string, ignoreMarkers = false) {
  let value = '';
  const offsets: number[] = [];
  for (let i = 0; i < text.length; i += 1) if (!/\s/.test(text[i]) && !(ignoreMarkers && LABELS.includes(text[i]))) { value += compact(text[i]); offsets.push(i); }
  return { value, offsets };
}

/** Only a complete, explicitly numbered terminal list is evidence for five choices. */
function sourceChoices(text: string): Choice[] {
  if (inlineQuestion(text) || text.includes(':::')) return [];
  const matches = [...text.matchAll(/[①②③④⑤]/g)];
  const tail = matches.slice(-5);
  if (tail.map(match => match[0]).join('') !== LABELS.join('')) return [];
  const prefix = text.slice(text.lastIndexOf('\n', tail[0].index) + 1, tail[0].index);
  if (prefix.trim()) return [];
  const result = tail.map((match, i) => ({ label: match[0], text: text.slice(match.index + 1, tail[i + 1]?.index).trim() }));
  return result.every(choice => choice.text && !/\n\s*\d{1,3}[.)]\s/.test(choice.text)) ? result : [];
}

function apiChoices(value: unknown): Choice[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 5 || value.some(item => typeof item !== 'string' || !item.trim())) return [];
  const choices = value.map((raw, i) => {
    const text = normalizeQuestionText(raw).trim();
    const prefix = text.match(/^([①②③④⑤])\s*|^\(?([1-5])[.)]\s+/);
    return { label: prefix ? prefix[1] || LABELS[Number(prefix[2]) - 1] : '', text: prefix ? text.slice(prefix[0].length).trim() : text, index: i };
  });
  if (choices.some(choice => !choice.text)) return [];
  // Older compatible providers return five unlabelled entries in source order.
  // A short/mixed array may be incomplete: do not invent its missing numbering.
  if (choices.every(choice => !choice.label) && choices.length === 5) return choices.map(choice => ({ label: LABELS[choice.index], text: choice.text }));
  if (choices.some(choice => !choice.label || !choice.text)) return [];
  const numbers = choices.map(choice => LABELS.indexOf(choice.label));
  if (new Set(numbers).size !== numbers.length || numbers.some((number, i) => i > 0 && number <= numbers[i - 1])) return [];
  return choices.map(({ label, text }) => ({ label, text }));
}

export function numberedApiChoices(value: unknown) {
  return apiChoices(value).map(choice => `${choice.label} ${choice.text}`);
}

export function includesRecognizedChoices(text: string, value: unknown) {
  return apiChoices(value).every(choice => compact(text).includes(compact(choice.text)));
}

function attachChoices(candidate: string, choices: Choice[]) {
  const indexed = indexText(candidate);
  let end = indexed.value.length;
  const locations: Array<{ start: number; end: number; choice: Choice }> = [];
  // Locate the final ordered option texts, not an earlier quote in the passage.
  for (const choice of [...choices].reverse()) {
    const needle = compact(choice.text);
    const at = indexed.value.lastIndexOf(needle, end - needle.length);
    if (!needle || at < 0 || at + needle.length > end) return undefined;
    let start = indexed.offsets[at];
    const prefix = candidate.slice(0, start).match(/(?:[①②③④⑤]|\(?[1-5][.)])\s*$/);
    if (prefix) start -= prefix[0].length;
    locations.unshift({ start, end: indexed.offsets[at + needle.length - 1] + 1, choice });
    end = at;
  }
  if (locations.some((location, i) => i && candidate.slice(locations[i - 1].end, location.start).trim())) return undefined;
  const suffix = candidate.slice(locations.at(-1)!.end);
  if (suffix.trim() && !/^\s*\[[\d.]+\s*점\]\s*$/.test(suffix)) return undefined;
  const start = locations[0].start;
  // Choice text was incorrectly included in an AI box/table. Do not damage its fences.
  if (candidate.slice(start).includes(':::')) return undefined;
  return candidate.slice(0, start).trimEnd() + '\n' + choices.map(choice => `${choice.label} ${choice.text}`).join('\n') + suffix;
}

/** Restore source-visible circled markers in place, including English grammar questions. */
function preserveInlineMarkers(candidate: string, original: string) {
  let text = candidate;
  const markers = [...original.matchAll(/[①②③④⑤]/g)];
  for (const marker of markers) {
    if ([...text.matchAll(new RegExp(marker[0], 'g'))].length >= markers.filter(item => item[0] === marker[0]).length) continue;
    const left = compact(original.slice(Math.max(0, marker.index - 70), marker.index).replace(/[①②③④⑤]/g, '')).slice(-24);
    const right = compact(original.slice(marker.index + 1, marker.index + 91).replace(/[①②③④⑤]/g, '')).slice(0, 40);
    const indexed = indexText(text, true);
    const needle = left + right;
    const at = indexed.value.indexOf(needle);
    if (needle.length < 16 || at < 0 || indexed.value.indexOf(needle, at + 1) >= 0) continue;
    const offset = indexed.offsets[at + left.length];
    if (offset === undefined) continue;
    text = text.slice(0, offset) + marker[0] + ' ' + text.slice(offset);
  }
  return text;
}

function leadingPrompt(original: string) {
  const text = questionPlainText(original).trim().replace(/^\d{1,3}[.)]\s*/, '');
  // Only a short, leading Korean instruction; never copy an arbitrary passage as a prompt.
  if (!/^(?:다음|윗글|밑줄|주어진\s*글|글의)/.test(text)) return '';
  const prompt = text.match(/^[^①②③④⑤]{4,180}?[?？]/)?.[0];
  // PDF text commonly separates punctuation: "핵반응이다 ." still ends a
  // sentence. Never mistake its following equations and question for one
  // missing leading instruction and prepend the whole original stem.
  if (!prompt || /(?:다|요)\s*[.。](?:\s|$)/.test(prompt) || !/[가-힣]/.test(prompt) || !/(?:것|고르|적절|알맞|일치|어법|의미)/.test(prompt)) return '';
  return prompt.replace(/\s+/g, ' ').trim();
}

function includesPrompt(text: string, prompt: string) {
  const plain = compact(questionPlainText(text));
  if (plain.includes(compact(prompt))) return true;
  // Equivalent math typography can differ between source and AI. If all of
  // the surrounding instruction is already present in order, do not append a
  // second copy merely because LaTeX braces/font commands differ.
  const chunks = splitMathText(prompt).filter((part) => !part.math).map((part) => compact(part.text)).filter(Boolean);
  if (chunks.join('').length < 12) return false;
  let offset = 0;
  return chunks.every((chunk) => {
    const at = plain.indexOf(chunk, offset);
    if (at < 0) return false;
    offset = at + chunk.length;
    return true;
  });
}

export function preserveQuestionParts(candidate: string, original: string, choicesValue: unknown, recognizedStem = '') {
  let text = normalizeQuestionText(candidate);
  const source = normalizeQuestionText(original);
  const warnings: string[] = [];
  if (hasMisplacedSourceScripts(text, source)) return { text: source, warning: '일반 변수의 오른쪽 첨자가 왼쪽으로 이동하거나 중복되어 기존 문항을 보존했습니다. 원문 이미지와 비교해 주세요.', keptOriginal: true };
  if (hasMissingSourcePrescripts(text, source)) return { text: source, warning: '원문 원자핵의 왼쪽 위·아래 첨자(질량수·양성자 수)가 누락되거나 바뀌어 기존 문항을 보존했습니다. 원문 이미지와 비교해 주세요.', keptOriginal: true };
  const fromSource = sourceChoices(source);
  const fromApi = apiChoices(choicesValue);
  const choices = fromSource.length > fromApi.length ? fromSource : fromApi.length ? fromApi : fromSource;
  const prompt = leadingPrompt(source) || leadingPrompt(normalizeQuestionText(recognizedStem));
  if (prompt && !includesPrompt(text, prompt)) text = `${prompt}\n${text}`;
  text = preserveInlineMarkers(text, source);
  if (!inlineQuestion(source) && !inlineQuestion(text) && choices.length) {
    const attached = attachChoices(text, choices);
    if (attached) text = attached;
    else if (fromSource.length && !fromSource.every(choice => compact(text).includes(compact(choice.text)))) {
      // A missing option is not repaired by guessing or duplicating a partial list.
      return { text: source, warning: '선택지 일부가 누락되어 기존 문항을 보존했습니다. 원문과 비교해 다시 판독해 주세요.', keptOriginal: true };
    } else if (!choices.every(choice => compact(text).includes(compact(choice.text)))) {
      // PDF text may lack circled glyphs but still contain all option sentences.
      // Try its intact wording before accepting an incomplete AI transcription.
      const repairedSource = attachChoices(source, choices);
      return { text: repairedSource ?? source, warning: 'AI 판독문에서 선택지 일부가 빠져 기존 추출문을 기준으로 보존했습니다. 원문과 비교해 주세요.', keptOriginal: true };
    } else warnings.push('선택지 번호와 문장 경계를 안전하게 연결하지 못했습니다. 원문에서 ①~⑤를 확인해 주세요.');
  }
  const sourceLabels = source.match(/[①②③④⑤]/g) ?? [];
  for (const label of new Set(sourceLabels)) if ((text.match(new RegExp(label, 'g')) ?? []).length < sourceLabels.filter(item => item === label).length) {
    return { text: source, warning: '원문에 있던 선택지·지문 번호가 누락되어 기존 문항을 보존했습니다.', keptOriginal: true };
  }
  if (Array.isArray(choicesValue) && choicesValue.length && !fromApi.length) warnings.push('AI의 선택지 번호·개수가 불명확합니다. 원문과 비교해 주세요.');
  return { text, warning: warnings.join(' '), keptOriginal: false };
}
