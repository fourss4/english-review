// "AI로 교정 찾기" (ADR 0005): 기호 없는 채팅을 외부 AI로 정리 → 결과 JSON을 붙여넣어 미리보기에 반영
// 앱은 AI를 직접 호출하지 않는다. 요청 문장 만들기·결과 검증·병합만 담당. DOM 비의존.
import { normalizeText, similarity } from './text.js';

const LIMITS = { items: 100, text: 2000, examples: 10, input: 100_000 };

/**
 * 개인정보로 보이는 부분을 가린다. 이메일·전화번호·URL·긴 숫자·@아이디 + 사용자가 지정한 단어(강사 이름 등).
 * @returns {{text:string, count:number}}
 */
export function maskPersonal(text, extraWords = []) {
  let count = 0;
  const rep = (label) => () => { count++; return `[${label}]`; };
  let t = String(text ?? '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, rep('EMAIL'))
    .replace(/https?:\/\/\S+/gi, rep('URL'))
    .replace(/(?<![\w])@[A-Za-z0-9_](?:[A-Za-z0-9_.]*[A-Za-z0-9_])?/g, rep('ID'))
    .replace(/(\+?\d{1,3}[\s.-]?)?\(?0?\d{2,3}\)?[\s.-]?\d{3,4}[\s.-]?\d{4}\b/g, rep('PHONE'))
    .replace(/\b\d{6,}\b/g, rep('NUMBER'));
  for (const w of extraWords.map((x) => String(x).trim()).filter((x) => x.length >= 2)) {
    const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    t = t.replace(re, rep('NAME'));
  }
  return { text: t, count };
}

/** 템플릿 머리의 설명 주석 제거 후 변수 채우기 */
export function buildStructurePrompt(template, { chat = '', comment = '' }) {
  const body = String(template).replace(/^<!--[\s\S]*?-->\s*/, '');
  return body.replace('{{chat}}', chat.trim() || '(none)').replace('{{comment}}', comment.trim() || '(none)');
}

/** AI 답변에서 JSON만 꺼내기: 코드블록·앞뒤 설명 문장 허용 */
export function extractJson(text) {
  const s = String(text ?? '').trim();
  if (s.length > LIMITS.input * 3) throw new Error('붙여넣은 내용이 너무 깁니다.');
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : s;
  const start = body.indexOf('{'), end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('결과에서 JSON을 찾지 못했습니다. AI 답변 전체를 복사했는지 확인하세요.');
  try { return JSON.parse(body.slice(start, end + 1)); } catch { throw new Error('JSON 형식이 올바르지 않습니다. AI에게 "JSON만 다시 출력해줘"라고 요청해 보세요.'); }
}

const str = (v) => (typeof v === 'string' ? normalizeText(v).slice(0, LIMITS.text) : undefined);
const opt = (o, k, v) => { const s = str(v); if (s) o[k] = s; };

function cleanExamples(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, LIMITS.examples).map((x) => {
    if (typeof x === 'string') return str(x) ? { en: str(x) } : null;
    if (!x || !str(x.en)) return null;
    const o = { en: str(x.en) };
    opt(o, 'ko', x.ko);
    if (typeof x.speaker === 'string' && /^[A-Z]$/.test(x.speaker)) o.speaker = x.speaker;
    return o;
  }).filter(Boolean);
}

/**
 * 결과 검증·정리. 알 수 없는 필드는 버리고 문자열 길이·개수 제한.
 * @returns {{data:{keyExpressions:object[], expressions:object[], corrections:object[]}, warnings:string[]}}
 */
export function validateStructure(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('결과 형식이 올바르지 않습니다.');
  if (obj.kind && obj.kind !== 'lesson_structure') throw new Error('다른 종류의 결과입니다("AI로 교정 찾기" 요청 결과를 붙여넣으세요).');
  const warnings = [];
  const arr = (k) => {
    const v = obj[k];
    if (v === undefined) return [];
    if (!Array.isArray(v)) throw new Error(`"${k}" 항목이 목록 형식이 아닙니다.`);
    if (v.length > LIMITS.items) warnings.push(`${k}가 너무 많아 앞의 ${LIMITS.items}개만 사용`);
    return v.slice(0, LIMITS.items);
  };
  const keyExpressions = arr('keyExpressions').map((e) => {
    if (!str(e?.text)) return null;
    const o = { text: str(e.text) };
    opt(o, 'pattern', e.pattern); opt(o, 'meaningKo', e.meaningKo);
    const ex = cleanExamples(e.examples); if (ex.length) o.examples = ex;
    return o;
  }).filter(Boolean);
  const expressions = arr('expressions').map((e) => {
    if (!str(e?.text)) return null;
    const o = { text: str(e.text) };
    opt(o, 'partOfSpeech', e.partOfSpeech); opt(o, 'definition', e.definition); opt(o, 'meaningKo', e.meaningKo);
    const ex = cleanExamples(e.examples); if (ex.length) o.examples = ex;
    return o;
  }).filter(Boolean);
  let dropped = 0;
  const corrections = arr('corrections').map((c) => {
    if (!str(c?.original) || !str(c?.corrected)) { dropped++; return null; }
    const o = { original: str(c.original), corrected: str(c.corrected) };
    opt(o, 'explanation', c.explanation); opt(o, 'natural', c.natural); opt(o, 'naturalKo', c.naturalKo);
    return o;
  }).filter(Boolean);
  if (dropped) warnings.push(`틀린 문장이나 교정이 빠진 항목 ${dropped}개는 제외`);
  if (!keyExpressions.length && !expressions.length && !corrections.length) throw new Error('찾은 항목이 없습니다.');
  return { data: { keyExpressions, expressions, corrections }, warnings };
}

const pad2 = (n) => String(n).padStart(2, '0');
const sameText = (a, b) => normalizeText(a).toLowerCase().replace(/[^a-z0-9' ]/g, '') === normalizeText(b).toLowerCase().replace(/[^a-z0-9' ]/g, '');

/**
 * 미리보기 중인 수업(draft)에 AI 결과를 합친다(원본 불변, 새 객체 반환).
 * - 같은 교정(틀린 문장 유사도 0.85 이상)·같은 표현은 새로 추가하지 않고 비어 있는 칸만 채움
 * - 사용자가 이미 입력한 값은 덮어쓰지 않음
 * @returns {{lesson:object, added:{corrections:number, expressions:number}, filled:number}}
 */
export function mergeStructure(draft, data, { now = new Date(), provider } = {}) {
  const l = structuredClone(draft);
  let filled = 0;
  const fill = (o, k, v) => { if (v && !o[k]) { o[k] = v; filled++; } };
  const added = { corrections: 0, expressions: 0 };

  const addExpr = (e, isKey) => {
    const hit = l.expressions.find((x) => sameText(x.text, e.text));
    if (hit) {
      fill(hit, 'meaning', e.meaningKo); fill(hit, 'pattern', e.pattern);
      fill(hit, 'partOfSpeech', e.partOfSpeech); fill(hit, 'definition', e.definition);
      if (e.examples?.length) {
        if (!hit.examples?.length) { hit.examples = e.examples; filled++; }
        else for (const ex of hit.examples) {
          const m = e.examples.find((y) => sameText(y.en, ex.en));
          if (m?.ko && !ex.ko) { ex.ko = m.ko; filled++; }
        }
      }
      return;
    }
    const o = { id: '', text: e.text, ...(isKey && !l.expressions.some((x) => x.isKey) ? { isKey: true } : {}) };
    for (const [from, to] of [['pattern', 'pattern'], ['partOfSpeech', 'partOfSpeech'], ['definition', 'definition'], ['meaningKo', 'meaning']]) if (e[from]) o[to] = e[from];
    if (e.examples?.length) o.examples = e.examples;
    l.expressions.push(o);
    added.expressions++;
  };
  data.keyExpressions.forEach((e) => addExpr(e, true));
  data.expressions.forEach((e) => addExpr(e, false));
  // 핵심 표현을 맨 앞으로
  l.expressions.sort((a, b) => (b.isKey ? 1 : 0) - (a.isKey ? 1 : 0));

  for (const c of data.corrections) {
    const hit = l.corrections.find((x) => similarity(x.original, c.original) >= 0.85);
    if (hit) {
      fill(hit, 'explanation', c.explanation); fill(hit, 'natural', c.natural); fill(hit, 'naturalKo', c.naturalKo);
      continue;
    }
    l.corrections.push({ id: '', ...c });
    added.corrections++;
  }
  l.expressions.forEach((e, i) => { e.id = `exp_${pad2(i + 1)}`; });
  l.corrections.forEach((c, i) => { c.id = `cor_${pad2(i + 1)}`; });
  l.source = { ...l.source, aiAssisted: { at: now.toISOString(), ...(provider ? { provider } : {}) } };
  return { lesson: l, added, filled };
}
