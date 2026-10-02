// 수업 전체 검색 (표현·교정·업그레이드·스크립트·채팅 원문). v1·v2 수업 모두 지원. DOM 비의존.
import { normalizeText } from './text.js';

const norm = (s) => normalizeText(s).toLowerCase();

/** 한 수업에서 검색 대상이 되는 텍스트 목록 */
export function searchableFields(lesson) {
  const f = [];
  const add = (label, text, itemId) => { if (text && String(text).trim()) f.push({ label, text: String(text), itemId }); };
  add('제목', [lesson.course, lesson.title].filter(Boolean).join(' · '));
  for (const e of lesson.expressions || []) {
    add(e.isKey ? '핵심 표현' : '표현', [e.text, e.meaningKo || e.meaning, e.pattern, e.definition].filter(Boolean).join(' — '), e.id);
    for (const x of e.examples || []) add('예문', [x.en, x.ko].filter(Boolean).join(' — '), e.id);
  }
  for (const c of lesson.corrections || []) {
    add('틀린 문장', c.original, c.id);
    add('교정', c.corrected, c.id);
    add('더 자연스러운 표현', c.natural, c.id);
    add('이유', c.explanationKo || c.explanation, c.id);
    add('해설', c.explanationLong, c.id);
  }
  for (const u of lesson.upgrades || []) {
    add('표현 업그레이드', [u.suggestion, u.meaningKo].filter(Boolean).join(' — '), u.id);
    add('내가 한 말', u.original, u.id);
    for (const x of u.examples || []) add('예문', [x.en, x.ko].filter(Boolean).join(' — '), u.id);
  }
  add('강사 총평', lesson.feedback?.summary);
  for (const sg of lesson.transcript?.segments || []) add('스크립트', sg.text);
  for (const line of (lesson.source?.raw?.chat || '').split(/\r?\n/)) add('채팅 원문', line);
  return f;
}

/** 일치 위치(정규화 기준 문자열에서) */
function findRanges(textNorm, terms) {
  const ranges = [];
  for (const t of terms) {
    let i = textNorm.indexOf(t);
    while (i >= 0) { ranges.push([i, i + t.length]); i = textNorm.indexOf(t, i + t.length); }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([...r]);
  }
  return merged;
}

/**
 * 공백으로 나눈 모든 단어가 들어 있는 필드를 찾는다(AND).
 * 반환 텍스트는 정규화된 문자열이며 ranges는 그 기준 위치.
 * @returns {{lesson:object, hits:{label:string, text:string, ranges:number[][], itemId?:string}[]}[]}
 */
export function searchLessons(lessons, query, { maxHitsPerLesson = 20 } = {}) {
  const terms = [...new Set(norm(query).split(/\s+/).filter(Boolean))];
  if (!terms.length || terms.join('').length < 2) return [];
  const out = [];
  for (const lesson of lessons) {
    if (lesson.deletedAt) continue;
    const hits = [];
    const seen = new Set();
    for (const f of searchableFields(lesson)) {
      const text = normalizeText(f.text);
      const low = text.toLowerCase();
      if (!terms.every((t) => low.includes(t))) continue;
      const key = `${f.label}|${low}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ label: f.label, text, ranges: findRanges(low, terms), ...(f.itemId ? { itemId: f.itemId } : {}) });
      if (hits.length >= maxHitsPerLesson) break;
    }
    if (hits.length) out.push({ lesson, hits });
  }
  return out.sort((a, b) => b.lesson.date.localeCompare(a.lesson.date));
}

/** 하이라이트 표시용 조각 [{text, hit}] */
export function splitByRanges(text, ranges) {
  const parts = [];
  let pos = 0;
  for (const [a, b] of ranges) {
    if (a > pos) parts.push({ text: text.slice(pos, a), hit: false });
    parts.push({ text: text.slice(a, b), hit: true });
    pos = b;
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), hit: false });
  return parts;
}
