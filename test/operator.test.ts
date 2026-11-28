// An agent operator on native-sulfur: its keys made here, its registration proved and paid with x402 (the fake checks the
// proofs as the server does), renewal, recovery, a new recovery key, deletion; a delegated agent created; the private keys
// never in an output.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fakePayer, onPlatform } from './fake-platform.js';
import { harness, last, sulfurSession } from './helpers.js';

const POSIX = process.platform !== 'win32';
const code = (h: { values: unknown[] }) => last<{ error?: { code: string } }>(h).error?.code;

/** A profile of dev on the fake platform with its two keys (Ed25519) and a wallet: ready to register. */
async function keysOnPlatform() {
  const { h, platform } = await onPlatform({ payer: fakePayer });
  writeFileSync(join(h.dir, 'wallet.key'), `0x${'11'.repeat(32)}\n`);
  expect(await h.run('config', 'add', 'atlas', '--env', 'dev', '--use', '--json')).toBe(0);
  expect(await h.run('operator', 'keygen', '--json')).toBe(0);
  expect(await h.run('wallet', 'set', '--key', join(h.dir, 'wallet.key'), '--max-usd-per-day', '1', '--json')).toBe(0);
  return { h, platform };
}

/** An agent operator signed in on native-sulfur (its session), whose API answers each request by its first field. */
function operatorOnSulfur(answers: Record<string, unknown>) {
  const calls: { field: string; variables: Record<string, unknown> }[] = [];
  const h = harness({
    env: { BREAKROCKS_SULFUR_URL: 'https://api.test' },
    fetch: async (url, init) => {
      if (String(url) !== 'https://api.test/graphql') throw new Error(`unexpected ${String(url)}`);
      const { query, variables } = JSON.parse(String(init!.body));
      const field = /\{\s*(?:\w+\s*:\s*)?(\w+)/.exec(query.replace(/^[^{]*/, ''))![1];
      calls.push({ field, variables });
      const answer = answers[field];
      return Response.json({ data: { [field]: typeof answer === 'function' ? answer(variables) : answer ?? null } });
    },
  });
  sulfurSession(h.io, 'operator');
  return { h, calls };
}

describe('an agent operator', () => {
  it('makes its keys in the configuration folder, 0600, never printed', async () => {
    const h = harness();
    expect(await h.run('operator', 'keygen', '--json')).toBe(0);
    const r = last<{ files: { operator: string; recovery: string }; fingerprint: string; publicKey: string }>(h);
    expect(readFileSync(r.files.operator, 'utf8')).toContain('BEGIN PRIVATE KEY');
    expect(r.publicKey).toContain('BEGIN PUBLIC KEY');
    expect(h.all()).not.toContain('PRIVATE KEY');
    if (POSIX) for (const f of Object.values(r.files)) expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(await h.run('operator', 'keygen', '--json')).toBe(2);
    expect(code(h)).toBe('KEYS_EXIST');
  });
  it('keeps agents tier: NOT_AVAILABLE before anything is sent', async () => {
    const h = harness();
    expect(await h.run('agents', 'tier', 'herald', '--tier', 'X10', '--yes', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'NOT_AVAILABLE', command: 'agents tier', backend: 'sulfur' } });
  });

  it('registers with both keys and a proof, pays the 402 with x402, then signs in with its key', async () => {
    const { h, platform } = await keysOnPlatform();
    expect(await h.run('operator', 'register', '--country', 'FR', '--full-age', '--months', '1', '--agents', '2', '--yes', '--json'), h.all()).toBe(0);
    const r = last<Record<string, unknown>>(h);
    expect(r).toMatchObject({ operatorId: expect.stringMatching(/^eu_[0-9a-f]{32}$/), handle: expect.stringMatching(/^user-/), env: 'dev', cell: 'eu', delegatedAgentAllowance: 2, payment: { usd: '0.01', network: 'eip155:84532', transaction: '0xfeed' }, minimum: { months: 1 } });
    const posts = platform.calls.filter((c) => c.url.includes('/v1/operators/'));
    expect(posts.map((c) => new URL(c.url).pathname)).toEqual(['/v1/operators/registrations', `/v1/operators/registrations/${r.operatorId}/payment`, `/v1/operators/registrations/${r.operatorId}/payment`]);
    expect(posts[2].headers['payment-signature']).toBe('signed');
    expect(posts.every((c) => c.headers['x-amz-content-sha256'])).toBe(true);
    expect(h.all()).not.toContain('PRIVATE KEY');
    expect(await h.run('whoami', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ actor: 'operator', account: { id: r.operatorId } });
    expect(await h.run('operator', 'register', '--country', 'FR', '--full-age', '--yes', '--json')).toBe(1);
    expect(code(h)).toBe('ALREADY_REGISTERED');
  });

  it('refuses a refusal of the platform with its code, and an ML-DSA-65 key before anything is sent', async () => {
    const { h, platform } = await keysOnPlatform();
    expect(await h.run('operator', 'register', '--country', 'FR', '--yes', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'FULL_AGE_REQUIRED', status: 400, source: 'platform' } });
    const before = platform.calls.length;
    const { generateKeyPairSync } = await import('node:crypto');
    let mldsa: string | undefined;
    try { mldsa = generateKeyPairSync('ml-dsa-65' as 'ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(); } catch { mldsa = undefined; }
    if (mldsa) {
      writeFileSync(join(h.dir, 'config', 'keys', 'atlas', 'recovery.pem'), mldsa);
      expect(await h.run('operator', 'register', '--country', 'FR', '--full-age', '--yes', '--json')).toBe(2);
      expect(code(h)).toBe('KEY_INVALID');
      expect(platform.calls.length).toBe(before);
    }
  });

  it('renews with x402, recovers with its recovery key, declares a new one, then is deleted with a confirmation', async () => {
    const { h, platform } = await keysOnPlatform();
    await h.run('operator', 'register', '--country', 'FR', '--full-age', '--yes', '--json');
    const operatorId = last<{ operatorId: string }>(h).operatorId;
    h.clock.now += 86400_000; // the cap of a new day
    expect(await h.run('operator', 'renew', '--months', '1', '--yes', '--json'), h.all()).toBe(0);
    expect(last(h)).toMatchObject({ operatorId, paidUntil: expect.any(String), payment: { usd: '0.01' } });
    const formerKey = platform.operators.get(operatorId)!.publicKey;
    expect(await h.run('operator', 'recover', '--yes', '--json'), h.all()).toBe(0);
    expect(last(h)).toMatchObject({ operatorId, recoveryKeyRequired: true, next: 'breakrocks operator recovery-key set' });
    expect(platform.operators.get(operatorId)!.publicKey).not.toBe(formerKey);
    expect(await h.run('operator', 'renew', '--yes', '--json')).toBe(1);
    expect(code(h)).toBe('RECOVERY_KEY_REQUIRED');
    const formerRecovery = platform.operators.get(operatorId)!.recoveryKey;
    expect(await h.run('operator', 'recovery-key', 'set', '--json'), h.all()).toBe(0);
    expect(last(h)).toMatchObject({ recoveryKeyReplaced: true, recoveryAlgorithm: 'Ed25519' });
    expect(platform.operators.get(operatorId)!.recoveryKey).not.toBe(formerRecovery);
    // The new key signs in.
    expect(await h.run('whoami', '--json')).toBe(0);
    expect(await h.run('operator', 'delete', '--json')).toBe(2);
    expect(platform.operators.get(operatorId)!.deleted).toBeUndefined();
    expect(await h.run('operator', 'delete', '--yes', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ operatorId, deleted: true });
    expect(platform.operators.get(operatorId)!.deleted).toBe(true);
    expect(await h.run('config', 'show', '--json')).toBe(0);
    expect(last(h).kind).toBeUndefined();
  });


  it('creates a delegated agent, its key in a file (0600), never printed', async () => {
    const { generateKeyPairSync } = await import('node:crypto');
    const privateKey = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const { h, calls } = operatorOnSulfur({ createDelegatedAgent: (v: Record<string, unknown>) => ({ agentId: 'eu_agent1', operatorId: 'eu-op', algorithm: 'Ed25519', privateKey, signInUrl: null, agent: { id: 'eu_agent1', name: v.name, status: 'ACTIVE', interactions: v.interactions, universes: null, createdAt: '2026-10-23T10:00:00.000Z' } }) });
    const out = join(h.dir, 'herald.pem');
    expect(await h.run('agents', 'create', 'herald', '--interactions', 'post,reply', '--out', out, '--json'), h.all()).toBe(0);
    expect(last(h)).toMatchObject({ keyFile: out });
    expect(readFileSync(out, 'utf8')).toContain('BEGIN PRIVATE KEY');
    if (POSIX) expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(h.all()).not.toContain('PRIVATE KEY');
    expect(calls.map((c) => c.field)).toContain('createDelegatedAgent');
  });

  it('without an account: SIGN_IN_REQUIRED, exit 3', async () => {
    const h = harness();
    expect(await h.run('--env', 'dev', 'whoami', '--json')).toBe(3);
    expect(code(h)).toBe('SIGN_IN_REQUIRED');
  });
});

describe('agent attest', () => {
  it('checks the domain as the platform defines it, then says the platform does not serve it yet', async () => {
    const h = harness();
    for (const bad of ['localhost', 'example', '192.168.1.10', '2001:db8::1', 'https://tools.example.com', 'tools.example.com:8443', 'tools.example.com/api']) {
      expect(await h.run('agent', 'attest', bad, '--json'), bad).toBe(2);
      expect(code(h)).toBe('DOMAIN_INVALID');
    }
    expect(await h.run('agent', 'attest', 'TOOLS.Example.com.', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'ATTESTATION_NOT_AVAILABLE', domain: 'tools.example.com' } });
    expect(await h.run('agent', 'attest', 'xn--bcher-kva.example', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { domain: 'bücher.example', ascii: 'xn--bcher-kva.example' } });
  });
});
