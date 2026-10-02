// 전체 백업 ZIP 만들기·읽기 (구조: docs/data-spec.md 5장). DOM·IndexedDB 비의존 → Node 테스트 가능
import { writeZip, readZip, sha256Hex } from './zip.js';
import { bookmarksToVtt, parseVtt } from './vtt.js';
import { toAnkiTsv } from './cards.js';
import { validateLesson } from './parser/langdy-v1.js';
import { migrate, CURRENT_SCHEMA } from './migrations.js';

export const BACKUP_FORMAT = 'english-review-backup';
const LIMITS = { entries: 5000, entryBytes: 300 * 1024 * 1024, jsonBytes: 5 * 1024 * 1024, totalBytes: 4 * 1024 ** 3 - 1 };

const README = `# 영어 복습 앱 백업

이 ZIP은 영어 복습 PWA의 전체 백업입니다. 앱 없이도 아래 파일을 직접 열어 볼 수 있습니다.

- manifest.json — 파일 목록과 SHA-256 해시, schemaVersion
- lessons/<수업ID>/lesson.json — 수업 데이터(표현·교정·총평·원문). 형식: schema/lesson.schema.json
- lessons/<수업ID>/audio.* — 수업 녹음(원본 그대로)
- lessons/<수업ID>/bookmarks.vtt — 구간 북마크(WebVTT)
- review/cards.json — 복습 카드와 학습 기록. 형식: schema/card.schema.json
- review/cards-anki.tsv — Anki 가져오기용(학습 기록 제외)

복원: 앱 → 설정 → 백업 복원에서 이 ZIP을 선택하세요.
개인정보(수업 녹음·내용)가 들어 있으니 공개된 곳에 올리지 마세요.
`;

const enc = new TextEncoder();
const jsonText = (o) => JSON.stringify(o, null, 2) + '\n';

/**
 * @param {{lessons:object[], audios:Map<string,{blob:Blob,mimeType:string}>, cards:object[], bookmarks:object[],
 *          includeAudio?:boolean, appVersion:string, now?:Date}} data
 * @returns {Promise<{blob:Blob, manifest:object}>}
 */
export async function createBackup({ lessons, audios, cards, bookmarks, includeAudio = true, appVersion, now = new Date() }) {
  const files = [];
  const add = (name, data) => files.push({ name, data: typeof data === 'string' ? new Blob([enc.encode(data)]) : data });

  add('README.md', README);
  let audioCount = 0;
  for (const l of lessons) {
    add(`lessons/${l.id}/lesson.json`, jsonText(l));
    const a = audios.get(l.id);
    if (includeAudio && a && l.audio?.file) { add(`lessons/${l.id}/${l.audio.file}`, a.blob); audioCount++; }
    const bms = bookmarks.filter((b) => b.lessonId === l.id);
    if (bms.length) add(`lessons/${l.id}/bookmarks.vtt`, bookmarksToVtt(bms));
  }
  add('review/cards.json', jsonText({ schemaVersion: CURRENT_SCHEMA, cards }));
  add('review/cards-anki.tsv', toAnkiTsv(cards.filter((c) => !c.suspended)));

  const list = [];
  for (const f of files) list.push({ path: f.name, bytes: f.data.size, sha256: await sha256Hex(f.data) });
  const manifest = {
    format: BACKUP_FORMAT,
    schemaVersion: CURRENT_SCHEMA,
    createdAt: now.toISOString(),
    appVersion,
    audioIncluded: includeAudio,
    counts: { lessons: lessons.length, cards: cards.length, bookmarks: bookmarks.length, audio: audioCount },
    files: list,
  };
  const blob = await writeZip([{ name: 'manifest.json', data: jsonText(manifest) }, ...files], now);
  return { blob, manifest };
}

/** zip-slip 방지: 허용된 경로 형식만 통과 */
export function isSafePath(p) {
  if (typeof p !== 'string' || !p || p.length > 200) return false;
  if (p.startsWith('/') || p.includes('\\') || p.includes('\0')) return false;
  if (p.split('/').some((s) => s === '' || s === '.' || s === '..')) return false;
  return /^[A-Za-z0-9._/-]+$/.test(p);
}

const KNOWN = [
  /^manifest\.json$/, /^README\.md$/,
  /^lessons\/les_[A-Za-z0-9_]+\/lesson\.json$/,
  /^lessons\/les_[A-Za-z0-9_]+\/audio\.[a-z0-9]{2,4}$/,
  /^lessons\/les_[A-Za-z0-9_]+\/(bookmarks|transcript)\.vtt$/,
  /^review\/cards\.json$/, /^review\/cards-anki\.tsv$/,
  /^generated\/gen_[A-Za-z0-9_]+\.json$/,
];

export class BackupError extends Error {}

async function readJson(entry) {
  if (entry.size > LIMITS.jsonBytes) throw new BackupError(`${entry.name} 파일이 너무 큽니다.`);
  try { return JSON.parse(await (await entry.blob()).text()); } catch { throw new BackupError(`${entry.name} 내용을 읽을 수 없습니다.`); }
}

/**
 * 백업 ZIP 검증 후 데이터로 변환. 저장은 호출 측에서.
 * @returns {Promise<{manifest:object, lessons:object[], audios:Map<string,{blob:Blob,mimeType:string}>, cards:object[], bookmarks:object[], warnings:string[]}>}
 */
export async function readBackup(file) {
  let entries;
  try { entries = await readZip(file, { maxEntries: LIMITS.entries }); } catch (e) { throw new BackupError(e.message); }
  const warnings = [];
  const byName = new Map();
  let total = 0;
  for (const e of entries) {
    if (e.name.endsWith('/')) continue; // 폴더 항목
    if (!isSafePath(e.name)) throw new BackupError(`허용되지 않는 경로가 있습니다: ${e.name.slice(0, 80)}`);
    if (e.size > LIMITS.entryBytes) throw new BackupError(`파일이 너무 큽니다: ${e.name}`);
    total += e.size;
    if (total > LIMITS.totalBytes) throw new BackupError('백업 전체 크기가 너무 큽니다.');
    if (!KNOWN.some((re) => re.test(e.name))) { warnings.push(`알 수 없는 파일은 건너뜀: ${e.name}`); continue; }
    byName.set(e.name, e);
  }

  const mEntry = byName.get('manifest.json');
  if (!mEntry) throw new BackupError('manifest.json이 없습니다. 이 앱의 백업 파일이 맞는지 확인하세요.');
  const manifest = await readJson(mEntry);
  if (manifest.format !== BACKUP_FORMAT) throw new BackupError('이 앱의 백업 형식이 아닙니다.');
  if (!Number.isInteger(manifest.schemaVersion) || manifest.schemaVersion < 1) throw new BackupError('schemaVersion이 올바르지 않습니다.');
  if (manifest.schemaVersion > CURRENT_SCHEMA) throw new BackupError('더 새 버전 앱에서 만든 백업입니다. 앱을 업데이트한 뒤 복원하세요.');
  if (!Array.isArray(manifest.files)) throw new BackupError('manifest 파일 목록이 없습니다.');

  // 해시 검증
  const listed = new Set();
  for (const f of manifest.files) {
    if (!isSafePath(f.path)) throw new BackupError(`manifest에 허용되지 않는 경로: ${String(f.path).slice(0, 80)}`);
    listed.add(f.path);
    const e = byName.get(f.path);
    if (!e) throw new BackupError(`백업에 파일이 빠져 있습니다: ${f.path}`);
    const blob = await e.blob();
    if (blob.size !== f.bytes || (await sha256Hex(blob)) !== f.sha256) throw new BackupError(`파일이 손상되었습니다(해시 불일치): ${f.path}`);
  }
  for (const name of byName.keys()) if (name !== 'manifest.json' && !listed.has(name)) { warnings.push(`manifest에 없는 파일은 건너뜀: ${name}`); byName.delete(name); }

  const lessons = [];
  const audios = new Map();
  const bookmarks = [];
  for (const [name, e] of byName) {
    const m = name.match(/^lessons\/(les_[A-Za-z0-9_]+)\/lesson\.json$/);
    if (!m) continue;
    const lesson = migrate('lesson', await readJson(e), manifest.schemaVersion);
    const errs = validateLesson(lesson);
    if (errs.length || lesson.id !== m[1]) { warnings.push(`수업 데이터 오류로 건너뜀: ${m[1]}`); continue; }
    lessons.push(lesson);
    const audioName = lesson.audio?.file && `lessons/${lesson.id}/${lesson.audio.file}`;
    if (audioName && byName.has(audioName)) {
      const blob = await byName.get(audioName).blob();
      audios.set(lesson.id, { blob: new Blob([blob], { type: lesson.audio.mimeType }), mimeType: lesson.audio.mimeType });
    }
    const vtt = byName.get(`lessons/${lesson.id}/bookmarks.vtt`);
    if (vtt) {
      try {
        const restoredAt = new Date().toISOString();
        parseVtt(await (await vtt.blob()).text()).forEach((c, i) => bookmarks.push({
          id: c.id && /^bm_[A-Za-z0-9_]+$/.test(c.id) ? c.id : `bm_r${i}_${lesson.id}`,
          lessonId: lesson.id, startSec: c.startSec, endSec: c.endSec, label: c.text === '(구간)' ? '' : c.text, createdAt: restoredAt,
        }));
      } catch { warnings.push(`구간 북마크를 읽지 못함: ${lesson.id}`); }
    }
  }

  let cards = [];
  const ce = byName.get('review/cards.json');
  if (ce) {
    const cj = migrate('cards', await readJson(ce), manifest.schemaVersion);
    if (!Array.isArray(cj.cards)) throw new BackupError('cards.json 형식이 올바르지 않습니다.');
    const ids = new Set(lessons.map((l) => l.id));
    cards = cj.cards.filter((c) => c && /^crd_[A-Za-z0-9_]+$/.test(c.id) && c.srs && ids.has(c.source?.lessonId));
    if (cards.length !== cj.cards.length) warnings.push(`카드 ${cj.cards.length - cards.length}장은 연결된 수업이 없어 건너뜀`);
  }
  return { manifest, lessons, audios, cards, bookmarks, warnings };
}
