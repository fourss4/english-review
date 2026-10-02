// 서비스 워커: 앱 파일을 기기에 저장해 오프라인에서도 실행. 사용자 데이터는 다루지 않음(IndexedDB에 있음).
// 파일을 추가·삭제하면 ASSETS를 갱신하고 VERSION을 올린다(tests/sw.test.mjs가 누락을 검사).
const VERSION = '0.8.1';
const CACHE = `english-review-${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/main.js',
  './js/version.js',
  './js/db.js',
  './js/text.js',
  './js/srs.js',
  './js/cards.js',
  './js/player.js',
  './js/vtt.js',
  './js/search.js',
  './js/zip.js',
  './js/package.js',
  './js/progress.js',
  './js/backup.js',
  './js/migrations.js',
  './js/ai-structure.js',
  './js/parser/langdy-v1.js',
  './prompts/expression-upgrade.md',
  './prompts/chat-structure.md',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('english-review-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// 사용자가 "업데이트"를 누르면 새 버전으로 교체
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

// 같은 출처 GET만 처리: 캐시 우선, 없으면 네트워크. 페이지 이동은 오프라인일 때 index.html로.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (err) {
      if (req.mode === 'navigate') return (await caches.match('./index.html')) || Response.error();
      throw err;
    }
  })());
});
