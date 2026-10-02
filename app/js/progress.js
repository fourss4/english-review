// 학습 기록(카드의 간격·풀이 이력) 내보내기/가져오기 (schema/progress.schema.json, ADR 0007). DOM 비의존.
// 수업 내용·녹음은 PC의 수업 패키지로 다시 가져올 수 있으므로 여기에는 넣지 않는다.

export const PROGRESS_FORMAT = 'english-review-progress';

const lastAt = (c) => (c.log?.length ? c.log[c.log.length - 1].at : '');

function cleanCard(c) {
  const o = { id: c.id, lessonId: c.lessonId, ref: c.ref, srs: c.srs, log: c.log || [] };
  if (c.wrong) o.wrong = c.wrong;
  if (c.suspended) o.suspended = true;
  return o;
}

export function exportProgress(cards, { appVersion = '', now = new Date() } = {}) {
  return {
    format: PROGRESS_FORMAT, schemaVersion: 2, exportedAt: now.toISOString(), appVersion,
    cards: cards.filter((c) => c.srs?.algorithm === 'srs2' && c.lessonId).map(cleanCard),
  };
}

/** 가져온 JSON 검사. 잘못된 카드는 건너뛰고 개수를 알려 준다 */
export function parseProgress(obj) {
  if (obj?.format !== PROGRESS_FORMAT) throw new Error('학습 기록 파일이 아닙니다.');
  if (obj.schemaVersion !== 2) throw new Error(`지원하지 않는 학습 기록 버전입니다(${obj.schemaVersion}).`);
  if (!Array.isArray(obj.cards)) throw new Error('카드 목록이 없습니다.');
  const ok = [];
  let skipped = 0;
  for (const c of obj.cards) {
    const valid = c && /^crd_[A-Za-z0-9_]+$/.test(c.id) && typeof c.lessonId === 'string' && typeof c.ref === 'string'
      && c.srs?.algorithm === 'srs2' && /^\d{4}-\d{2}-\d{2}$/.test(c.srs.due) && Array.isArray(c.log)
      && c.log.every((l) => typeof l.at === 'string' && Number.isInteger(l.grade));
    if (valid) ok.push(c); else skipped++;
  }
  return { cards: ok, skipped, exportedAt: obj.exportedAt };
}

/**
 * 기기 카드와 합치기: 풀이 이력은 합집합, 간격·오답 표시는 마지막 풀이가 더 최근인 쪽을 따른다.
 * 보류(suspended) 여부는 기기 쪽 수업 상태를 따른다.
 * @returns {{upserts: object[], added: number, updated: number}}
 */
export function mergeProgress(existing, incoming) {
  const byId = new Map(existing.map((c) => [c.id, c]));
  const upserts = [];
  let added = 0, updated = 0;
  for (const inc of incoming) {
    const cur = byId.get(inc.id);
    if (!cur) { upserts.push(cleanCard(inc)); added++; continue; }
    const seen = new Set();
    const log = [...(cur.log || []), ...inc.log].filter((l) => { const k = `${l.at}|${l.grade}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => a.at.localeCompare(b.at));
    if (log.length === (cur.log || []).length) continue; // 새 기록 없음
    const newer = lastAt(inc) > lastAt(cur) ? inc : cur;
    const c = { ...cur, log, srs: newer.srs };
    if (newer.wrong) c.wrong = newer.wrong; else delete c.wrong;
    upserts.push(c); updated++;
  }
  return { upserts, added, updated };
}
