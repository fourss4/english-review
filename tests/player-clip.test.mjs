// 표현 구간 재생 범위 계산 (v0.8.1)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipRange } from '../app/js/player.js';

const segs = [
  { start: 10, end: 12, text: 'short' },
  { start: 12.5, end: 16, text: 'next' },
  { start: 30, end: 60, text: 'very long line' },
];

test('구간: 해당 줄이 짧으면 다음 줄까지, 앞 1초·뒤 1.5초 여유', () => {
  assert.deepEqual(clipRange(10.5, segs), { start: 9.5, end: 17.5 });
});

test('구간: 최대 20초, 스크립트 없으면 8초', () => {
  assert.deepEqual(clipRange(31, segs), { start: 30, end: 50 });
  assert.deepEqual(clipRange(0.3, []), { start: 0, end: 8.3 });
  assert.deepEqual(clipRange(20, segs), { start: 19, end: 39 }, '줄 사이 위치면 다음 줄 기준(최대 20초)');
});
