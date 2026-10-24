// Cognito's Secure Remote Password (USER_SRP_AUTH, the only password flow the app client of the
// humans allows: ALLOW_USER_SRP_AUTH, ALLOW_REFRESH_TOKEN_AUTH, ALLOW_CUSTOM_AUTH), with node:crypto
// and BigInt, as amazon-cognito-identity-js computes it (AuthenticationHelper): the password never
// leaves the device; Cognito checks a signature derived from it. A copy of the back-office CLI
// src/srp.ts (no common package yet): a fix goes to both.
import { createHash, createHmac, randomBytes } from 'node:crypto';

/** The 3072-bit group of RFC 5054 and its generator. */
export const N = BigInt('0x'
  + 'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD'
  + 'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED'
  + 'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F'
  + '83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B'
  + 'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510'
  + '15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7'
  + 'ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200C'
  + 'BBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF');
export const g = 2n;

export function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = ((base % modulus) + modulus) % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    e >>= 1n;
    b = (b * b) % modulus;
  }
  return result;
}

/** A positive integer in hex as Cognito hashes it: an even length, a leading 00 when its first bit is set. */
export function padHex(value: bigint): string {
  if (value < 0n) throw new Error('padHex: a negative value');
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return /^[89a-f]/i.test(hex) ? `00${hex}` : hex;
}

const sha256Hex = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const hexHash = (hex: string) => sha256Hex(Buffer.from(hex, 'hex'));
const big = (hex: string) => BigInt(`0x${hex}`);

export const k = big(hexHash(`${padHex(N)}${padHex(g)}`));

/** The client's ephemeral secret [a] and public value [A] (A mod N never 0). */
export function ephemeral(random: (size: number) => Buffer = randomBytes): { a: bigint; A: bigint } {
  for (;;) {
    const a = big(random(128).toString('hex'));
    const A = modPow(g, a, N);
    if (A % N !== 0n) return { a, A };
  }
}

/** The key of the password claim: HKDF over S, salted with u (16 bytes). */
export function passwordAuthenticationKey(input: { poolName: string; userId: string; password: string; a: bigint; A: bigint; B: bigint; salt: string }): Buffer {
  const { poolName, userId, password, a, A, B, salt } = input;
  if (B % N === 0n) throw new Error('SRP: B cannot be zero');
  const u = big(hexHash(padHex(A) + padHex(B)));
  if (u === 0n) throw new Error('SRP: u cannot be zero');
  const x = big(hexHash(padHex(big(salt)) + sha256Hex(`${poolName}${userId}:${password}`)));
  const S = modPow(B - k * modPow(g, x, N), a + u * x, N);
  const prk = createHmac('sha256', Buffer.from(padHex(u), 'hex')).update(Buffer.from(padHex(S), 'hex')).digest();
  return createHmac('sha256', prk).update(Buffer.concat([Buffer.from('Caldera Derived Key', 'utf8'), Buffer.from([1])])).digest().subarray(0, 16);
}

const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');

/** Cognito's timestamp of a claim: "Fri Oct 23 07:05:09 UTC 2026" (the day not padded). */
export function srpTimestamp(at: Date): string {
  return `${WEEK[at.getUTCDay()]} ${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()} ${two(at.getUTCHours())}:${two(at.getUTCMinutes())}:${two(at.getUTCSeconds())} UTC ${at.getUTCFullYear()}`;
}

/** The signature of the claim: HMAC-SHA256(key, poolName ‖ userId ‖ secret block ‖ timestamp), base64. */
export function claimSignature(key: Buffer, poolName: string, userId: string, secretBlock: string, timestamp: string): string {
  return createHmac('sha256', key)
    .update(Buffer.concat([Buffer.from(poolName, 'utf8'), Buffer.from(userId, 'utf8'), Buffer.from(secretBlock, 'base64'), Buffer.from(timestamp, 'utf8')]))
    .digest('base64');
}
