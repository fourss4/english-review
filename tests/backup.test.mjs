import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { writeZip, readZip, crc32 } from '../app/js/zip.js';
import { createBackup, readBackup, isSafePath, BackupError } from '../app/js/backup.js';
import { syncLessonCards } from '../app/js/cards.js';

const lesson = JSON.parse(readFileSync(new URL('../samples/normalized/les_20260101_01/lesson.json', import.meta.url), 'utf8'));
const audio = new Blob([new Uint8Array(4096).map((_, i) => i % 251)], { type: 'audio/mp4' });
const cards = syncLessonCards(lesson, [], '2026-10-02').upserts;
const bookmarks = [{ id: 'bm_a1', lessonId: lesson.id, startSec: 1.5, endSec: 4, label: '연습 <구간> & 메모', createdAt: 'x' }];
const make = (o = {}) => createBackup({ lessons: [lesson], audios: new Map([[lesson.id, { blob: audio, mimeType: 'audio/mp4' }]]), cards, bookmarks, appVersion: '0.6.0', ...o });

test('CRC32 표준값', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('ZIP 쓰기 → 읽기 왕복 (한글 파일명 포함)', async () => {
  const z = await writeZip([{ name: 'a.txt', data: 'hello' }, { name: '폴더/b.bin', data: new Uint8Array([1, 2, 3]) }]);
  const es = await readZip(z);
  assert.deepEqual(es.map((e) => [e.name, e.size]), [['a.txt', 5], ['폴더/b.bin', 3]]);
  assert.equal(await (await es[0].blob()).text(), 'hello');
});

test('DEFLATE로 다시 압축된 ZIP도 읽기', async () => {
  const data = new TextEncoder().encode('deflate me '.repeat(50));
  const comp = deflateRawSync(data);
  const name = new TextEncoder().encode('d.txt');
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
  lh.writeUInt32LE(crc32(data), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
  const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc32(data), 16);
  ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(0, 42);
  const cdOff = 30 + name.length + comp.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(cdOff, 16);
  const z = new Blob([lh, name, comp, ch, name, end]);
  const [e] = await readZip(z);
  assert.equal(await (await e.blob()).text(), 'deflate me '.repeat(50));
});

test('백업 → 복원 왕복: 수업·녹음·카드·북마크 일치', async () => {
  const { blob, manifest } = await make();
  assert.equal(manifest.counts.audio, 1);
  assert.ok(manifest.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
  const r = await readBackup(blob);
  assert.deepEqual(r.lessons, [lesson]);
  assert.equal(r.audios.get(lesson.id).blob.size, audio.size);
  assert.deepEqual(new Uint8Array(await r.audios.get(lesson.id).blob.arrayBuffer()), new Uint8Array(await audio.arrayBuffer()));
  assert.deepEqual(r.cards, cards);
  assert.deepEqual(r.bookmarks.map(({ id, startSec, endSec, label }) => ({ id, startSec, endSec, label })), [{ id: 'bm_a1', startSec: 1.5, endSec: 4, label: '연습 <구간> & 메모' }]);
  assert.deepEqual(r.warnings, []);
});

test('녹음 제외 백업', async () => {
  const { blob, manifest } = await make({ includeAudio: false });
  assert.equal(manifest.audioIncluded, false);
  const r = await readBackup(blob);
  assert.equal(r.audios.size, 0);
  assert.equal(r.lessons.length, 1);
});

test('경로 검사 (zip-slip)', () => {
  for (const bad of ['../evil', '/abs', 'a/../b', 'a\\b', 'a//b', '', './a']) assert.equal(isSafePath(bad), false, bad);
  assert.equal(isSafePath('lessons/les_1/lesson.json'), true);
});

test('위험한 경로가 든 ZIP은 거부', async () => {
  const z = await writeZip([{ name: '../../evil.js', data: 'x' }]);
  await assert.rejects(readBackup(z), (e) => e instanceof BackupError && /허용되지 않는 경로/.test(e.message));
});

test('내용이 바뀐 백업은 해시 불일치로 거부', async () => {
  const { blob } = await make();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const s = new TextDecoder().decode(bytes);
  const i = s.indexOf('"title": "천천히 하세요"');
  assert.ok(i > 0);
  const pos = new TextEncoder().encode(s.slice(0, i + 10)).length; // 제목 글자 위치(바이트)
  bytes[pos] = bytes[pos] ^ 1;
  await assert.rejects(readBackup(new Blob([bytes])), /해시 불일치|읽을 수 없습니다/);
});

test('미래 버전·다른 형식·ZIP 아님', async () => {
  const fut = await writeZip([{ name: 'manifest.json', data: JSON.stringify({ format: 'english-review-backup', schemaVersion: 99, files: [] }) }]);
  await assert.rejects(readBackup(fut), /더 새 버전/);
  const other = await writeZip([{ name: 'manifest.json', data: '{"format":"x","schemaVersion":1,"files":[]}' }]);
  await assert.rejects(readBackup(other), /백업 형식이 아닙니다/);
  await assert.rejects(readBackup(new Blob(['not a zip'])), /ZIP/);
});

test('알 수 없는 파일은 건너뛰고 경고', async () => {
  const { blob } = await make();
  const es = await readZip(blob);
  const parts = await Promise.all(es.map(async (e) => ({ name: e.name, data: await e.blob() })));
  const z = await writeZip([...parts, { name: 'extra/notes.txt', data: 'hi' }]);
  const r = await readBackup(z);
  assert.equal(r.lessons.length, 1);
  assert.ok(r.warnings.some((w) => w.includes('extra/notes.txt')));
});
