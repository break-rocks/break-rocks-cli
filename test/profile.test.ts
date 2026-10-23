import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configDir } from '../src/config.js';
import { harness, last } from './helpers.js';

const POSIX = process.platform !== 'win32';

describe('the configuration folder', () => {
  it('is BREAKROCKS_CONFIG_DIR, else %APPDATA%\\breakrocks on Windows, else $XDG_CONFIG_HOME/breakrocks, else ~/.config/breakrocks', () => {
    expect(configDir({ BREAKROCKS_CONFIG_DIR: '/tmp/x' }, 'linux')).toMatch(/[\\/]tmp[\\/]x$/);
    expect(configDir({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32')).toMatch(/AppData.Roaming.breakrocks$/);
    expect(configDir({ XDG_CONFIG_HOME: '/home/a/.cfg' }, 'linux')).toBe(join('/home/a/.cfg', 'breakrocks'));
    expect(configDir({}, 'darwin')).toMatch(/\.config[\\/]breakrocks$/);
  });
});

describe('profiles', () => {
  it('are added, listed, used, shown and removed; config.json is the user\'s alone', async () => {
    const h = harness();
    expect(await h.run('profile', 'add', 'atlas', '--env', 'dev', '--json')).toBe(0);
    expect(await h.run('profile', 'add', 'scribe', '--env', 'staging', '--cell', 'us', '--json')).toBe(0);
    expect(await h.run('profile', 'add', 'atlas', '--json')).toBe(2);
    expect(last<{ error: { code: string } }>(h).error.code).toBe('PROFILE_EXISTS');
    expect(await h.run('profile', 'list', '--json')).toBe(0);
    expect(last(h)).toEqual([expect.objectContaining({ name: 'atlas', env: 'dev', current: true }), expect.objectContaining({ name: 'scribe', env: 'staging', cell: 'us', current: false })]);
    expect(await h.run('profile', 'use', 'scribe', '--json')).toBe(0);
    expect(await h.run('profile', 'show', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ name: 'scribe', current: true });
    expect(await h.run('--profile', 'atlas', 'profile', 'show', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ name: 'atlas', env: 'dev' });
    expect(await h.run('profile', 'remove', 'atlas', '--json')).toBe(2);
    expect(await h.run('profile', 'remove', 'atlas', '--yes', '--json')).toBe(0);
    expect(await h.run('profile', 'show', 'atlas', '--json')).toBe(2);
    const file = join(h.dir, 'config', 'config.json');
    expect(JSON.parse(readFileSync(file, 'utf8')).current).toBe('scribe');
    if (POSIX) expect(statSync(file).mode & 0o777).toBe(0o600);
  });
  it('take BREAKROCKS_PROFILE when --profile is not given', async () => {
    const h = harness({ env: { BREAKROCKS_PROFILE: 'ci' } });
    await h.run('profile', 'add', 'ci', '--env', 'dev', '--json');
    await h.run('profile', 'add', 'other', '--json');
    expect(await h.run('profile', 'show', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ name: 'ci' });
  });
  it('keep the environment of their account: another --env is refused (ENV_MISMATCH)', async () => {
    const h = harness();
    await h.run('profile', 'add', 'atlas', '--env', 'dev', '--json');
    const file = join(h.dir, 'config', 'config.json');
    const config = JSON.parse(readFileSync(file, 'utf8'));
    config.profiles.atlas.kind = 'operator';
    (await import('node:fs')).writeFileSync(file, JSON.stringify(config));
    expect(await h.run('--env', 'prod', 'profile', 'show', '--json')).toBe(2);
    expect(last<{ error: { code: string } }>(h).error.code).toBe('ENV_MISMATCH');
    expect(await h.run('profile', 'show', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ env: 'dev', kind: 'operator' });
    expect(await h.run('--env', 'staging', '--profile', 'fresh', 'profile', 'show', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ name: 'fresh', env: 'staging' });
  });
});
