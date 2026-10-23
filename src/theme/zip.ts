// ZIP archives of themes (C-21; the import of the theme studio, break-rocks-react src/themeBundle.ts):
// written with the JSON deflated (node:zlib) and the images stored (already compressed), read with
// stored or deflated entries, each checked against its size and its CRC-32. Same limits as the
// studio: 50 MB per archive, 200 MB inflated; no ZIP64, no encryption, no nested archive.
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { usageError } from '../errors.js';

export const ZIP_MAX_BYTES = 50 * 1024 * 1024;
export const ZIP_MAX_INFLATED = 200 * 1024 * 1024;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export type ZipEntry = { path: string; method: number; crc: number; compressedSize: number; size: number; offset: number };

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const zipError = (code: string, message: string) => usageError(code, message);

/** The files a system adds (macOS, Windows), never part of a theme. */
export const isSystemFile = (path: string) => /(^|\/)(__MACOSX\/|\._|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i.test(path);

/** The entries of a ZIP archive, from its central directory (folders and system files left out). */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  if (bytes.length > ZIP_MAX_BYTES) throw zipError('ZIP_TOO_LARGE', 'An archive of a theme is at most 50 MB');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xFFFF); i--) if (u32(bytes, i) === 0x06054B50) { end = i; break; }
  if (end < 0) throw zipError('ZIP_INVALID', 'Not a ZIP archive');
  const count = u16(bytes, end + 10), size = u32(bytes, end + 12), start = u32(bytes, end + 16);
  if (count === 0xFFFF || start === 0xFFFFFFFF || size === 0xFFFFFFFF || start + size > end) throw zipError('ZIP_INVALID', 'A ZIP64 or damaged archive');
  const entries: ZipEntry[] = [];
  let at = start, inflated = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || u32(bytes, at) !== 0x02014B50) throw zipError('ZIP_INVALID', 'A damaged central directory');
    const flags = u16(bytes, at + 8), method = u16(bytes, at + 10);
    const crc = u32(bytes, at + 16), compressedSize = u32(bytes, at + 20), entrySize = u32(bytes, at + 24);
    const nameLength = u16(bytes, at + 28), extraLength = u16(bytes, at + 30), commentLength = u16(bytes, at + 32);
    const offset = u32(bytes, at + 42);
    const path = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength)).replaceAll('\\', '/');
    at += 46 + nameLength + extraLength + commentLength;
    if (path.endsWith('/') || isSystemFile(path)) continue;
    if (compressedSize === 0xFFFFFFFF || entrySize === 0xFFFFFFFF || offset === 0xFFFFFFFF || offset + 30 > start) throw zipError('ZIP_INVALID', 'A ZIP64 or damaged entry');
    if (/\.(zip|7z|rar|tar|gz|tgz)$/i.test(path)) throw zipError('ZIP_NESTED', 'An archive inside the archive');
    if (flags & 1) throw zipError('ZIP_ENCRYPTED', 'An encrypted entry');
    if (method !== 0 && method !== 8) throw zipError('ZIP_METHOD_NOT_SUPPORTED', 'An entry neither stored nor deflated');
    inflated += entrySize;
    if (inflated > ZIP_MAX_INFLATED) throw zipError('ZIP_TOO_LARGE', 'The files of an archive of a theme are at most 200 MB');
    entries.push({ path, method, crc, compressedSize, size: entrySize, offset });
  }
  return entries;
}

/** The bytes of an entry, inflated when deflated, checked against its size and CRC-32 (ZIP_ENTRY_CORRUPT). */
export function zipEntryBytes(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const corrupt = () => zipError('ZIP_ENTRY_CORRUPT', `The entry ${entry.path} is damaged`);
  const at = entry.offset;
  if (u32(bytes, at) !== 0x04034B50) throw corrupt();
  const from = at + 30 + u16(bytes, at + 26) + u16(bytes, at + 28);
  if (from + entry.compressedSize > bytes.length) throw corrupt();
  const data = bytes.subarray(from, from + entry.compressedSize);
  let out: Uint8Array;
  try { out = entry.method === 0 ? data.slice() : new Uint8Array(inflateRawSync(data, { maxOutputLength: Math.max(1, entry.size) })); } catch { throw corrupt(); }
  if (out.length !== entry.size || crc32(out) !== entry.crc) throw corrupt();
  return out;
}

function dosDateTime(date: Date): { time: number; day: number } {
  const year = Math.max(1980, date.getFullYear());
  return { time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2), day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate() };
}

/** A ZIP archive of [files] (names in UTF-8), each deflated when [deflate] says so, else stored; dated [date]. */
export function writeZip(files: readonly { path: string; bytes: Uint8Array; deflate?: boolean }[], date = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const { time, day } = dosDateTime(date);
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.path);
    const crc = crc32(file.bytes), size = file.bytes.length;
    const data = file.deflate ? new Uint8Array(deflateRawSync(file.bytes)) : file.bytes;
    const method = file.deflate ? 8 : 0;
    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034B50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true); l.setUint16(8, method, true);
    l.setUint16(10, time, true); l.setUint16(12, day, true); l.setUint32(14, crc, true); l.setUint32(18, data.length, true); l.setUint32(22, size, true);
    l.setUint16(26, name.length, true); l.setUint16(28, 0, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014B50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, method, true);
    c.setUint16(12, time, true); c.setUint16(14, day, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, size, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054B50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, centralSize, true); e.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  if (out.length > ZIP_MAX_BYTES) throw zipError('ZIP_TOO_LARGE', 'An archive of a theme is at most 50 MB');
  return out;
}
