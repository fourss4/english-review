// 간격반복 srs2 (SM-2 변형, ADR 0007). DOM 비의존.
// 버튼: 다시=1, 어려움=3, 보통=4, 쉬움=5
// - 처음(또는 다시 후) 맞힘: 어려움 1일 / 보통 3일 / 쉬움 5일
// - 이후: 어려움 ×1.2, 보통 ×ease, 쉬움 ×ease×1.3 (최소 +1일, 버튼 사이 최소 1일 차이)
// - 다시: 오늘 다시(같은 세션 끝에 재출제), ease −0.2

export const GRADES = [
  { grade: 1, label: '다시' },
  { grade: 3, label: '어려움' },
  { grade: 4, label: '보통' },
  { grade: 5, label: '쉬움' },
];
const FIRST = { 3: 1, 4: 3, 5: 5 };
const EASE_DELTA = { 1: -0.2, 3: -0.15, 4: 0, 5: 0.15 };
const EASE_MIN = 1.3, EASE_MAX = 3.0;

/** 기기 현지 날짜 YYYY-MM-DD */
export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + days));
}

export function newSrs(today) {
  return { algorithm: 'srs2', ease: 2.5, intervalDays: 0, reps: 0, lapses: 0, due: today };
}

/** 이전 SM-2(v1) 상태를 srs2로 변환 */
export function fromLegacy(srs, today) {
  if (!srs || srs.algorithm === 'srs2') return srs || newSrs(today);
  return { algorithm: 'srs2', ease: Math.min(EASE_MAX, Math.max(EASE_MIN, srs.ease || 2.5)), intervalDays: srs.intervalDays || 0, reps: srs.reps || 0, lapses: 0, due: srs.due || today };
}

/** 평가 결과로 다음 상태 계산(원본 불변) */
export function review(srs, grade, today) {
  if (![1, 3, 4, 5].includes(grade)) throw new RangeError('grade must be 1, 3, 4 or 5');
  let { ease, intervalDays, reps, lapses = 0 } = srs;
  ease = Math.round(Math.min(EASE_MAX, Math.max(EASE_MIN, ease + EASE_DELTA[grade])) * 100) / 100;
  if (grade === 1) {
    return { algorithm: 'srs2', ease, intervalDays: 0, reps: 0, lapses: lapses + 1, due: today };
  }
  let next;
  if (reps === 0 || intervalDays === 0) next = FIRST[grade];
  else {
    // 버튼끼리 간격이 같아 보이지 않도록 어려움 < 보통 < 쉬움을 최소 1일씩 벌린다
    const hard = Math.max(intervalDays + 1, Math.round(intervalDays * 1.2));
    const good = Math.max(hard + 1, Math.round(intervalDays * srs.ease));
    const easy = Math.max(good + 1, Math.round(intervalDays * srs.ease * 1.3));
    next = grade === 3 ? hard : grade === 4 ? good : easy;
  }
  return { algorithm: 'srs2', ease, intervalDays: next, reps: reps + 1, lapses, due: addDays(today, next) };
}

/** 버튼 아래 "n일 후" 미리보기 */
export function previewIntervals(srs, today) {
  return Object.fromEntries(GRADES.map(({ grade }) => [grade, review(srs, grade, today).intervalDays]));
}

export const isNew = (card) => !card.log || card.log.length === 0;

/** 오늘의 복습 대기열: 예정일이 지난 카드(오래된 순) + 새 카드(최대 newLimit, 오래된 수업 순) */
export function buildQueue(cards, today, { newLimit = 20 } = {}) {
  const active = cards.filter((c) => !c.suspended);
  const due = active.filter((c) => !isNew(c) && c.srs.due <= today).sort((a, b) => a.srs.due.localeCompare(b.srs.due));
  const fresh = active.filter(isNew).sort((a, b) => a.id.localeCompare(b.id)).slice(0, newLimit);
  return [...due, ...fresh];
}

/** 오답 복습 대기열: 틀린 표시가 남아 있는 카드(오래된 오답부터) */
export function buildWrongQueue(cards) {
  return cards.filter((c) => !c.suspended && c.wrong).sort((a, b) => a.wrong.since.localeCompare(b.wrong.since));
}
