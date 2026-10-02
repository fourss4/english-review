// 데이터 스키마 마이그레이션 (AGENTS.md 원칙 3)
// 스키마를 바꿀 때: CURRENT_SCHEMA를 올리고, STEPS[이전버전]에 변환 함수를 추가한 뒤
// 구 버전 샘플(samples/)로 복원 테스트를 유지한다.

export const CURRENT_SCHEMA = 1;

/** STEPS[kind][n] : 버전 n → n+1 변환 */
const STEPS = {
  lesson: {},
  cards: {},
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
