import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../app/js/version.js';

const appDir = fileURLToPath(new URL('../app/', import.meta.url));
const sw = readFileSync(join(appDir, 'sw.js'), 'utf8');
const assets = [...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);

function walk(d) {
  return readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [relative(appDir, p).replace(/\\/g, '/')]; });
}

test('서비스 워커가 앱 파일을 빠짐없이 캐시', () => {
  const files = walk(appDir).filter((f) => f !== 'sw.js');
  assert.deepEqual(files.filter((f) => !assets.includes(f)), [], '캐시 목록(ASSETS)에 빠진 파일');
  assert.deepEqual(assets.filter((a) => !files.includes(a)), [], '존재하지 않는 파일이 캐시 목록에 있음');
});

test('앱 버전과 서비스 워커 버전 일치', () => {
  assert.equal(sw.match(/const VERSION = '([^']+)'/)[1], APP_VERSION);
});

test('manifest 아이콘 파일 존재', () => {
  const m = JSON.parse(readFileSync(join(appDir, 'manifest.webmanifest'), 'utf8'));
  for (const i of m.icons) assert.ok(assets.includes(i.src), i.src);
  assert.ok(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512'));
});
