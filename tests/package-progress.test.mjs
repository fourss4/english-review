// 수업 패키지 읽기·검증, 학습 기록 내보내기/합치기, 수업 v1→v2 변환 (ADR 0006·0007)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { writeZip } from '../app/js/zip.js';
import { readPackage, validateLessonV2, PackageError } from '../app/js/package.js';
import { exportProgress, parseProgress, mergeProgress } from '../app/js/progress.js';
import { migrate, CURRENT_SCHEMA } from '../app/js/migrations.js';
import { syncLessonCards } from '../app/js/cards.js';
import { review } from '../app/js/srs.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const lessonText = read('samples/normalized/les_20260928_01/lesson.json');
const weeklyText = read('samples/normalized/weekly/wk_2026W40.json');
const lesson = JSON.parse(lessonText);
const audio = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 1, 2, 3, 4]);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const T = '2026-10-02';

async function pkg(kind, files, { manifestPatch = {}, extra = [] } = {}) {
  const enc = new TextEncoder();
  const bytes = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? enc.encode(v) : v]));
  const manifest = {
    format: 'english-review-package', schemaVersion: 2, kind, createdAt: '2026-10-02T00:00:00Z',
    files: Object.entries(bytes).map(([path, b]) => ({ path, bytes: b.length, sha256: sha(b) })), ...manifestPatch,
  };
  return writeZip([{ name: 'manifest.json', data: JSON.stringify(manifest) }, ...Object.entries(bytes).map(([name, data]) => ({ name, data })), ...extra]);
}

test('수업 패키지: 정상 읽기(수업·녹음)', async () => {
  const p = await readPackage(await pkg('lesson', { 'lesson.json': lessonText, 'audio.mp4': audio }));
  assert.equal(p.kind, 'lesson');
  assert.equal(p.lesson.id, 'les_20260928_01');
  assert.equal(p.lesson.upgrades.length, 3);
  assert.equal(p.audio.blob.size, audio.length);
  assert.equal(p.audio.mimeType, 'audio/mp4');
});

test('주간 요약 패키지', async () => {
  const p = await readPackage(await pkg('weekly', { 'weekly.json': weeklyText }));
  assert.equal(p.kind, 'weekly');
  assert.equal(p.weekly.id, 'wk_2026W40');
});

test('패키지 거부: 해시 불일치·파일 누락·위험한 이름·다른 형식', async () => {
  const bad = async (blob, re) => assert.rejects(readPackage(blob), (e) => e instanceof PackageError && re.test(e.message));
  const tampered = await pkg('lesson', { 'lesson.json': lessonText, 'audio.mp4': audio }, {
    manifestPatch: { files: [{ path: 'lesson.json', bytes: new TextEncoder().encode(lessonText).length, sha256: '0'.repeat(64) }] } });
  await bad(tampered, /손상/);
  await bad(await pkg('lesson', { 'lesson.json': lessonText }, { manifestPatch: { files: [{ path: 'audio.mp4', bytes: 1, sha256: '0'.repeat(64) }] } }), /audio\.mp4 파일이 없습니다/);
  await bad(await pkg('lesson', { 'lesson.json': lessonText }), /녹음 파일/);
  await bad(await pkg('lesson', { 'lesson.json': lessonText }, { extra: [{ name: '../evil.txt', data: 'x' }] }), /허용되지 않는 파일 이름/);
  await bad(await pkg('lesson', {}, { manifestPatch: { format: 'english-review-backup' } }), /수업 패키지가 아닙니다/);
  await bad(await writeZip([{ name: 'lesson.json', data: lessonText }]), /manifest\.json 없음/);
  await bad(new Blob(['not a zip']), /ZIP/);
});

test('수업 v2 내용 검증', () => {
  const clone = () => JSON.parse(lessonText);
  assert.equal(validateLessonV2(clone()).id, lesson.id);
  const cases = [
    [(l) => { l.schemaVersion = 3; }, /버전/],
    [(l) => { l.exercises[0].ref = 'cor_99'; }, /없는 항목/],
    [(l) => { l.exercises.find((x) => x.type === 'choice').answer = 'zzz'; }, /보기에 정답이 없/],
    [(l) => { l.corrections[1].id = 'cor_01'; }, /항목 ID 오류/],
    [(l) => { l.audio.file = '../a.mp4'; }, /녹음 파일 이름/],
    [(l) => { delete l.upgrades; }, /upgrades/],
  ];
  for (const [mut, re] of cases) { const l = clone(); mut(l); assert.throws(() => validateLessonV2(l), re); }
});

test('학습 기록: 내보내기 → 가져오기 합치기(기록 합집합, 최신 간격)', () => {
  const base = syncLessonCards(lesson, [], T);
  const phone = base.map((c) => (c.ref === 'cor_01'
    ? { ...c, srs: review(c.srs, 4, T), log: [{ at: '2026-10-02T09:00:00Z', grade: 4, type: 'cloze', correct: true, mode: 'normal' }] } : c));
  const exported = exportProgress(phone, { appVersion: '0.8.0', now: new Date('2026-10-02T10:00:00Z') });
  assert.equal(exported.format, 'english-review-progress');
  assert.equal(exported.cards.length, 7);
  const roundtrip = JSON.parse(JSON.stringify(exported));
  const { cards, skipped } = parseProgress({ ...roundtrip, cards: [...roundtrip.cards, { id: 'bad' }] });
  assert.equal(skipped, 1);

  // 새 기기: 카드 없음 → 전부 추가
  assert.equal(mergeProgress([], cards).added, 7);
  // 같은 기기에 나중 기록이 더 있음 → 기록 합치고 최신 간격 유지
  const later = phone.map((c) => (c.ref === 'cor_01'
    ? { ...c, srs: review(c.srs, 5, T), log: [...c.log, { at: '2026-10-03T09:00:00Z', grade: 5, type: 'choice', correct: true }], wrong: undefined } : c));
  const r = mergeProgress(later, cards);
  assert.equal(r.updated, 0, '가져온 쪽에 새 기록이 없으면 그대로');
  const older = base.map((c) => ({ ...c, wrong: c.ref === 'cor_01' ? { since: 'x', lastType: 'cloze' } : undefined }));
  const r2 = mergeProgress(older, cards);
  const m = r2.upserts.find((c) => c.ref === 'cor_01');
  assert.equal(r2.updated, 1);
  assert.equal(m.log.length, 1);
  assert.equal(m.srs.intervalDays, 3);
  assert.equal(m.wrong, undefined, '최근 기록 쪽의 오답 표시를 따름');
  assert.throws(() => parseProgress({ format: 'x' }), /학습 기록 파일이 아닙니다/);
});

test('수업 v1 → v2 변환(총평 제거, 뜻·이유 이름 변경, 원문 유지)', () => {
  const v1 = JSON.parse(read('samples/normalized/les_20260101_01/lesson.json'));
  const l = migrate('lesson', v1);
  assert.equal(CURRENT_SCHEMA, 2);
  assert.equal(l.schemaVersion, 2);
  assert.equal(l.feedback, undefined);
  assert.deepEqual([l.upgrades, l.exercises], [[], []]);
  assert.match(l.corrections[1].explanationKo, /plural "movies"[\s\S]*In English/);
  assert.equal(l.expressions[0].pattern, 'take + A + time');
  assert.equal(l.source.migratedFrom, 1);
  assert.equal(validateLessonV2(l).id, v1.id);
  assert.equal(migrate('lesson', l), l, '이미 v2면 그대로');
});
