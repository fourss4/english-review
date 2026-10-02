import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fmtClock, toVttTime, fromVttTime, bookmarksToVtt, parseVtt, loopTarget } from '../app/js/vtt.js';
import { searchLessons, splitByRanges } from '../app/js/search.js';

const lesson = JSON.parse(readFileSync(new URL('../samples/normalized/les_20260101_01/lesson.json', import.meta.url), 'utf8'));

test('시간 표기', () => {
  assert.equal(fmtClock(83.9), '01:23');
  assert.equal(fmtClock(3723), '1:02:03');
  assert.equal(toVttTime(83.5), '00:01:23.500');
  assert.equal(fromVttTime('00:01:23.500'), 83.5);
  assert.equal(fromVttTime('01:23.5'), 83.5);
  assert.ok(Number.isNaN(fromVttTime('abc')));
});

test('북마크 ↔ WebVTT 왕복 (id·순서·위험 문자 처리)', () => {
  const bms = [
    { id: 'bm_2', startSec: 90, endSec: 95.25, label: '두 번째 --> 구간' },
    { id: 'bm_1', startSec: 12.5, endSec: 20, label: 'weekend plans\n\n표현' },
  ];
  const vtt = bookmarksToVtt(bms);
  assert.match(vtt, /^WEBVTT\n\nNOTE id=bm_1\n\n00:00:12.500 --> 00:00:20.000\n/);
  const back = parseVtt(vtt);
  assert.deepEqual(back.map((c) => [c.id, c.startSec, c.endSec]), [['bm_1', 12.5, 20], ['bm_2', 90, 95.25]]);
  assert.equal(back[1].text, '두 번째 → 구간');
  assert.equal(back[0].text, 'weekend plans\n표현');
  assert.throws(() => parseVtt('not vtt'));
  const tagged = bookmarksToVtt([{ id: 'x', startSec: 0, endSec: 1, label: 'a <b>&</b>' }]);
  assert.match(tagged, /a &lt;b&gt;&amp;&lt;\/b&gt;/);
  assert.equal(parseVtt(tagged)[0].text, 'a <b>&</b>');
});

test('A-B 반복 판단', () => {
  const loop = { startSec: 10, endSec: 15 };
  assert.equal(loopTarget(12, loop), null);
  assert.equal(loopTarget(15.1, loop), 10);
  assert.equal(loopTarget(3, loop), 10);
  assert.equal(loopTarget(12, { startSec: 15, endSec: 10 }), null);
  assert.equal(loopTarget(12, null), null);
});

test('검색: 여러 단어 AND, 대소문자·따옴표 무시, 위치 표시', () => {
  const r = searchLessons([lesson], 'RUSH office');
  assert.equal(r.length, 1);
  const labels = r[0].hits.map((h) => h.label);
  assert.ok(labels.includes('틀린 문장') === false); // 원문에는 rush 없음
  assert.ok(labels.includes('교정') && labels.includes('더 자연스러운 표현'));
  const h = r[0].hits[0];
  assert.ok(h.ranges.length >= 2);
  assert.equal(splitByRanges(h.text, h.ranges).filter((p) => p.hit).map((p) => p.text.toLowerCase()).sort().join(','), 'office,rush');
});

test('검색: 1글자·삭제된 수업·없는 단어', () => {
  assert.deepEqual(searchLessons([lesson], 'a'), []);
  assert.deepEqual(searchLessons([{ ...lesson, deletedAt: 'x' }], 'rush'), []);
  assert.deepEqual(searchLessons([lesson], 'zzzz'), []);
});

test('검색: 채팅 원문·한국어 제목', () => {
  const l = structuredClone(lesson);
  l.source.raw = { chat: 'Hello! See you in a minute :)\nTake your time', comment: '' };
  const r = searchLessons([l], 'see you');
  assert.equal(r[0].hits[0].label, '채팅 원문');
  assert.equal(searchLessons([l], '천천히')[0].hits[0].label, '제목');
});
