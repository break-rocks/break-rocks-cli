// The duration and the display size of an MP4 or QuickTime file read from its header (ISO BMFF: `moov/mvhd`, each
// `trak/tkhd` with its matrix), as native-sulfur asks them at upload (requestUpload: durationSec, orientation) and checks
// them afterwards. The top-level boxes are walked by their headers (a large `mdat` is skipped, never read); a `moov` of at
// most 16 MB is read. Pure reading of the file: no system binary.
import { closeSync, openSync, readSync, statSync } from 'node:fs';

export const MOOV_MAX_BYTES = 16 * 1024 * 1024;
const BOXES_MAX = 64;

export type VideoProbe = { durationSec: number; width: number; height: number; orientation: 'h' | 'v' | 's' };

const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
const u64 = (b: Uint8Array, at: number) => u32(b, at) * 2 ** 32 + u32(b, at + 4);
const s32 = (b: Uint8Array, at: number) => u32(b, at) | 0;
const name = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

type Box = { type: string; start: number; header: number; size: number };

/** The boxes directly inside [b] from [from] to [to]. */
function boxes(b: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to && out.length < 4096) {
    let size = u32(b, at);
    let header = 8;
    if (size === 1) { size = u64(b, at + 8); header = 16; } else if (size === 0) size = to - at;
    if (size < header || at + size > to) break;
    out.push({ type: name(b, at + 4), start: at, header, size });
    at += size;
  }
  return out;
}

/** The duration and display size in a `moov` box's bytes, or undefined. */
export function probeMoov(moov: Uint8Array): VideoProbe | undefined {
  const top = boxes(moov, 8, moov.length);
  const mvhd = top.find((x) => x.type === 'mvhd');
  if (!mvhd) return undefined;
  const v = moov[mvhd.start + mvhd.header];
  const at = mvhd.start + mvhd.header + 4;
  const scale = v === 1 ? u32(moov, at + 16) : u32(moov, at + 8);
  const duration = v === 1 ? u64(moov, at + 20) : u32(moov, at + 12);
  if (!scale || !duration) return undefined;
  let width = 0, height = 0;
  for (const trak of top.filter((x) => x.type === 'trak')) {
    const tkhd = boxes(moov, trak.start + trak.header, trak.start + trak.size).find((x) => x.type === 'tkhd');
    if (!tkhd) continue;
    const tv = moov[tkhd.start + tkhd.header];
    const body = tkhd.start + tkhd.header + 4;
    // version 0: creation, modification, track id, reserved, duration (4 each); version 1: 8, 8, 4, 4, 8. Then 8 reserved,
    // layer, alternate group, volume, reserved (2 each), the matrix (9 × 4), width and height (16.16).
    const matrixAt = body + (tv === 1 ? 32 : 20) + 8 + 8;
    const w = u32(moov, matrixAt + 36) / 65536, h = u32(moov, matrixAt + 40) / 65536;
    if (!w || !h || w * h <= width * height) continue;
    // A rotation of 90° or 270° (a = 0, b = ±1): the display size is turned.
    const a = s32(moov, matrixAt), bm = s32(moov, matrixAt + 4);
    const turned = a === 0 && Math.abs(bm) === 65536;
    width = turned ? h : w; height = turned ? w : h;
  }
  if (!width || !height) return undefined;
  return { durationSec: duration / scale, width: Math.round(width), height: Math.round(height), orientation: width > height ? 'h' : width < height ? 'v' : 's' };
}

/** The duration and display size of the video at [path], or undefined when its header cannot be read. */
export function probeVideo(path: string): VideoProbe | undefined {
  const fd = openSync(path, 'r');
  try {
    const total = statSync(path).size;
    const head = new Uint8Array(16);
    let at = 0;
    for (let n = 0; n < BOXES_MAX && at + 8 <= total; n++) {
      readSync(fd, head, 0, 16, at);
      let size = u32(head, 0);
      if (size === 1) size = u64(head, 8); else if (size === 0) size = total - at;
      if (size < 8) return undefined;
      if (name(head, 4) === 'moov') {
        if (size > MOOV_MAX_BYTES) return undefined;
        const moov = new Uint8Array(size);
        readSync(fd, moov, 0, size, at);
        return probeMoov(moov);
      }
      at += size;
    }
    return undefined;
  } finally { closeSync(fd); }
}
