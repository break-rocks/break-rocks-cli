// The type and the size of an image from its first bytes (JPEG, PNG, WebP; GIF recognized to be
// refused), without decoding it and without a dependency.

export type ImageInfo = { type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; width: number; height: number };

const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const be32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const le16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const le24 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

/** The type and the size of the image [bytes], undefined when it is none of JPEG, PNG, WebP, GIF. */
export function imageInfo(bytes: Uint8Array): ImageInfo | undefined {
  if (bytes.length >= 24 && be32(bytes, 0) === 0x89504E47 && be32(bytes, 4) === 0x0D0A1A0A && ascii(bytes, 12, 4) === 'IHDR') {
    return { type: 'image/png', width: be32(bytes, 16), height: be32(bytes, 20) };
  }
  if (bytes.length >= 10 && ascii(bytes, 0, 4) === 'GIF8') return { type: 'image/gif', width: le16(bytes, 6), height: le16(bytes, 8) };
  if (bytes.length >= 30 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === 'VP8 ' && bytes.length >= 30) return { type: 'image/webp', width: le16(bytes, 26) & 0x3FFF, height: le16(bytes, 28) & 0x3FFF };
    if (chunk === 'VP8L' && bytes.length >= 25) {
      const [b0, b1, b2, b3] = [bytes[21], bytes[22], bytes[23], bytes[24]];
      return { type: 'image/webp', width: 1 + (((b1 & 0x3F) << 8) | b0), height: 1 + (((b3 & 0x0F) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6)) };
    }
    if (chunk === 'VP8X') return { type: 'image/webp', width: 1 + le24(bytes, 24), height: 1 + le24(bytes, 27) };
    return undefined;
  }
  if (bytes.length >= 4 && bytes[0] === 0xFF && bytes[1] === 0xD8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xFF) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker === 0xFF) { i++; continue; }
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        return { type: 'image/jpeg', height: be16(bytes, i + 5), width: be16(bytes, i + 7) };
      }
      i += 2 + be16(bytes, i + 2);
    }
    return undefined;
  }
  return undefined;
}
