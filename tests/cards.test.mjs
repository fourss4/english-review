// 간격반복 srs2 · 카드 v2 · 문제 선택/채점 (ADR 0007)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { review, newSrs, buildQueue, buildWrongQueue, addDays, previewIntervals, fromLegacy } from '../app/js/srs.js';
import {
  cardId, lessonItems, makeCloze, correctionCloze, fallbackExercises, variantsFor, pickVariant, checkTyped,
  syncLessonCards, migrateLegacyCards, toAnkiTsv,
} from '../app/js/cards.js';
import { migrate } from '../app/js/migrations.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const v2 = read('samples/normalized/les_20260928_01/lesson.json');
const v1 = read('samples/normalized/les_20260101_01/lesson.json');
const T = '2026-10-02';

test('srs2: 첫 정답 간격이 버튼마다 다름(어려움 1 / 보통 3 / 쉬움 5)', () => {
  assert.deepEqual(previewIntervals(newSrs(T), T), { 1: 0, 3: 1, 4: 3, 5: 5 });
  const s = review(newSrs(T), 4, T);
  assert.equal(s.due, '2026-10-05');
  assert.equal(s.reps, 1);
});

test('srs2: 이후 간격 성장, 다시 = 오늘·ease 감소·lapses 증가', () => {
  let s = review(newSrs(T), 4, T); // 3일
  const pv = previewIntervals(s, T);
  assert.ok(pv[3] < pv[4] && pv[4] < pv[5], JSON.stringify(pv));
  assert.equal(pv[4], 8); // 3 × 2.5 = 7.5 → 8
  assert.deepEqual(previewIntervals({ ...s, intervalDays: 1 }, T), { 1: 0, 3: 2, 4: 3, 5: 4 }, '짧은 간격에서도 버튼마다 다름');
  s = review(s, 4, T);
  const f = review(s, 1, T);
  assert.deepEqual([f.intervalDays, f.reps, f.lapses, f.due], [0, 0, 1, T]);
  assert.equal(f.ease, 2.3);
  assert.equal(review(f, 3, T).intervalDays, 1); // 다시 후 첫 정답은 처음 간격
  assert.ok(review({ ...s, ease: 1.3 }, 1, T).ease >= 1.3);
  assert.ok(review({ ...s, ease: 3.0 }, 5, T).ease <= 3.0);
  assert.throws(() => review(s, 2, T));
  assert.throws(() => review(s, 0, T));
});

test('날짜 계산: 월말·연말 넘김', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
});

test('구 SM-2 상태 변환', () => {
  const s = fromLegacy({ algorithm: 'sm2', ease: 3.4, intervalDays: 6, reps: 2, due: '2026-10-08' }, T);
  assert.deepEqual(s, { algorithm: 'srs2', ease: 3.0, intervalDays: 6, reps: 2, lapses: 0, due: '2026-10-08' });
});

test('카드 = 학습 항목 1개, 숨긴 항목은 보류, 기존 기록 유지', () => {
  const cards = syncLessonCards(v2, [], T);
  assert.equal(cards.length, 7);
  assert.ok(cards.every((c) => c.id === cardId(v2.id, c.ref) && c.srs.algorithm === 'srs2' && !c.suspended));
  assert.equal(cards[0].id, 'crd_20260928_01_cor_01');
  const studied = cards.map((c) => (c.ref === 'up_01' ? { ...c, log: [{ at: 'x', grade: 4 }], srs: review(c.srs, 4, T) } : c));
  const hidden = { ...v2, hidden: ['up_01'], upgrades: v2.upgrades.filter((u) => u.id !== 'up_03') };
  const ups = syncLessonCards(hidden, studied, T);
  const up1 = ups.find((c) => c.ref === 'up_01');
  assert.equal(up1.suspended, true); assert.equal(up1.suspendedReason, 'hidden'); assert.equal(up1.log.length, 1);
  assert.equal(ups.find((c) => c.ref === 'up_03').suspendedReason, 'removed');
  assert.equal(ups.length, 2, '바뀐 카드만 저장');
  const back = syncLessonCards(v2, [...studied.filter((c) => !['up_01', 'up_03'].includes(c.ref)), ...ups], T);
  assert.ok(back.every((c) => !c.suspended) && back.length === 2);
  assert.deepEqual(syncLessonCards(v2, cards, T), [], '변화 없으면 저장 없음');
});

test('대기열: 예정 카드 + 새 카드 한도, 오답 대기열', () => {
  const cards = syncLessonCards(v2, [], T);
  cards[0] = { ...cards[0], log: [{ at: 'a', grade: 4 }], srs: { ...cards[0].srs, due: '2026-10-01', intervalDays: 3, reps: 1 } };
  cards[1] = { ...cards[1], log: [{ at: 'a', grade: 4 }], srs: { ...cards[1].srs, due: '2026-10-09', intervalDays: 3, reps: 1 } };
  cards[2] = { ...cards[2], wrong: { since: '2026-10-01T00:00:00Z', lastType: 'cloze' } };
  cards[3] = { ...cards[3], wrong: { since: '2026-09-30T00:00:00Z', lastType: 'choice' }, suspended: true };
  const q = buildQueue(cards, T, { newLimit: 2 });
  assert.deepEqual(q.map((c) => c.ref), ['cor_01', 'exp_01', 'up_01']);
  assert.deepEqual(buildWrongQueue(cards).map((c) => c.ref), ['exp_01']);
});

test('문제 선택: 덜 쓴 유형 우선, 오답 복습은 마지막에 틀린 유형 피함', () => {
  const vs = variantsFor(v2, 'cor_01');
  assert.deepEqual(vs.map((v) => v.type).sort(), ['choice', 'cloze']);
  const card = { log: [{ at: '2026-10-01T00:00:00Z', grade: 4, type: 'choice' }] };
  assert.equal(pickVariant(card, vs).type, 'cloze');
  assert.equal(pickVariant({ log: [] }, vs, { avoidType: 'cloze' }).type, 'choice');
  const only = vs.filter((v) => v.type === 'cloze');
  assert.equal(pickVariant({ log: [] }, only, { avoidType: 'cloze' }).type, 'cloze', '다른 유형이 없으면 같은 유형');
  assert.equal(pickVariant({}, []), null);
});

test('빈칸 채점: 대소문자·문장부호 무시, accept, 오타 근접', () => {
  const ex = { answer: "other people's", accept: ["others'"] };
  assert.deepEqual(checkTyped(ex, "Other people's."), { correct: true, close: false });
  assert.equal(checkTyped(ex, "others'").correct, true);
  assert.deepEqual(checkTyped(ex, 'other peoples'), { correct: false, close: true });
  assert.deepEqual(checkTyped(ex, 'their'), { correct: false, close: false });
  assert.equal(checkTyped({ answer: 'called it a day' }, 'called it a day').correct, true);
  assert.equal(checkTyped({ answer: 'I’m beat' }, "i'm beat").correct, true);
});

test('기본 문제(AI 문제가 없는 구버전 수업)', () => {
  const l = migrate('lesson', v1);
  const cor = fallbackExercises(l, 'cor_02');
  assert.deepEqual(cor.map((x) => x.type), ['choice', 'cloze']);
  assert.equal(cor[1].prompt, 'My hobby is watching _____ the weekend.');
  assert.equal(cor[1].answer, 'movies on');
  assert.ok(cor[0].options.includes(cor[0].answer));
  const exp = fallbackExercises(l, 'exp_01');
  assert.equal(exp[0].type, 'cloze');
  assert.equal(exp[0].prompt, 'No worries. _____.');
  assert.deepEqual(variantsFor(l, 'exp_02').map((x) => x.type), ['cloze', 'meaning']);
  assert.equal(makeCloze('xy', []), null);
  assert.equal(correctionCloze('a b c d e f', 'q w e r t y u'), null, '너무 많이 바뀌면 빈칸 문제 없음');
});

test('v1 카드 → v2 이전: 항목별로 합치고 긴 간격·기록 유지', () => {
  const old = [
    { id: 'crd_20260101_01_exp_01_en2ko', direction: 'en2ko', source: { lessonId: 'les_20260101_01', itemId: 'exp_01' },
      srs: { algorithm: 'sm2', ease: 2.6, intervalDays: 6, reps: 2, due: '2026-10-05' }, log: [{ at: '2026-09-20T00:00:00Z', grade: 4 }] },
    { id: 'crd_20260101_01_exp_01_cloze', direction: 'cloze', source: { lessonId: 'les_20260101_01', itemId: 'exp_01' },
      srs: { algorithm: 'sm2', ease: 2.5, intervalDays: 1, reps: 1, due: '2026-10-02' }, log: [{ at: '2026-09-21T00:00:00Z', grade: 2 }] },
  ];
  const { cards, removeIds } = migrateLegacyCards(old, T);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, 'crd_20260101_01_exp_01');
  assert.equal(cards[0].srs.intervalDays, 6);
  assert.deepEqual(cards[0].log.map((l) => [l.grade, l.type]), [[4, 'meaning'], [1, 'cloze']]);
  assert.deepEqual(removeIds, old.map((c) => c.id));
});

test('Anki TSV', () => {
  const tsv = toAnkiTsv([v2]);
  const rows = tsv.trim().split('\n');
  assert.equal(rows[0], '#separator:tab');
  assert.equal(rows.length, 3 + lessonItems(v2).length);
  assert.ok(rows.every((r) => r.startsWith('#') || r.split('\t').length === 3));
});
