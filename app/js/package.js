// PC 수업 처리기가 만든 패키지 ZIP 읽기·검증 (schema/package.schema.json, ADR 0006). DOM 비의존.
// 검사: 평평한 안전한 파일명, 크기 제한, manifest의 SHA-256, 종류(lesson/weekly), 내용 형식.
import { readZip, sha256Hex } from './zip.js';

export class PackageError extends Error {}

const SAFE = /^[A-Za-z0-9._-]+$/;
const LIMIT = { total: 300 * 1024 * 1024, json: 5 * 1024 * 1024, entries: 20 };
const EX_TYPES = new Set(['cloze', 'choice', 'meaning', 'situation']);
const REF = /^(cor|exp|up)_[0-9]+$/;

const isStr = (v) => typeof v === 'string';
const fail = (m) => { throw new PackageError(m); };

async function readJson(blob, name) {
  if (blob.size > LIMIT.json) fail(`${name} 파일이 너무 큽니다.`);
  try { return JSON.parse(await blob.text()); } catch { fail(`${name}을(를) 읽을 수 없습니다(JSON 형식 오류).`); }
}

/** 수업 v2 내용 검사(앱이 화면에 쓰는 필드 위주). 문제가 있으면 PackageError */
export function validateLessonV2(l) {
  if (!l || typeof l !== 'object') fail('수업 데이터가 비어 있습니다.');
  if (l.schemaVersion !== 2) fail(`지원하지 않는 수업 형식 버전입니다(${l.schemaVersion}). 앱을 업데이트하세요.`);
  if (!isStr(l.id) || !/^les_[A-Za-z0-9_]+$/.test(l.id)) fail('수업 ID 형식이 올바르지 않습니다.');
  if (!isStr(l.date) || Number.isNaN(Date.parse(l.date))) fail('수업 날짜가 올바르지 않습니다.');
  for (const k of ['corrections', 'expressions', 'upgrades', 'exercises']) if (!Array.isArray(l[k])) fail(`${k} 항목이 없습니다.`);
  const refs = new Set();
  const addRef = (id, prefix) => {
    if (!isStr(id) || !id.startsWith(prefix) || !REF.test(id) || refs.has(id)) fail(`항목 ID 오류: ${id}`);
    refs.add(id);
  };
  for (const c of l.corrections) { addRef(c.id, 'cor_'); if (!isStr(c.original) || !isStr(c.corrected) || !c.corrected.trim()) fail(`교정 ${c.id} 내용이 비어 있습니다.`); }
  for (const e of l.expressions) { addRef(e.id, 'exp_'); if (!isStr(e.text) || !e.text.trim()) fail(`표현 ${e.id} 내용이 비어 있습니다.`); }
  for (const u of l.upgrades) { addRef(u.id, 'up_'); if (!isStr(u.suggestion) || !u.suggestion.trim()) fail(`업그레이드 ${u.id} 내용이 비어 있습니다.`); }
  for (const x of l.exercises) {
    if (!REF.test(x.ref || '') || !refs.has(x.ref)) fail(`문제 ${x.id}가 없는 항목(${x.ref})을 가리킵니다.`);
    if (!EX_TYPES.has(x.type)) fail(`문제 ${x.id}의 유형(${x.type})을 알 수 없습니다.`);
    if (!isStr(x.prompt) || !isStr(x.answer)) fail(`문제 ${x.id} 내용이 비어 있습니다.`);
    if ((x.type === 'choice' || x.type === 'situation') && !(Array.isArray(x.options) && x.options.includes(x.answer))) fail(`문제 ${x.id}의 보기에 정답이 없습니다.`);
  }
  if (l.audio && (!isStr(l.audio.file) || !SAFE.test(l.audio.file))) fail('녹음 파일 이름이 올바르지 않습니다.');
  if (l.transcript && !Array.isArray(l.transcript.segments)) fail('스크립트 형식이 올바르지 않습니다.');
  return l;
}

export function validateWeekly(w) {
  if (!w || w.schemaVersion !== 2 || !isStr(w.id) || !/^wk_\d{4}W\d{2}$/.test(w.id)) fail('주간 요약 형식이 올바르지 않습니다.');
  if (!isStr(w.from) || !isStr(w.to) || !Array.isArray(w.highlightsKo) || !Array.isArray(w.lessonIds)) fail('주간 요약에 필요한 항목이 없습니다.');
  return w;
}

/**
 * @param {Blob} file
 * @returns {Promise<{kind:'lesson'|'weekly', manifest:object, lesson?:object, audio?:{blob:Blob, mimeType:string}, weekly?:object}>}
 */
export async function readPackage(file) {
  if (file.size > LIMIT.total) fail('파일이 너무 큽니다(최대 300MB).');
  let entries;
  try { entries = await readZip(file, { maxEntries: LIMIT.entries }); } catch (e) { fail(e.message || 'ZIP 파일을 읽지 못했습니다.'); }
  const byName = new Map();
  for (const e of entries) {
    if (e.name.endsWith('/')) continue;
    if (!SAFE.test(e.name)) fail(`허용되지 않는 파일 이름이 들어 있습니다: ${e.name.slice(0, 60)}`);
    if (byName.has(e.name)) fail(`같은 이름의 파일이 두 번 들어 있습니다: ${e.name}`);
    byName.set(e.name, e);
  }
  const me = byName.get('manifest.json');
  if (!me) fail('수업 패키지가 아닙니다(manifest.json 없음). 백업 ZIP이라면 이 버전에서는 사용하지 않습니다.');
  const manifest = await readJson(await me.blob(), 'manifest.json');
  if (manifest?.format !== 'english-review-package') fail('수업 패키지가 아닙니다(format 불일치).');
  if (manifest.schemaVersion !== 2) fail(`지원하지 않는 패키지 버전입니다(${manifest.schemaVersion}).`);
  if (!['lesson', 'weekly'].includes(manifest.kind)) fail('패키지 종류를 알 수 없습니다.');
  if (!Array.isArray(manifest.files)) fail('manifest.json에 파일 목록이 없습니다.');

  const blobs = new Map();
  let total = 0;
  for (const f of manifest.files) {
    if (!isStr(f.path) || !SAFE.test(f.path) || f.path === 'manifest.json') fail('manifest.json의 파일 이름이 올바르지 않습니다.');
    const e = byName.get(f.path);
    if (!e) fail(`패키지에 ${f.path} 파일이 없습니다.`);
    if (e.size !== f.bytes) fail(`${f.path} 크기가 맞지 않습니다(손상).`);
    total += e.size;
    if (total > LIMIT.total) fail('패키지 내용이 너무 큽니다.');
    const b = await e.blob();
    if (b.size !== f.bytes || (await sha256Hex(b)) !== f.sha256) fail(`${f.path} 파일이 손상되었습니다(SHA-256 불일치).`);
    blobs.set(f.path, b);
  }

  if (manifest.kind === 'weekly') {
    if (!blobs.has('weekly.json')) fail('weekly.json이 없습니다.');
    return { kind: 'weekly', manifest, weekly: validateWeekly(await readJson(blobs.get('weekly.json'), 'weekly.json')) };
  }
  if (!blobs.has('lesson.json')) fail('lesson.json이 없습니다.');
  const lesson = validateLessonV2(await readJson(blobs.get('lesson.json'), 'lesson.json'));
  let audio;
  if (lesson.audio) {
    const b = blobs.get(lesson.audio.file);
    if (!b) fail(`녹음 파일(${lesson.audio.file})이 패키지에 없습니다.`);
    const mimeType = isStr(lesson.audio.mimeType) && /^(audio|video)\/[\w.+-]+$/.test(lesson.audio.mimeType) ? lesson.audio.mimeType : 'audio/mp4';
    audio = { blob: new Blob([b], { type: mimeType }), mimeType };
  }
  return { kind: 'lesson', manifest, lesson, audio };
}
