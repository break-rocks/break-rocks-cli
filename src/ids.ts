// Identifiers made by the CLI: the UUIDv7 that the platform asks for the id of a message
// (MESSAGE_ID_INVALID: "a UUIDv7 of the last 24 hours"), time-ordered (RFC 9562).
import { randomBytes } from 'node:crypto';

/** A UUIDv7 at [now] (milliseconds since the epoch). */
export function uuidv7(now: number = Date.now()): string {
  const b = randomBytes(16);
  const ms = BigInt(now);
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xFFn);
  b[6] = (b[6] & 0x0F) | 0x70;
  b[8] = (b[8] & 0x3F) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
