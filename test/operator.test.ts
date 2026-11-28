// An agent operator: its keys made here, the commands of the former agents host kept answering NOT_AVAILABLE, a delegated
// agent created on native-sulfur; the private keys never in an output. (The sign-in of an agent with its key: sulfur tests.)
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { harness, last, sulfurSession } from './helpers.js';

const POSIX = process.platform !== 'win32';
const code = (h: { values: unknown[] }) => last<{ error?: { code: string } }>(h).error?.code;

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
  it('keeps register, renew, recover, recovery-key set, delete and agents tier: NOT_AVAILABLE before anything is sent', async () => {
    const h = harness();
    for (const argv of [['operator', 'register', '--country', 'FR', '--full-age'], ['operator', 'renew'], ['operator', 'recover'], ['operator', 'recovery-key', 'set'], ['operator', 'delete'], ['agents', 'tier', 'herald', '--tier', 'X10']]) {
      expect(await h.run(...argv, '--yes', '--json'), argv.join(' ')).toBe(1);
      expect(last(h)).toMatchObject({ error: { code: 'NOT_AVAILABLE', command: argv.slice(0, argv[1] === 'recovery-key' ? 3 : 2).join(' '), backend: 'sulfur' } });
    }
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
