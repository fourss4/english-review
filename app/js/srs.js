// SM-2 간격반복 (SuperMemo 2 공개 알고리즘). DOM 비의존.
// grade: 0~5 (앱 버튼: 다시=1, 어려움=3, 보통=4, 쉬움=5)

export const GRADES = [
  { grade: 1, label: '다시' },
  { grade: 3, label: '어려움' },
  { grade: 4, label: '보통' },
  { grade: 5, label: '쉬움' },
];

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
  return { algorithm: 'sm2', ease: 2.5, intervalDays: 0, reps: 0, due: today };
}

/** 평가 결과로 다음 상태 계산(원본 불변) */
export function review(srs, grade, today) {
  if (!Number.isInteger(grade) || grade < 0 || grade > 5) throw new RangeError('grade 0~5');
  let { ease, intervalDays, reps } = srs;
  if (grade < 3) {
    reps = 0;
    intervalDays = 1;
  } else {
    intervalDays = reps === 0 ? 1 : reps === 1 ? 6 : Math.round(intervalDays * ease);
    reps += 1;
  }
  ease = Math.max(1.3, Math.round((ease + 0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)) * 100) / 100);
  return { algorithm: 'sm2', ease, intervalDays, reps, due: addDays(today, intervalDays) };
}

/** 버튼 아래 "다음 복습: n일 후" 미리보기 */
export function previewIntervals(srs, today) {
  return Object.fromEntries(GRADES.map(({ grade }) => [grade, review(srs, grade, today).intervalDays]));
}

export const isNew = (card) => !card.log || card.log.length === 0;

/**
 * 오늘의 복습 대기열: 예정일이 지난 카드(오래된 순) + 새 카드(최대 newLimit, 오래된 수업 순)
 */
export function buildQueue(cards, today, { newLimit = 20 } = {}) {
  const active = cards.filter((c) => !c.suspended);
  const due = active.filter((c) => !isNew(c) && c.srs.due <= today).sort((a, b) => a.srs.due.localeCompare(b.srs.due));
  const fresh = active.filter(isNew).sort((a, b) => a.id.localeCompare(b.id)).slice(0, newLimit);
  return [...due, ...fresh];
}
