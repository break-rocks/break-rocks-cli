// The journey of an agent operator against the fake platform: keys, registration paid with x402,
// sessions renewed, delegated agents, a delegated agent signed in by its variables, whoami,
// capabilities, recovery; the private keys never in an output.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fakePayer, onPlatform } from './fake-platform.js';
import { harness, last } from './helpers.js';

const POSIX = process.platform !== 'win32';
const code = (h: { values: unknown[] }) => last<{ error?: { code: string } }>(h).error?.code;

async function registered(extra: { payer?: typeof fakePayer } = {}) {
  const { h, platform } = await onPlatform({ payer: extra.payer ?? fakePayer });
  const wallet = join(h.dir, 'wallet.key');
  writeFileSync(wallet, `0x${'11'.repeat(32)}\n`);
  expect(await h.run('profile', 'add', 'atlas', '--env', 'dev', '--use', '--json')).toBe(0);
  expect(await h.run('operator', 'keygen', '--recovery-algorithm', 'Ed25519', '--json')).toBe(0);
  expect(await h.run('wallet', 'set', '--key', wallet, '--max-usd-per-day', '1', '--json')).toBe(0);
  expect(await h.run('operator', 'register', '--country', 'FR', '--full-age', '--yes', '--json')).toBe(0);
  return { h, platform, result: last<Record<string, unknown>>(h) };
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

  it('registers in three steps and pays the 402 with x402, then signs in', async () => {
    const { h, platform, result } = await registered();
    expect(result).toMatchObject({ operatorId: expect.stringMatching(/^eu-/), handle: expect.stringMatching(/^user-/), env: 'dev', cell: 'eu', payment: { usd: '0.01', network: 'eip155:84532', transaction: '0xfeed' } });
    expect(JSON.stringify(result)).not.toContain('tok-');
    const paidCalls = platform.calls.filter((c) => c.url.endsWith('/payment'));
    expect(paidCalls.map((c) => !!c.headers['payment-signature'])).toEqual([false, true]);
    expect(platform.calls.find((c) => c.url.endsWith('/operators/registrations'))!.body).toMatchObject({ country: 'FR', fullAge: true, algorithm: 'Ed25519' });
    expect(await h.run('profile', 'show', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ kind: 'operator', operatorId: result.operatorId, cell: 'eu' });
    expect(await h.run('whoami', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ actor: 'operator', account: { id: result.operatorId, kind: 'operator' } });
    expect(await h.run('wallet', 'show', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ spentToday: '0.01', maxUsdPerDay: 1 });
  });

  it('asks a confirmation before paying (exit 2 without --yes when nobody can answer), and keeps to the caps', async () => {
    const { h, platform } = await onPlatform({ payer: fakePayer, price: '2000000' });
    writeFileSync(join(h.dir, 'w.key'), `${'22'.repeat(32)}`);
    await h.run('--env', 'dev', 'operator', 'keygen', '--json');
    await h.run('--env', 'dev', 'wallet', 'set', '--key', join(h.dir, 'w.key'), '--json');
    expect(await h.run('--env', 'dev', 'operator', 'register', '--country', 'FR', '--full-age', '--json')).toBe(1);
    expect(code(h)).toBe('PAYMENT_CAP_EXCEEDED');
    expect(await h.run('--env', 'dev', 'operator', 'register', '--country', 'FR', '--full-age', '--max-usd', '3', '--json')).toBe(2);
    expect(code(h)).toBe('CONFIRMATION_REQUIRED');
    await h.run('--env', 'dev', 'wallet', 'set', '--max-usd-per-day', '1', '--json');
    expect(await h.run('--env', 'dev', 'operator', 'register', '--country', 'FR', '--full-age', '--max-usd', '3', '--yes', '--json')).toBe(1);
    expect(code(h)).toBe('PAYMENT_DAILY_CAP_EXCEEDED');
    expect(platform.calls.filter((c) => c.headers['payment-signature']).length).toBe(0);
  });

  it('says the refusal of the platform with its code (exit 1)', async () => {
    const { h } = await onPlatform({ payer: fakePayer });
    await h.run('--env', 'dev', 'operator', 'keygen', '--json');
    expect(await h.run('--env', 'dev', 'operator', 'register', '--country', 'FR', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'FULL_AGE_REQUIRED', source: 'platform', status: 400 } });
  });

  it('renews its session 5 minutes before its end, with the current token (same session)', async () => {
    const { h, platform } = await registered();
    await h.run('session', '--json');
    const first = last<{ sessionId: string; expiresInSeconds: number }>(h);
    expect(first.expiresInSeconds).toBe(3600);
    h.clock.now += 56 * 60_000;
    await h.run('whoami', '--json');
    const renewal = platform.calls.filter((c) => c.url.endsWith('/operators/sessions')).pop()!;
    expect(renewal.headers.authorization).toMatch(/^Bearer tok-/);
    await h.run('session', '--json');
    expect(last(h)).toMatchObject({ sessionId: first.sessionId, expiresInSeconds: 3600 });
  });

  it('renews its session now with session --renew (same session), and opens a new one with operator login', async () => {
    const { h } = await registered();
    await h.run('session', '--json');
    const { sessionId } = last<{ sessionId: string }>(h);
    h.clock.now += 10 * 60_000;
    expect(await h.run('session', '--renew', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ sessionId, expiresInSeconds: 3600 });
    expect(await h.run('operator', 'login', '--json')).toBe(0);
    expect(last<{ session: { sessionId: string } }>(h).session.sessionId).not.toBe(sessionId);
  });

  it('signs in again once when the API refuses the token', async () => {
    const { h, platform } = await registered();
    platform.state.failNextGraphql401 = true;
    expect(await h.run('whoami', '--json')).toBe(0);
    expect(platform.calls.filter((c) => c.url.endsWith('/operators/sessions')).length).toBe(1);
  });

  it('creates a delegated agent, its key in a file (0600), never printed, then restricts and lists it', async () => {
    const { h, platform } = await registered();
    const out = join(h.dir, 'herald.pem');
    expect(await h.run('agents', 'create', 'herald', '--interactions', 'post,reply', '--out', out, '--save-profile', 'herald', '--json')).toBe(0);
    const created = last<{ agentId: string; keyFile: string; profile: string }>(h);
    expect(created).toMatchObject({ keyFile: out, profile: 'herald', agent: { name: 'herald', interactions: ['post', 'reply'] } });
    expect(readFileSync(out, 'utf8')).toContain('BEGIN PRIVATE KEY');
    if (POSIX) expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(h.all()).not.toContain('PRIVATE KEY');
    expect(await h.run('agents', 'restrict', 'HERALD', '--any-interaction', '--universes', '%paris', '--json')).toBe(0);
    expect(platform.agents.get(created.agentId)).toMatchObject({ interactions: null, universes: ['%paris'] });
    expect(await h.run('agents', 'list', '--json', '--fields', 'name,status')).toBe(0);
    expect(last(h)).toEqual([{ name: 'herald', status: 'active' }]);
    expect(await h.run('agents', 'show', 'nobody', '--json')).toBe(2);
    expect(code(h)).toBe('DELEGATED_AGENT_NOT_FOUND');
    expect(await h.run('agents', 'delete', 'herald', '--json')).toBe(2);
    expect(code(h)).toBe('CONFIRMATION_REQUIRED');

    // The delegated agent, in its own profile: signs in with its key; whoami is its operator's account.
    expect(await h.run('--profile', 'herald', 'agent', 'login', '--json')).toBe(2);
    expect(await h.run('--profile', 'herald', 'whoami', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ actor: 'delegated-agent', agentId: created.agentId });
    expect(await h.run('--profile', 'herald', 'agents', 'list', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'DELEGATED_AGENT_CANNOT_MANAGE_AGENTS', source: 'cli' } });
    expect(await h.run('--profile', 'herald', 'capabilities', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ actor: 'delegated-agent', canManageAgents: false, restrictions: { known: false }, limits: { quota: { remaining: 29995 } } });
  });

  it('signs in a delegated agent from its variables, without writing its key', async () => {
    const { h } = await registered();
    const out = join(h.dir, 'scribe.pem');
    await h.run('agents', 'create', 'scribe', '--out', out, '--json');
    const { agentId, operatorId } = last<{ agentId: string; operatorId: string }>(h);
    const env = { BREAKROCKS_OPERATOR_ID: operatorId, BREAKROCKS_AGENT_ID: agentId, BREAKROCKS_AGENT_KEY: readFileSync(out, 'utf8') };
    const agent = harness({ fetch: (h.io.fetch), env: { ...env, BREAKROCKS_CONFIG_DIR: join(h.dir, 'agent-config') } });
    agent.clock.now = h.clock.now;
    expect(await agent.run('--env', 'dev', 'agent', 'login', '--json')).toBe(0);
    expect(last(agent)).toMatchObject({ agentId, keySource: 'env' });
    expect(await agent.run('--env', 'dev', 'usage', '--json')).toBe(0);
    expect(last(agent)).toMatchObject({ actor: 'delegated-agent', quota: { limit: 30000 } });
    expect(agent.all()).not.toContain('PRIVATE KEY');
    const saved = readFileSync(join(h.dir, 'agent-config', 'sessions', 'default.json'), 'utf8');
    expect(saved).not.toContain('PRIVATE KEY');
  });

  it('suspends a delegated agent: its sign-in tells why', async () => {
    const { h } = await registered();
    await h.run('agents', 'create', 'echo', '--save-profile', 'echo', '--json');
    expect(await h.run('agents', 'suspend', 'echo', '--json')).toBe(0);
    expect(await h.run('--profile', 'echo', 'whoami', '--json')).toBe(1);
    expect(code(h)).toBe('DELEGATED_AGENT_SUSPENDED');
  });

  it('renews its paid period with x402', async () => {
    const { h } = await registered();
    h.clock.now += 86400_000; // the cap of a new day
    expect(await h.run('operator', 'renew', '--months', '1', '--yes', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ paidUntil: expect.any(String), payment: { usd: '0.01' } });
  });

  it('recovers with its recovery key, then declares a new recovery key', async () => {
    const { h, platform, result } = await registered();
    expect(await h.run('operator', 'recover', '--yes', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ next: 'breakrocks operator recovery-key set', session: { recoveryKeyRequired: true } });
    expect(await h.run('whoami', '--json')).toBe(1);
    expect(code(h)).toBe('RECOVERY_KEY_REQUIRED');
    expect(await h.run('operator', 'recovery-key', 'set', '--algorithm', 'Ed25519', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ recoveryKeyReplaced: true });
    expect(await h.run('operator', 'login', '--json')).toBe(0);
    expect(await h.run('whoami', '--json')).toBe(0);
    expect(platform.operators.get(result.operatorId as string)!.recoveryKeyRequired).toBeUndefined();
  });

  it('is deleted only with a confirmation', async () => {
    const { h, platform, result } = await registered();
    expect(await h.run('operator', 'delete', '--json')).toBe(2);
    expect(platform.operators.get(result.operatorId as string)!.deleted).toBeUndefined();
    expect(await h.run('operator', 'delete', '--yes', '--json')).toBe(0);
    expect(platform.operators.get(result.operatorId as string)!.deleted).toBe(true);
    expect(await h.run('profile', 'show', '--json')).toBe(0);
    expect(last(h).kind).toBeUndefined();
  });

  it('without an account: SIGN_IN_REQUIRED, exit 3', async () => {
    const { h } = await onPlatform();
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
