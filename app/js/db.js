// IndexedDB 얇은 래퍼 (의존성 없음). 스토어 구조: docs/data-spec.md 6장

const DB_NAME = 'english-review';
const DB_VERSION = 3; // v2: cards, v3: bookmarks
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('lessons')) db.createObjectStore('lessons', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'lessonId' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('cards')) {
        const cs = db.createObjectStore('cards', { keyPath: 'id' });
        cs.createIndex('lessonId', 'source.lessonId', { unique: false });
      }
      if (!db.objectStoreNames.contains('bookmarks')) {
        db.createObjectStore('bookmarks', { keyPath: 'id' }).createIndex('lessonId', 'lessonId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function reqP(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

/** 수업과 오디오를 한 트랜잭션으로 저장 */
export async function saveLesson(lesson, audioBlob) {
  const db = await open();
  const tx = db.transaction(['lessons', 'audio'], 'readwrite');
  tx.objectStore('lessons').put(lesson);
  if (audioBlob) tx.objectStore('audio').put({ lessonId: lesson.id, blob: audioBlob, mimeType: lesson.audio?.mimeType || audioBlob.type });
  return done(tx);
}

export async function putLesson(lesson) {
  const db = await open();
  const tx = db.transaction('lessons', 'readwrite');
  tx.objectStore('lessons').put(lesson);
  return done(tx);
}

export async function listLessons() {
  const db = await open();
  return reqP(db.transaction('lessons').objectStore('lessons').getAll());
}

export async function getLesson(id) {
  const db = await open();
  return reqP(db.transaction('lessons').objectStore('lessons').get(id));
}

export async function getAudio(lessonId) {
  const db = await open();
  return reqP(db.transaction('audio').objectStore('audio').get(lessonId));
}

/** 영구 삭제 — 휴지통에서만 호출. 해당 수업 카드도 함께 삭제 */
export async function purgeLesson(id) {
  const db = await open();
  const tx = db.transaction(['lessons', 'audio', 'cards', 'bookmarks'], 'readwrite');
  tx.objectStore('lessons').delete(id);
  tx.objectStore('audio').delete(id);
  for (const store of ['cards', 'bookmarks']) {
    tx.objectStore(store).index('lessonId').openKeyCursor(IDBKeyRange.only(id)).onsuccess = (e) => {
      const cur = e.target.result;
      if (cur) { tx.objectStore(store).delete(cur.primaryKey); cur.continue(); }
    };
  }
  return done(tx);
}

export async function putCards(cards) {
  if (!cards.length) return;
  const db = await open();
  const tx = db.transaction('cards', 'readwrite');
  for (const c of cards) tx.objectStore('cards').put(c);
  return done(tx);
}

export async function listCards() {
  const db = await open();
  return reqP(db.transaction('cards').objectStore('cards').getAll());
}

export async function cardsByLesson(lessonId) {
  const db = await open();
  return reqP(db.transaction('cards').objectStore('cards').index('lessonId').getAll(IDBKeyRange.only(lessonId)));
}

export async function listBookmarks(lessonId) {
  const db = await open();
  return reqP(db.transaction('bookmarks').objectStore('bookmarks').index('lessonId').getAll(IDBKeyRange.only(lessonId)));
}

export async function putBookmark(b) {
  const db = await open();
  const tx = db.transaction('bookmarks', 'readwrite');
  tx.objectStore('bookmarks').put(b);
  return done(tx);
}

export async function deleteBookmark(id) {
  const db = await open();
  const tx = db.transaction('bookmarks', 'readwrite');
  tx.objectStore('bookmarks').delete(id);
  return done(tx);
}

export async function listAllBookmarks() {
  const db = await open();
  return reqP(db.transaction('bookmarks').objectStore('bookmarks').getAll());
}

/**
 * 백업 복원: 수업 1건과 딸린 데이터를 한 트랜잭션으로 저장.
 * 기존 카드·북마크는 지우고 백업 것으로 교체. 백업에 녹음이 없으면 기기의 녹음은 유지.
 */
export async function restoreLessonBundle(lesson, audio, cards, bookmarks) {
  const db = await open();
  const tx = db.transaction(['lessons', 'audio', 'cards', 'bookmarks'], 'readwrite');
  tx.objectStore('lessons').put(lesson);
  if (audio) tx.objectStore('audio').put({ lessonId: lesson.id, blob: audio.blob, mimeType: audio.mimeType });
  for (const store of ['cards', 'bookmarks']) {
    const os = tx.objectStore(store);
    const items = store === 'cards' ? cards : bookmarks;
    const req = os.index('lessonId').getAllKeys(IDBKeyRange.only(lesson.id));
    req.onsuccess = () => { for (const k of req.result) os.delete(k); for (const it of items) os.put(it); };
  }
  return done(tx);
}

export async function getMeta(key, fallback) {
  const db = await open();
  const r = await reqP(db.transaction('meta').objectStore('meta').get(key));
  return r ? r.value : fallback;
}

export async function setMeta(key, value) {
  const db = await open();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put({ key, value });
  return done(tx);
}

/** 브라우저가 저장소를 임의로 정리하지 않도록 요청 + 사용량 조회 */
export async function storageInfo() {
  const info = { persisted: false, usage: null, quota: null };
  try {
    if (navigator.storage?.persist) info.persisted = await navigator.storage.persist();
    if (navigator.storage?.estimate) Object.assign(info, await navigator.storage.estimate());
  } catch { /* 지원하지 않는 브라우저 */ }
  return info;
}
