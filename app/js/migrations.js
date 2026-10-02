// 데이터 스키마 마이그레이션 (AGENTS.md 원칙 3)
// 스키마를 바꿀 때: CURRENT_SCHEMA를 올리고, STEPS[이전버전]에 변환 함수를 추가한 뒤
// 구 버전 샘플(samples/)로 변환 테스트를 유지한다.

export const CURRENT_SCHEMA = 2;

const keep = (o, k, v) => { if (typeof v === 'string' && v.trim()) o[k] = v.trim(); };

/** 수업 v1(앱에서 기호 파싱) → v2(처리기 형식). 강사 총평 칸은 없애고 원문(source.raw)은 유지 */
function lessonV1toV2(l) {
  const out = {
    schemaVersion: 2, id: l.id, date: l.date,
    ...(l.course ? { course: l.course } : {}), ...(Number.isInteger(l.lessonNo) ? { lessonNo: l.lessonNo } : {}),
    ...(l.title ? { title: l.title } : {}), ...(l.durationSec ? { durationSec: l.durationSec } : {}),
    ...(l.audio ? { audio: l.audio } : {}),
    corrections: (l.corrections || []).map((c) => {
      const o = { id: c.id, original: c.original || '', corrected: c.corrected || '' };
      keep(o, 'natural', c.natural);
      keep(o, 'explanationKo', [c.explanation, c.explanationLong].filter(Boolean).join('\n'));
      keep(o, 'meaningKo', c.naturalKo || c.meaningKo);
      return o;
    }).filter((c) => c.corrected.trim()),
    expressions: (l.expressions || []).map((e) => {
      const o = { id: e.id, text: e.text };
      if (e.isKey) o.isKey = true;
      keep(o, 'pattern', e.pattern);
      keep(o, 'definition', e.definition);
      keep(o, 'meaningKo', e.meaning || e.meaningKo);
      if (Array.isArray(e.examples) && e.examples.length) o.examples = e.examples.slice(0, 10);
      return o;
    }).filter((e) => e.text?.trim()),
    upgrades: [], exercises: [],
    source: { ...(l.source || {}), migratedFrom: 1 },
  };
  if (Array.isArray(l.hidden)) out.hidden = l.hidden;
  if (l.deletedAt) out.deletedAt = l.deletedAt;
  return out;
}

/** STEPS[kind][n] : 버전 n → n+1 변환 */
const STEPS = {
  lesson: { 1: lessonV1toV2 },
};

export function migrate(kind, obj, fromVersion = obj?.schemaVersion ?? 1) {
  let v = fromVersion;
  let cur = obj;
  while (v < CURRENT_SCHEMA) {
    const step = STEPS[kind]?.[v];
    if (!step) throw new Error(`${kind} v${v} → v${v + 1} 마이그레이션이 없습니다.`);
    cur = step(cur);
    v += 1;
  }
  return cur;
}
