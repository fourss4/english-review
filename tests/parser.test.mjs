import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLesson, parseChat, parseFileName, validateLesson } from '../app/js/parser/langdy-v1.js';
import { similarity, containsFuzzy, findSuspiciousWords, normalizeText } from '../app/js/text.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const strip = (l) => { const c = structuredClone(l); delete c.source.importedAt; delete c.source.raw; return c; };

test('합성 샘플 → 기대 결과와 일치', () => {
  const expected = JSON.parse(read('samples/normalized/les_20260101_01/lesson.json'));
  const { lesson, report } = buildLesson({
    fileName: expected.audio.originalFileName,
    chat: read('samples/raw/lesson-demo-01/chat.txt'),
    comment: read('samples/raw/lesson-demo-01/comment.txt'),
    now: new Date('2026-01-02T08:00:00Z'),
  });
  assert.deepEqual(strip(lesson), strip(expected));
  assert.deepEqual(validateLesson(lesson), []);
  assert.deepEqual(report.unmatchedCommentParagraphs, []);
  assert.deepEqual(report.ignoredChatLines, ['Hello! See you in a minute :)']);
});

test('원문은 source.raw에 보존', () => {
  const { lesson } = buildLesson({ chat: 'a', comment: 'b' });
  assert.deepEqual(lesson.source.raw, { chat: 'a', comment: 'b' });
});

test('파일명: 접두어 없음 / 있음 / 형식 불일치', () => {
  assert.deepEqual(parseFileName('과정 - 1 제목 있음.m4a.mp4'),
    { originalFileName: '과정 - 1 제목 있음.m4a.mp4', course: '과정', lessonNo: 1, title: '제목 있음' });
  assert.equal(parseFileName('x_260928_과정 - 12 제목.mp4').date, '2026-09-28');
  assert.equal(parseFileName('그냥녹음.mp4').title, '그냥녹음');
});

test('채팅: 콜론 뒤 공백 없음·둥근 따옴표·✅ 누락 경고', () => {
  const r = parseChat('Key\n❌: bad one\n💡:Use “x”\nKey');
  assert.equal(r.corrections[0].explanation, 'Use "x"');
  assert.equal(r.keyExpression, 'Key');
  assert.match(r.warnings[0], /✅ 줄 없음/);
});

test('OCR 오탈자가 있어도 같은 문장으로 매칭', () => {
  assert.ok(similarity('I think thev are rude', 'I think they are rude') > 0.8);
  assert.ok(containsFuzzy('blah blah. I don\'t feel lonelv easily. more', "I don't feel lonely easily."));
  assert.ok(!containsFuzzy('completely different text here', 'I always rush through lunch.'));
});

test('OCR 의심 단어 표시', () => {
  assert.deepEqual(findSuspiciousWords('clearlv evervday qenera meaniną have queen').sort(), ['clearlv', 'evervday', 'meaniną', 'qenera'].sort());
});

test('검증: 필수값 누락 탐지', () => {
  assert.ok(validateLesson({ schemaVersion: 1, id: 'x', date: 'no', expressions: [], corrections: [{ original: 'a' }], chat: [] }).length >= 3);
});

test('정규화: 따옴표·공백', () => {
  assert.equal(normalizeText('  “a”  ‘b’ \r\n'), '"a" \'b\'');
});
