// Local agents (D-235): kept in the keychain (a fake one) or a 0600 file, used with --agent or
// BREAKROCKS_AGENT, signed in and renewed on their own; agents local, import, forget; the
// configuration folder migrated once; doctor; the private keys never in an output.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrateConfig, MIGRATED_NOTE } from '../src/config.js';
import { macKeychain, secretService } from '../src/keychain.js';
import { operatorOnPlatform } from './fake-platform.js';
import { fakeKeychain, last, tempDir } from './helpers.js';

const POSIX = process.platform !== 'win32';

async function operator(keychain = fakeKeychain()) {
  const { h, platform } = await operatorOnPlatform({ keychain });
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
    const first = JSON.parse(readFileSync(join(h.dir, 'config', 'sessions', 'agent.herald.sulfur.json'), 'utf8'));
    h.clock.now += 59 * 60_000 + 30_000;
    expect(await h.run('whoami', '--agent', 'herald', '--json')).toBe(0);
    const renewed = JSON.parse(readFileSync(join(h.dir, 'config', 'sessions', 'agent.herald.sulfur.json'), 'utf8'));
    expect(Date.parse(renewed.accessExpiresAt)).toBeGreaterThan(Date.parse(first.accessExpiresAt));
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
    // The local agent's key and session are gone; the operator's own session stays.
    expect([...keychain.entries.keys()].filter((k) => k.startsWith('agent:') || k.includes('agent.relay'))).toEqual([]);
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
