import { createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fingerprint, generateKeys, privateKeyFrom, publicKeyFrom, publicKeyOf, signChallenge, supports } from '../src/keys.js';
import { walletKeyFrom } from '../src/x402.js';
import { generateKeyPairSync } from 'node:crypto';

describe('the keys of agents', () => {
  it('Ed25519: SPKI and PKCS #8 PEM, a challenge signed as its UTF-8 bytes, in base64url', () => {
    const pair = generateKeys('Ed25519');
    expect(pair.publicKey).toMatch(/^-----BEGIN PUBLIC KEY-----/);
    expect(pair.privateKey).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    const { key, algorithm } = privateKeyFrom(pair.privateKey, 'test');
    expect(algorithm).toBe('Ed25519');
    expect(publicKeyOf(key)).toBe(pair.publicKey);
    const text = 'breakrocks-operator-session\nchallengé ✓';
    const signature = signChallenge(text, key);
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verify(null, Buffer.from(text, 'utf8'), createPublicKey(pair.publicKey), Buffer.from(signature, 'base64url'))).toBe(true);
    expect(fingerprint(pair.publicKey)).toMatch(/^SHA256:[A-Za-z0-9_-]{16}$/);
  });
  it('ML-DSA-65 where node:crypto has it', () => {
    if (!supports('ML-DSA-65')) return;
    const pair = generateKeys('ML-DSA-65');
    const { key, algorithm } = privateKeyFrom(pair.privateKey, 'test');
    expect(algorithm).toBe('ML-DSA-65');
    expect(verify(null, Buffer.from('x'), createPublicKey(pair.publicKey), Buffer.from(signChallenge('x', key), 'base64url'))).toBe(true);
    expect(publicKeyFrom(pair.publicKey, 'p').algorithm).toBe('ML-DSA-65');
  });
  it('refuses what is not an Ed25519 nor ML-DSA-65 key', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    expect(() => privateKeyFrom(rsa, 'rsa.pem')).toThrow(/not an Ed25519/);
    expect(() => privateKeyFrom('nope', 'x')).toThrow(/not a private key/);
  });
});

describe('the wallet key', () => {
  it('is 64 hexadecimal digits, with or without 0x, or a secp256k1 key in PEM', () => {
    expect(walletKeyFrom(`0x${'AB'.repeat(32)}\n`, 'k')).toBe(`0x${'ab'.repeat(32)}`);
    expect(walletKeyFrom('cd'.repeat(32), 'k')).toBe(`0x${'cd'.repeat(32)}`);
    const pem = generateKeyPairSync('ec', { namedCurve: 'secp256k1' }).privateKey.export({ type: 'sec1', format: 'pem' }).toString();
    expect(walletKeyFrom(pem, 'k')).toMatch(/^0x[0-9a-f]{64}$/);
    expect(() => walletKeyFrom('0x1234', 'k')).toThrow(/not an EVM private key/);
  });
});
