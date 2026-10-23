// The keys of agent operators and delegated agents (contracts/agent-sign-in.md § Keys and auth
// challenges; specs README § Cryptography of agents): Ed25519 or ML-DSA-65, SPKI public keys in
// PEM, PKCS #8 private keys in PEM, auth challenges signed as they are (UTF-8) and sent in base64url.
// node:crypto alone: ML-DSA-65 where the Node of the system has it (Node 24.7 and later).
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { Algorithm } from './config.js';
import { cliRefusal, usageError } from './errors.js';

export const ALGORITHMS: readonly Algorithm[] = ['Ed25519', 'ML-DSA-65'];
const NODE_TYPE: Record<Algorithm, 'ed25519' | 'ml-dsa-65'> = { Ed25519: 'ed25519', 'ML-DSA-65': 'ml-dsa-65' };

const support = new Map<Algorithm, boolean>();
/** Whether node:crypto of this Node can make and use keys of [algorithm]. */
export function supports(algorithm: Algorithm): boolean {
  if (!support.has(algorithm)) {
    try { generateKeyPairSync(NODE_TYPE[algorithm] as 'ed25519'); support.set(algorithm, true); } catch { support.set(algorithm, false); }
  }
  return support.get(algorithm)!;
}

function requireSupport(algorithm: Algorithm) {
  if (!supports(algorithm)) {
    throw cliRefusal('ALGORITHM_NOT_SUPPORTED', `The Node of this system (${process.version}) has no ${algorithm} in node:crypto: use Ed25519, or Node 24.7 or later for ML-DSA-65`, { algorithm, node: process.version });
  }
}

export type KeyPair = { algorithm: Algorithm; publicKey: string; privateKey: string };

/** A new key pair of [algorithm]: the public key SPKI PEM, the private key PKCS #8 PEM. */
export function generateKeys(algorithm: Algorithm): KeyPair {
  requireSupport(algorithm);
  const { publicKey, privateKey } = generateKeyPairSync(NODE_TYPE[algorithm] as 'ed25519');
  return { algorithm, publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(), privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
}

/** The algorithm of a key object, undefined for another kind of key. */
export function algorithmOf(key: KeyObject): Algorithm | undefined {
  return key.asymmetricKeyType === 'ed25519' ? 'Ed25519' : (key.asymmetricKeyType as string) === 'ml-dsa-65' ? 'ML-DSA-65' : undefined;
}

/** A private key from its PEM ([label]: where it comes from, for the refusal KEY_INVALID). */
export function privateKeyFrom(pem: string, label: string): { key: KeyObject; algorithm: Algorithm } {
  let key: KeyObject;
  try { key = createPrivateKey(pem); } catch { throw usageError('KEY_INVALID', `${label} is not a private key in PEM`); }
  const algorithm = algorithmOf(key);
  if (!algorithm) throw usageError('KEY_INVALID', `${label} is not an Ed25519 nor an ML-DSA-65 private key`);
  return { key, algorithm };
}

/** A private key read from a file (KEY_MISSING when the file is not there). */
export function readPrivateKey(path: string, label = path): { key: KeyObject; algorithm: Algorithm } {
  if (!existsSync(path)) throw usageError('KEY_MISSING', `No key at ${path}`, { path });
  return privateKeyFrom(readFileSync(path, 'utf8'), label);
}

/** The SPKI PEM of the public key of a private key. */
export const publicKeyOf = (key: KeyObject) => createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString();

/** A public key read from a PEM (a file given to recover with), with its algorithm. */
export function publicKeyFrom(pem: string, label: string): { pem: string; algorithm: Algorithm } {
  let key: KeyObject;
  try { key = createPublicKey(pem); } catch { throw usageError('KEY_INVALID', `${label} is not a key in PEM`); }
  const algorithm = algorithmOf(key);
  if (!algorithm) throw usageError('KEY_INVALID', `${label} is not an Ed25519 nor an ML-DSA-65 key`);
  return { pem: key.export({ type: 'spki', format: 'pem' }).toString(), algorithm };
}

/** An auth challenge signed with [key]: its UTF-8 bytes as they are, the signature in base64url. */
export const signChallenge = (challenge: string, key: KeyObject) => sign(null, Buffer.from(challenge, 'utf8'), key).toString('base64url');

/** A short fingerprint of a public key (SHA-256 of its DER, base64url, 16 characters): shown in place of the key. */
export function fingerprint(publicPem: string): string {
  const der = createPublicKey(publicPem).export({ type: 'spki', format: 'der' });
  return `SHA256:${createHash('sha256').update(der).digest('base64url').slice(0, 16)}`;
}
