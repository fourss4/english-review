// 최소 ZIP 구현 (외부 의존성 없음, ADR 0004)
// 쓰기: 무압축(STORE) — 녹음(AAC)은 이미 압축되어 있고 JSON은 작아서 충분
// 읽기: STORE + DEFLATE(브라우저 DecompressionStream) — PC에서 다시 압축한 ZIP도 복원 가능
// 제한: ZIP64 미지원 → 전체 4GB 미만, 항목 65,535개 미만

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

const enc = new TextEncoder();
const MAX32 = 0xffffffff;

/**
 * ZIP 작성. 녹음 Blob은 복사하지 않고 그대로 Blob 조각으로 연결(메모리 절약).
 * @param {{name:string, data:Blob|Uint8Array|string}[]} entries
 * @returns {Promise<Blob>}
 */
export async function writeZip(entries, now = new Date()) {
  if (entries.length >= 0xffff) throw new Error('파일 수가 너무 많습니다.');
  const { time, date } = dosDateTime(now);
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const blob = e.data instanceof Blob ? e.data : new Blob([typeof e.data === 'string' ? enc.encode(e.data) : e.data]);
    const crc = crc32(new Uint8Array(await blob.arrayBuffer()));
    const size = blob.size;
    if (offset + size + 30 + name.length > MAX32) throw new Error('백업이 4GB를 넘습니다. "녹음 포함"을 끄고 다시 시도하세요.');
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(lh.buffer, name, blob);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(ch.buffer, name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((s, p) => s + p.byteLength, 0);
  if (offset + cdSize + 22 > MAX32) throw new Error('백업이 4GB를 넘습니다.');
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

/**
 * ZIP 목차 읽기. 내용은 entry.blob()을 호출할 때 읽는다.
 * @param {Blob} file
 * @param {{maxEntries?:number}} opts
 * @returns {Promise<{name:string, size:number, compressedSize:number, method:number, blob:()=>Promise<Blob>}[]>}
 */
export async function readZip(file, { maxEntries = 5000 } = {}) {
  const tailLen = Math.min(file.size, 65557);
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('ZIP 파일이 아니거나 손상되었습니다.');
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === MAX32) throw new Error('지원하지 않는 ZIP 형식입니다(ZIP64).');
  if (count > maxEntries) throw new Error(`파일 수가 너무 많습니다(${count}개).`);
  if (cdOffset + cdSize > file.size) throw new Error('ZIP 목차가 손상되었습니다.');
  const cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  const out = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP 목차가 손상되었습니다.');
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    const compressedSize = cd.getUint32(p + 20, true);
    const size = cd.getUint32(p + 24, true);
    const nLen = cd.getUint16(p + 28, true), xLen = cd.getUint16(p + 30, true), cLen = cd.getUint16(p + 32, true);
    const local = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nLen));
    p += 46 + nLen + xLen + cLen;
    if (flags & 0x1) throw new Error('암호화된 ZIP은 지원하지 않습니다.');
    out.push({
      name, size, compressedSize, method,
      async blob() {
        const lh = new DataView(await file.slice(local, local + 30).arrayBuffer());
        if (lh.getUint32(0, true) !== 0x04034b50) throw new Error(`손상된 항목: ${name}`);
        const start = local + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
        const raw = file.slice(start, start + compressedSize);
        if (method === 0) return raw;
        if (method === 8 && typeof DecompressionStream !== 'undefined') {
          return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
        }
        throw new Error(`지원하지 않는 압축 방식: ${name}`);
      },
    });
  }
  return out;
}

export async function sha256Hex(blob) {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
