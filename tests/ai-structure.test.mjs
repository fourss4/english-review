import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { maskPersonal, buildStructurePrompt, extractJson, validateStructure, mergeStructure } from '../app/js/ai-structure.js';
import { buildLesson, validateLesson } from '../app/js/parser/langdy-v1.js';
import { lessonItems } from '../app/js/cards.js';
import { migrate } from '../app/js/migrations.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const chat2 = read('samples/raw/lesson-demo-02/chat.txt');
const aiOut = read('samples/ai/lesson-demo-02-structure.json');

test('기호 없는 채팅은 규칙만으로는 교정 0개 (AI 보조가 필요한 상황)', () => {
  const { lesson } = buildLesson({ chat: chat2, comment: '' });
  assert.equal(lesson.corrections.length, 0);
});

test('개인정보 가리기: 이메일·전화·URL·@아이디·지정 이름', () => {
  const { text, count } = maskPersonal('Hi Jenny! mail me a@b.com, call 010-1234-5678, see https://x.io/p @tutor_kim. jenny says hi', ['Jenny']);
  assert.equal(text, 'Hi [NAME]! mail me [EMAIL], call [PHONE], see [URL] [ID]. [NAME] says hi');
  assert.equal(count, 6);
  assert.equal(maskPersonal('I was born in 1999 and slept 8 hours').count, 0);
});

test('요청 문장: 주석 제거, 원문 삽입', () => {
  const p = buildStructurePrompt(read('app/prompts/chat-structure.md'), { chat: 'CHAT_TEXT', comment: '' });
  assert.ok(!p.includes('<!--') && !p.includes('{{'));
  assert.match(p, /CHAT:\nCHAT_TEXT\n\nCOMMENT:\n\(none\)/);
});

test('AI 답변에서 JSON 꺼내기 (설명 문장·코드블록 포함)', () => {
  const j = extractJson(aiOut);
  assert.equal(j.kind, 'lesson_structure');
  assert.throws(() => extractJson('죄송합니다, 이해하지 못했습니다'), /JSON을 찾지 못했습니다/);
  assert.throws(() => extractJson('{ "a": 1, }'), /형식이 올바르지 않습니다/);
});

test('검증: 빈 교정 제외·다른 종류 거부·빈 결과 거부', () => {
  const { data, warnings } = validateStructure(extractJson(aiOut));
  assert.equal(data.corrections.length, 2);
  assert.match(warnings[0], /1개는 제외/);
  assert.throws(() => validateStructure({ kind: 'expression_upgrade' }), /다른 종류/);
  assert.throws(() => validateStructure({ corrections: [] }), /찾은 항목이 없습니다/);
  assert.throws(() => validateStructure({ corrections: 'x' }), /목록 형식/);
});

test('병합: 기호 없는 수업에 교정·표현·한국어 뜻 채우기 → 카드 생성', () => {
  const { lesson } = buildLesson({ chat: chat2, comment: '', fallbackDate: '2026-10-03' });
  const { data } = validateStructure(extractJson(aiOut));
  const r = mergeStructure(lesson, data, { now: new Date('2026-10-03T00:00:00Z') });
  assert.deepEqual(r.added, { corrections: 2, expressions: 1 });
  const key = r.lesson.expressions.find((e) => e.isKey);
  assert.equal(key.text, "It's up to you");
  assert.equal(key.meaning, '너에게 달려 있어 / 네가 정해');
  assert.equal(key.examples[0].ko, '어디서 먹을까?');
  assert.deepEqual(r.lesson.corrections.map((c) => c.id), ['cor_01', 'cor_02']);
  assert.equal(r.lesson.source.aiAssisted.at, '2026-10-03T00:00:00.000Z');
  assert.deepEqual(validateLesson(r.lesson), []);
  const v2 = migrate('lesson', r.lesson);
  assert.deepEqual(lessonItems(v2).map((x) => x.ref), ['cor_01', 'cor_02', 'exp_01', 'exp_02']);
  assert.equal(v2.expressions.find((e) => e.isKey).meaningKo, '너에게 달려 있어 / 네가 정해');
  assert.equal(lesson.corrections.length, 0, '원본 draft는 바뀌지 않음');
});

test('병합: 이미 있는 교정·표현은 중복 추가하지 않고 빈 칸만 채움, 사용자 입력 유지', () => {
  const { lesson } = buildLesson({
    chat: read('samples/raw/lesson-demo-01/chat.txt'), comment: read('samples/raw/lesson-demo-01/comment.txt'),
  });
  lesson.corrections[0].explanation = '내가 직접 쓴 설명';
  const data = {
    keyExpressions: [{ text: 'take your time', meaningKo: '천천히 하세요' }],
    expressions: [],
    corrections: [{ original: 'I always hurry when I eat lunch at my office', corrected: 'x', explanation: 'AI 설명', naturalKo: '나는 항상 점심을 서둘러 먹는다' }],
  };
  const r = mergeStructure(lesson, data);
  assert.deepEqual(r.added, { corrections: 0, expressions: 0 });
  assert.equal(r.lesson.corrections[0].explanation, '내가 직접 쓴 설명');
  assert.equal(r.lesson.corrections[0].naturalKo, '나는 항상 점심을 서둘러 먹는다');
  assert.equal(r.lesson.expressions[0].meaning, '천천히 하세요');
  assert.equal(r.filled, 2);
});
