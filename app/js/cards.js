// 학습 항목 → 카드, 문제 유형 선택, 채점, 기본 문제 생성 (ADR 0007). DOM 비의존.
// 카드 1장 = 학습 항목 1개(교정 cor_ / 표현 exp_ / 업그레이드 up_). 문제는 lesson.exercises에서 유형을 돌아가며 낸다.

import { newSrs, fromLegacy } from './srs.js';
import { normalizeText, wordDiff } from './text.js';

export const TYPE_LABEL = { cloze: '빈칸 채우기', choice: '옳은 것 고르기', situation: '상황에 맞는 표현', meaning: '뜻·쓰임 떠올리기' };
export const KIND_LABEL = { cor: '교정', exp: '표현', up: '표현 업그레이드' };
export const AUTO = new Set(['cloze', 'choice', 'situation']);

export const cardId = (lessonId, ref) => `crd_${lessonId.replace(/^les_/, '')}_${ref}`;
const kindOf = (ref) => ref.split('_')[0];

/** 수업의 학습 항목(숨긴 항목 제외 옵션) */
export function lessonItems(lesson, { includeHidden = false } = {}) {
  const hidden = new Set(lesson.hidden || []);
  const out = [];
  for (const c of lesson.corrections || []) out.push({ ref: c.id, kind: 'cor', main: c.corrected, sub: c.meaningKo || '', item: c });
  for (const e of lesson.expressions || []) out.push({ ref: e.id, kind: 'exp', main: e.text, sub: e.meaningKo || e.definition || '', item: e });
  for (const u of lesson.upgrades || []) out.push({ ref: u.id, kind: 'up', main: u.suggestion, sub: u.meaningKo || '', item: u });
  return includeHidden ? out : out.filter((x) => !hidden.has(x.ref));
}

/** 표현이 들어 있는 첫 예문을 찾아 빈칸 처리. 괄호 부분("(your)")은 생략 가능 */
export function makeCloze(expression, examples = []) {
  const core = normalizeText(expression).replace(/\([^)]*\)/g, ' ').replace(/[.!?]+$/, '').replace(/\s+/g, ' ').trim();
  if (core.length < 3) return null;
  const words = core.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`\\b${words.join("(?:\\s+[\\w']+){0,2}?\\s+")}\\w*`, 'i');
  for (const ex of examples) {
    const sentence = normalizeText(ex.en);
    const m = sentence.match(re);
    if (m) return { prompt: sentence.slice(0, m.index) + '_____' + sentence.slice(m.index + m[0].length), answer: m[0], promptKo: ex.ko };
  }
  return null;
}

/** 교정 문장에서 원문과 달라진 단어 묶음(1~4단어)을 빈칸으로 */
export function correctionCloze(original, corrected) {
  const ops = wordDiff(original, corrected).ops; // del = corrected에만 있는 단어
  const words = normalizeText(corrected).split(/\s+/);
  let i = 0, start = -1, end = -1;
  for (const o of ops) {
    if (o.type === 'add') continue; // original에만 있는 단어
    if (o.type === 'del') { if (start < 0) start = i; end = i; }
    i++;
  }
  if (start < 0 || end - start > 3) return null;
  const answer = words.slice(start, end + 1).join(' ').replace(/[.,!?]+$/, '');
  if (!answer) return null;
  const prompt = [...words.slice(0, start), '_____' + (words[end].match(/[.,!?]+$/)?.[0] || ''), ...words.slice(end + 1)].join(' ');
  return { prompt, answer };
}

/** AI 문제가 없는 항목(구버전 수업·처리 누락)을 위한 기본 문제 */
export function fallbackExercises(lesson, ref) {
  const k = kindOf(ref);
  const out = [];
  const push = (o) => out.push({ id: `ex_${ref}_f${out.length + 1}`, ref, ...o });
  if (k === 'cor') {
    const c = (lesson.corrections || []).find((x) => x.id === ref);
    if (!c) return out;
    const opts = [c.corrected, c.original];
    push({ type: 'choice', prompt: '자연스러운 문장을 고르세요.', options: opts, answer: c.corrected, explanationKo: c.explanationKo });
    const cz = correctionCloze(c.original, c.corrected);
    if (cz) push({ type: 'cloze', ...cz, promptKo: c.meaningKo, explanationKo: c.explanationKo });
    if (c.meaningKo) push({ type: 'meaning', prompt: c.natural || c.corrected, answer: c.meaningKo });
  } else if (k === 'exp') {
    const e = (lesson.expressions || []).find((x) => x.id === ref);
    if (!e) return out;
    const cz = makeCloze(e.text, e.examples);
    if (cz) push({ type: 'cloze', ...cz });
    push({ type: 'meaning', prompt: e.text, answer: [e.meaningKo, e.definition, e.pattern && `패턴: ${e.pattern}`].filter(Boolean).join(' — ') || '(뜻 정보 없음)' });
  } else if (k === 'up') {
    const u = (lesson.upgrades || []).find((x) => x.id === ref);
    if (!u) return out;
    if (u.situationKo) push({ type: 'situation', prompt: 'Which expression fits?', promptKo: u.situationKo, options: [u.suggestion, u.original], answer: u.suggestion, explanationKo: u.explanationKo });
    push({ type: 'meaning', prompt: u.suggestion, answer: [u.meaningKo, u.explanationKo].filter(Boolean).join(' — ') });
  }
  return out;
}

export function variantsFor(lesson, ref) {
  const v = (lesson.exercises || []).filter((x) => x.ref === ref);
  return v.length ? v : fallbackExercises(lesson, ref);
}

/**
 * 문제 고르기: 최근에 덜 쓴 유형 우선. avoidType(오답 복습: 마지막으로 틀린 유형)은 다른 유형이 있으면 제외.
 */
export function pickVariant(card, variants, { avoidType, random = Math.random } = {}) {
  if (!variants.length) return null;
  let pool = variants;
  if (avoidType && variants.some((v) => v.type !== avoidType)) pool = variants.filter((v) => v.type !== avoidType);
  const lastUsed = {};
  for (const l of card.log || []) if (l.type) lastUsed[l.type] = l.at;
  const types = [...new Set(pool.map((v) => v.type))].sort((a, b) => (lastUsed[a] || '').localeCompare(lastUsed[b] || ''));
  const cands = pool.filter((v) => v.type === types[0]);
  return cands[Math.floor(random() * cands.length)];
}

const key = (s) => normalizeText(s).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();

/** 빈칸 채점: 대소문자·문장부호 무시, accept 허용. close = 한두 글자 오타 수준 */
export function checkTyped(ex, typed) {
  const t = key(typed);
  const answers = [ex.answer, ...(ex.accept || [])].map(key).filter(Boolean);
  if (answers.includes(t)) return { correct: true, close: false };
  const close = answers.some((a) => a.length > 3 && editDistance(a, t) <= Math.max(1, Math.floor(a.length / 8)));
  return { correct: false, close };
}

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

export function shuffled(arr, random = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * 수업과 카드 동기화: 새 항목은 카드 생성, 기존 카드는 학습 기록 유지.
 * 숨긴 항목·사라진 항목은 보류(suspended), 다시 나타나면 해제.
 */
export function syncLessonCards(lesson, existing, today) {
  const all = lessonItems(lesson, { includeHidden: true });
  const hidden = new Set(lesson.hidden || []);
  const byId = new Map(existing.map((c) => [c.id, c]));
  const upserts = [];
  const want = new Set();
  for (const it of all) {
    const id = cardId(lesson.id, it.ref);
    want.add(id);
    const old = byId.get(id);
    const susp = hidden.has(it.ref);
    if (!old) { upserts.push({ id, lessonId: lesson.id, ref: it.ref, srs: newSrs(today), log: [], suspended: susp, ...(susp ? { suspendedReason: 'hidden' } : {}) }); continue; }
    const reason = susp ? 'hidden' : undefined;
    if (!!old.suspended !== susp || old.suspendedReason !== reason) {
      const c = { ...old, suspended: susp };
      if (reason) c.suspendedReason = reason; else delete c.suspendedReason;
      upserts.push(c);
    }
  }
  for (const c of existing) if (!want.has(c.id) && !c.suspended) upserts.push({ ...c, suspended: true, suspendedReason: 'removed' });
  return upserts;
}

/**
 * v1 카드(crd_<수업>_<항목>_<방향>) → v2 카드(crd_<수업>_<항목>) 이전. 같은 항목의 기록을 합치고 가장 긴 간격을 이어받는다.
 * @returns {{cards: object[], removeIds: string[]}}
 */
export function migrateLegacyCards(oldCards, today) {
  const groups = new Map();
  for (const c of oldCards) {
    if (!c.source?.itemId || !c.source?.lessonId) continue;
    const id = cardId(c.source.lessonId, c.source.itemId);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(c);
  }
  const g = (x) => (x < 3 ? 1 : x === 3 ? 3 : x === 4 ? 4 : 5);
  const cards = [];
  for (const [id, list] of groups) {
    const best = list.reduce((a, b) => ((b.srs?.intervalDays || 0) > (a.srs?.intervalDays || 0) ? b : a));
    const log = list.flatMap((c) => (c.log || []).map((l) => ({ at: l.at, grade: g(l.grade), type: c.direction === 'cloze' ? 'cloze' : 'meaning' })))
      .sort((a, b) => a.at.localeCompare(b.at));
    cards.push({ id, lessonId: list[0].source.lessonId, ref: list[0].source.itemId, srs: fromLegacy(best.srs, today), log, suspended: list.every((c) => c.suspended) });
  }
  return { cards, removeIds: oldCards.map((c) => c.id) };
}

const tsvCell = (s) => String(s ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' / ').trim();

/** Anki 호환 TSV (항목, 뜻·설명, 태그) */
export function toAnkiTsv(lessons) {
  const rows = [];
  for (const l of lessons) for (const it of lessonItems(l)) {
    const back = it.kind === 'cor' ? [`❌ ${it.item.original}`, it.item.natural && `✨ ${it.item.natural}`, it.sub].filter(Boolean).join(' / ')
      : it.kind === 'up' ? [`내가 한 말: ${it.item.original}`, it.sub].filter(Boolean).join(' / ') : it.sub;
    rows.push([tsvCell(it.main), tsvCell(back), `${l.id} ${KIND_LABEL[it.kind].replace(/\s/g, '_')}`].join('\t'));
  }
  return ['#separator:tab', '#html:false', '#tags column:3', ...rows].join('\n') + '\n';
}
