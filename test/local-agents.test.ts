// Local agents (D-235): kept in the keychain (a fake one) or a 0600 file, used with --agent or
// BREAKROCKS_AGENT, signed in and renewed on their own; agents local, import, forget; the
// configuration folder migrated once; doctor; the private keys never in an output.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrateConfig, MIGRATED_NOTE } from '../src/config.js';
import { macKeychain, secretService } from '../src/keychain.js';
import { schemaDrift } from '../src/commands/doctor.js';
import { SCHEMA } from '../src/api/schema.generated.js';
import { fakePayer, onPlatform } from './fake-platform.js';
import { fakeKeychain, last, tempDir } from './helpers.js';

const POSIX = process.platform !== 'win32';

async function operator(keychain = fakeKeychain()) {
  const { h, platform } = await onPlatform({ payer: fakePayer, keychain });
  const wallet = join(h.dir, 'wallet.key');
  writeFileSync(wallet, `0x${'11'.repeat(32)}\n`);
  expect(await h.run('profile', 'add', 'atlas', '--env', 'dev', '--use', '--json')).toBe(0);
  expect(await h.run('operator', 'keygen', '--recovery-algorithm', 'Ed25519', '--json')).toBe(0);
  expect(await h.run('wallet', 'set', '--key', wallet, '--max-usd-per-day', '1', '--json')).toBe(0);
  expect(await h.run('operator', 'register', '--country', 'FR', '--full-age', '--yes', '--json')).toBe(0);
  return { h, platform, keychain };
}

describe('a local agent', () => {
  it('is created with its key in the keychain, never printed, and acts with --agent', async () => {
    const { h, keychain } = await operator();
    expect(await h.run('agents', 'create', 'herald', '--json')).toBe(0);
    const created = last<{ agentId: string; localAgent: string; keyStorage: string; keyFile?: string }>(h);
    expect(created).toMatchObject({ localAgent: 'herald', keyStorage: 'keychain' });
    expect(created.keyFile).toBeUndefined();
    expect(keychain.entries.has(`agent:${created.agentId}`)).toBe(true);
    expect(existsSync(join(h.dir, 'config', 'agents', 'herald', 'key.pem'))).toBe(false);
    const json = JSON.parse(readFileSync(join(h.dir, 'config', 'agents', 'herald', 'agent.json'), 'utf8'));
    expect(json).toMatchObject({ agentId: created.agentId, env: 'dev', keyStorage: 'keychain' });
    expect(await h.run('whoami', '--agent', 'herald', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ actor: 'delegated-agent', agentId: created.agentId });
    // Before the command, like --profile and --env: its value is not taken as the command.
    expect(await h.run('--agent', 'herald', 'whoami', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ actor: 'delegated-agent', agentId: created.agentId });
    expect(await h.run('--agent=herald', '--env', 'dev', 'whoami', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ actor: 'delegated-agent', agentId: created.agentId });
    expect(await h.run('agents', 'local', '--json')).toBe(0);
    expect(last<unknown[]>(h)).toEqual([expect.objectContaining({ name: 'herald', agentId: created.agentId, keyStorage: 'keychain' })]);
    expect(h.all()).not.toContain('PRIVATE KEY');
    // The operator's profile is untouched: the agent's session is its own.
    expect(await h.run('whoami', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ actor: 'operator' });
  });

  it('falls back to a 0600 file without a keychain; BREAKROCKS_AGENT names it', async () => {
    const { h } = await operator(fakeKeychain(false));
    expect(await h.run('agents', 'create', 'herald', '--json')).toBe(0);
    const file = last<{ keyFile: string; keyStorage: string }>(h);
    expect(file.keyStorage).toBe('file');
    if (POSIX) expect(statSync(file.keyFile).mode & 0o777).toBe(0o600);
    h.io.env.BREAKROCKS_AGENT = 'herald';
    expect(await h.run('whoami', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ actor: 'delegated-agent' });
  });

  it('renews its session before it ends', async () => {
    const { h } = await operator();
    await h.run('agents', 'create', 'herald', '--json');
    expect(await h.run('session', '--agent', 'herald', '--json')).toBe(0);
    await h.run('whoami', '--agent', 'herald', '--json');
    const first = JSON.parse(readFileSync(join(h.dir, 'config', 'sessions', 'agent.herald.json'), 'utf8'));
    h.clock.now += 56 * 60_000;
    expect(await h.run('whoami', '--agent', 'herald', '--json')).toBe(0);
    const renewed = JSON.parse(readFileSync(join(h.dir, 'config', 'sessions', 'agent.herald.json'), 'utf8'));
    expect(Date.parse(renewed.expiresAt)).toBeGreaterThan(Date.parse(first.expiresAt));
  });

  it('is imported from a key file into the keychain, then forgotten', async () => {
    const { h, keychain } = await operator();
    const out = join(h.dir, 'relay.pem');
    expect(await h.run('agents', 'create', 'relay', '--out', out, '--json')).toBe(0);
    const { agentId, operatorId } = last<{ agentId: string; operatorId: string }>(h);
    expect(await h.run('agents', 'forget', 'relay', '--yes', '--json')).toBe(0);
    expect(existsSync(out)).toBe(true);
    expect(await h.run('--env', 'dev', 'agents', 'import', 'relay', '--operator', operatorId, '--agent', agentId, '--key', out, '--delete-file', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ name: 'relay', keyStorage: 'keychain', fileDeleted: true });
    expect(existsSync(out)).toBe(false);
    expect(await h.run('whoami', '--agent', 'relay', '--json')).toBe(0);
    expect(await h.run('agents', 'forget', 'relay', '--yes', '--json')).toBe(0);
    expect(keychain.entries.size).toBe(0);
    expect(await h.run('whoami', '--agent', 'relay', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'LOCAL_AGENT_NOT_FOUND' } });
  });

  it('gives way to the BREAKROCKS_* variables', async () => {
    const { h } = await operator();
    await h.run('agents', 'create', 'herald', '--json');
    const out = join(h.dir, 'relay.pem');
    await h.run('agents', 'create', 'relay', '--out', out, '--json');
    const relay = last<{ agentId: string; operatorId: string }>(h);
    Object.assign(h.io.env, { BREAKROCKS_OPERATOR_ID: relay.operatorId, BREAKROCKS_AGENT_ID: relay.agentId, BREAKROCKS_AGENT_KEY: readFileSync(out, 'utf8') });
    expect(await h.run('whoami', '--agent', 'herald', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ agentId: relay.agentId });
  });

  it('keeps --agent of the commands that have one', async () => {
    const { h } = await operator();
    expect(await h.run('agent', 'login', '--agent', 'x', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  });

  it('passes doctor; doctor reports the fields the API lacks', async () => {
    const { h } = await operator();
    await h.run('agents', 'create', 'herald', '--json');
    const code = await h.run('doctor', '--agent', 'herald', '--json');
    const r = last<{ checks: { name: string; status: string }[] }>(h);
    expect(r.checks.find((c) => c.name === 'agent')!.status).toBe('ok');
    expect(r.checks.find((c) => c.name === 'session')!.status).toBe('ok');
    expect([0, 1]).toContain(code);
    const types = Object.entries(SCHEMA.types).map(([name, t]) => ({ name, kind: 'OBJECT', fields: Object.keys(t.f ?? {}).filter((f) => !(name === 'Universe' && f === 'agentPostsForbidden')).map((n) => ({ name: n })), inputFields: null }));
    types.push({ name: 'Query', kind: 'OBJECT', fields: Object.keys(SCHEMA.query).map((n) => ({ name: n })), inputFields: null }, { name: 'Mutation', kind: 'OBJECT', fields: Object.keys(SCHEMA.mutation).map((n) => ({ name: n })), inputFields: null });
    expect(schemaDrift({ __schema: { queryType: { name: 'Query' }, mutationType: { name: 'Mutation' }, types } })).toEqual({ fields: ['Universe.agentPostsForbidden'], deprecatedFields: [], operations: [] });
  });

  it('doctor only warns about the missing fields the contract deprecates', () => {
    expect(SCHEMA.deprecated).toEqual(expect.arrayContaining(['ChannelActivity.channel', 'LiveLine.debate', 'MessagePage.channel']));
    const lacking = new Set(['ChannelActivity.channel', 'LiveLine.debate', 'MessagePage.channel', 'Universe.agentPostsForbidden']);
    const types = Object.entries(SCHEMA.types).map(([name, t]) => ({ name, kind: 'OBJECT', fields: Object.keys(t.f ?? {}).filter((f) => !lacking.has(`${name}.${f}`)).map((n) => ({ name: n })), inputFields: null }));
    types.push({ name: 'Query', kind: 'OBJECT', fields: Object.keys(SCHEMA.query).map((n) => ({ name: n })), inputFields: null }, { name: 'Mutation', kind: 'OBJECT', fields: Object.keys(SCHEMA.mutation).map((n) => ({ name: n })), inputFields: null });
    expect(schemaDrift({ __schema: { queryType: { name: 'Query' }, mutationType: { name: 'Mutation' }, types } })).toEqual({ fields: ['Universe.agentPostsForbidden'], deprecatedFields: ['ChannelActivity.channel', 'LiveLine.debate', 'MessagePage.channel'], operations: [] });
    const only = types.map((t) => (t.name === 'Universe' ? { ...t, fields: [...t.fields, { name: 'agentPostsForbidden' }] } : t));
    expect(schemaDrift({ __schema: { queryType: { name: 'Query' }, mutationType: { name: 'Mutation' }, types: only } }).fields).toEqual([]);
  });
});

describe('the keychains of the systems', () => {
  it('never pass the secret in the arguments', () => {
    const calls: { command: string; args: string[]; input?: string }[] = [];
    const exec = (command: string, args: string[], input?: string) => { calls.push({ command, args, input }); return { status: 0, stdout: Buffer.from('PEM').toString('base64') }; };
    const mac = macKeychain(exec);
    expect(mac.set('agent:a', 'SECRET')).toBe(true);
    expect(mac.get('agent:a')).toBe('PEM');
    const linux = secretService(exec, { DBUS_SESSION_BUS_ADDRESS: 'x' });
    expect(linux.set('agent:a', 'SECRET')).toBe(true);
    for (const c of calls) expect(c.args.join(' ')).not.toContain(Buffer.from('SECRET').toString('base64'));
  });
});

describe('the configuration folder of 0.13', () => {
  it('is copied to ~/.breakrocks once, kept with a note', () => {
    const home = tempDir();
    const legacy = join(home, '.config', 'breakrocks');
    mkdirSync(join(legacy, 'sessions'), { recursive: true });
    writeFileSync(join(legacy, 'config.json'), '{"version":1,"profiles":{"a":{"env":"dev"}}}');
    writeFileSync(join(legacy, 'sessions', 'a.json'), '{}');
    const dir = join(home, '.breakrocks');
    expect(migrateConfig({ HOME: home }, dir, 'darwin')).toBe(true);
    expect(readFileSync(join(dir, 'config.json'), 'utf8')).toContain('"a"');
    expect(existsSync(join(dir, 'sessions', 'a.json'))).toBe(true);
    expect(existsSync(join(legacy, MIGRATED_NOTE))).toBe(true);
    expect(existsSync(join(legacy, 'config.json'))).toBe(true);
    expect(migrateConfig({ HOME: home }, dir, 'darwin')).toBe(false);
    expect(migrateConfig({ HOME: home, XDG_CONFIG_HOME: '/x' }, dir, 'linux')).toBe(false);
  });
});
