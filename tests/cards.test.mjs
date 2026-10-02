import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { review, newSrs, buildQueue, addDays, previewIntervals } from '../app/js/srs.js';
import { cardsForLesson, syncLessonCards, toAnkiTsv, makeCloze } from '../app/js/cards.js';
import { wordDiff } from '../app/js/text.js';

const lesson = JSON.parse(readFileSync(new URL('../samples/normalized/les_20260101_01/lesson.json', import.meta.url), 'utf8'));
const T = '2026-10-02';

test('SM-2: 첫 정답 1일 → 6일 → interval×ease, 오답은 초기화', () => {
  let s = newSrs(T);
  s = review(s, 4, T); assert.equal(s.intervalDays, 1); assert.equal(s.due, '2026-10-03');
  s = review(s, 4, T); assert.equal(s.intervalDays, 6);
  s = review(s, 5, T); assert.equal(s.intervalDays, 15); assert.equal(s.ease, 2.6); // 간격은 직전 ease(2.5)로 계산 후 ease 갱신
  const f = review(s, 1, T); assert.equal(f.reps, 0); assert.equal(f.intervalDays, 1); assert.ok(f.ease < s.ease);
  assert.ok(review({ ...s, ease: 1.3 }, 0, T).ease >= 1.3);
  assert.throws(() => review(s, 6, T));
});

test('날짜 계산: 월말·연말 넘김', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
});

test('버튼 미리보기', () => { assert.deepEqual(previewIntervals(newSrs(T), T), { 1: 1, 3: 1, 4: 1, 5: 1 }); });

test('카드 생성: 한국어 없음 → en2def, 빈칸, 교정', () => {
  const cards = cardsForLesson(lesson);
  const dirs = cards.map((c) => `${c.source.itemId}:${c.direction}`).sort();
  assert.deepEqual(dirs, ['cor_01:fix', 'cor_02:fix', 'exp_01:cloze', 'exp_01:en2def', 'exp_02:cloze', 'exp_02:en2def'].sort());
  const cz = cards.find((c) => c.source.itemId === 'exp_02' && c.direction === 'cloze');
  assert.equal(cz.front, 'I always _____ lunch at the office.');
  assert.equal(cz.answer, 'rush through');
  assert.ok(cards.every((c) => /^crd_[A-Za-z0-9_]+$/.test(c.id)));
});

test('카드 생성: 한국어 뜻이 있으면 en2ko + ko2en', () => {
  const l = structuredClone(lesson); l.expressions[0].meaning = '천천히 하세요';
  const d = cardsForLesson(l).filter((c) => c.source.itemId === 'exp_01').map((c) => c.direction).sort();
  assert.deepEqual(d, ['cloze', 'en2ko', 'ko2en']);
});

test('빈칸: 괄호·어형 변화 허용', () => {
  assert.equal(makeCloze('raise (your) voice', [{ en: 'People raise their voices.' }]).answer, 'raise their voices');
  assert.equal(makeCloze("Don't mind me", [{ en: 'Feel free. Don’t mind me.' }]).front, 'Feel free. _____.');
  assert.equal(makeCloze('xyz abc', [{ en: 'nothing here' }]), null);
});

test('동기화: 학습 상태 유지, 내용 갱신, 삭제 항목은 보류', () => {
  const first = syncLessonCards(lesson, [], T).upserts;
  const studied = first.map((c) => ({ ...c, srs: review(c.srs, 4, T), log: [{ at: 'x', grade: 4 }] }));
  const edited = structuredClone(lesson);
  edited.corrections[0].corrected = 'I always rush through lunch.';
  edited.corrections.pop();
  const { upserts, suspends } = syncLessonCards(edited, studied, T);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].answer, 'I always rush through lunch.');
  assert.equal(upserts[0].log.length, 1);
  assert.deepEqual(suspends.map((c) => c.source.itemId), ['cor_02']);
  assert.equal(syncLessonCards(lesson, [...upserts, ...suspends, ...studied.filter((c) => !upserts.some((u) => u.id === c.id) && !suspends.some((s) => s.id === c.id))], T)
    .upserts.find((c) => c.source.itemId === 'cor_02').suspended, false);
});

test('대기열: 예정 카드 먼저, 새 카드 제한, 보류 제외', () => {
  const cs = syncLessonCards(lesson, [], T).upserts;
  cs[0] = { ...cs[0], log: [{ at: 'x', grade: 4 }], srs: { ...cs[0].srs, due: '2026-10-01' } };
  cs[1] = { ...cs[1], suspended: true };
  const q = buildQueue(cs, T, { newLimit: 2 });
  assert.equal(q[0].id, cs[0].id); assert.equal(q.length, 3);
});

test('Anki TSV: 탭·줄바꿈 처리, 헤더', () => {
  const tsv = toAnkiTsv([{ front: 'a\tb', back: 'x\ny', source: { lessonId: 'les_1' }, direction: 'fix' }]);
  assert.equal(tsv, '#separator:tab\n#html:false\n#tags column:3\na b\tx / y\tles_1 fix\n');
});

test('문장 비교: 대소문자·문장부호 무시, 누락/추가 표시', () => {
  const r = wordDiff('I make dinner for my boyfriend and me.', 'i make dinner for me and my boyfriend');
  assert.ok(r.score > 0.5 && r.score < 1);
  assert.equal(wordDiff('Hello, world.', 'hello world').score, 1);
  assert.ok(r.ops.some((o) => o.type === 'del') && r.ops.some((o) => o.type === 'add'));
});
