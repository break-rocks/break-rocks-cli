// The installers against a fake server of the releases on 127.0.0.1: install.sh on macOS and
// Linux (the executable of the system, its SHA-256 checked, ~/.local/bin or BREAKROCKS_INSTALL_DIR,
// the PATH told, never sudo), install.ps1 where PowerShell is (on Windows in the CI); shellcheck
// when it is installed.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assetName } from '../src/commands/update.js';
import { tempDir } from './helpers.js';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const has = async (command: string, args: string[]) => { try { await exec(command, args); return true; } catch { return false; } };

// A fake executable: a script that answers its version (what the installer runs once installed).
const BINARY = Buffer.from('#!/bin/sh\necho 9.9.9\n');
const EXE = Buffer.from('MZ not really an executable');
let server: Server;
let base = '';
let sumFor: (data: Buffer) => string = (d) => createHash('sha256').update(d).digest('hex');
const requested: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    requested.push(req.url ?? '');
    const m = /^\/(?:latest\/download|download\/v9\.9\.9)\/(breakrocks-[a-z0-9-]+(?:\.exe)?)(\.sha256)?$/.exec(req.url ?? '');
    if (!m) { res.writeHead(404); res.end(); return; }
    const data = m[1].endsWith('.exe') ? EXE : BINARY;
    res.writeHead(200);
    res.end(m[2] ? `${sumFor(data)}  ${m[1]}\n` : data);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});
afterAll(() => { server?.close(); });

const posix = process.platform !== 'win32';

describe.runIf(posix)('install.sh', () => {
  const script = join(root, 'scripts', 'install.sh');
  const runInstall = (env: Record<string, string>) => exec('sh', [script], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: env.HOME ?? tempDir(), BREAKROCKS_DOWNLOAD_URL: base, ...env } });

  it('installs the executable of the system, its SHA-256 checked, and says how to add it to the PATH', async () => {
    const dir = join(tempDir(), 'bin');
    sumFor = (d) => createHash('sha256').update(d).digest('hex');
    const { stderr } = await runInstall({ BREAKROCKS_INSTALL_DIR: dir });
    const target = join(dir, 'breakrocks');
    expect(readFileSync(target)).toEqual(BINARY);
    expect(statSync(target).mode & 0o111).not.toBe(0);
    expect(requested).toContain(`/latest/download/${assetName(process.platform, process.arch)}`);
    expect(stderr).toContain(`Installed breakrocks 9.9.9 in ${target}`);
    expect(stderr).toContain(`export PATH="${dir}:$PATH"`);
    expect(stderr).toContain('breakrocks completion --install');
  });
  it('installs in ~/.local/bin by default, and a version asked', async () => {
    const home = tempDir();
    await runInstall({ HOME: home, BREAKROCKS_VERSION: '9.9.9' });
    expect(readFileSync(join(home, '.local', 'bin', 'breakrocks'))).toEqual(BINARY);
    expect(requested.some((r) => r.startsWith('/download/v9.9.9/'))).toBe(true);
  });
  it('installs nothing when the SHA-256 differs', async () => {
    const dir = join(tempDir(), 'bin');
    sumFor = () => 'b'.repeat(64);
    await expect(runInstall({ BREAKROCKS_INSTALL_DIR: dir })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('nothing was installed') });
    expect(existsSync(join(dir, 'breakrocks'))).toBe(false);
    sumFor = (d) => createHash('sha256').update(d).digest('hex');
  });
  it('passes shellcheck (when it is installed)', async () => {
    if (!(await has('shellcheck', ['--version']))) return;
    await expect(exec('shellcheck', ['-s', 'sh', script])).resolves.toBeDefined();
  });
});

describe('install.ps1', () => {
  it('installs the executable of Windows, its SHA-256 checked (where PowerShell is)', async () => {
    const pwsh = (await has('pwsh', ['-NoProfile', '-Command', 'exit 0'])) ? 'pwsh' : process.platform === 'win32' && (await has('powershell', ['-NoProfile', '-Command', 'exit 0'])) ? 'powershell' : undefined;
    if (!pwsh) return;
    const dir = join(tempDir(), 'bin');
    sumFor = (d) => createHash('sha256').update(d).digest('hex');
    await exec(pwsh, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts', 'install.ps1')], { env: { ...process.env, BREAKROCKS_DOWNLOAD_URL: base, BREAKROCKS_INSTALL_DIR: dir, BREAKROCKS_NO_MODIFY_PATH: '1' } });
    expect(readFileSync(join(dir, 'breakrocks.exe'))).toEqual(EXE);
    sumFor = () => 'c'.repeat(64);
    const other = join(tempDir(), 'bin');
    await expect(exec(pwsh, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts', 'install.ps1')], { env: { ...process.env, BREAKROCKS_DOWNLOAD_URL: base, BREAKROCKS_INSTALL_DIR: other, BREAKROCKS_NO_MODIFY_PATH: '1' } })).rejects.toBeDefined();
    expect(existsSync(join(other, 'breakrocks.exe'))).toBe(false);
    sumFor = (d) => createHash('sha256').update(d).digest('hex');
  }, 60_000);
});
