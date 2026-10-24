// update: the latest release read on GitHub (a fake), the executable of the system and its SHA-256
// downloaded and checked, the executable replaced in place; installed by npm, the way to update
// told; --check only tells; a private repository read with GH_TOKEN.
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assetName, compareVersions } from '../src/commands/update.js';
import { VERSION } from '../src/version.js';
import { harness, last } from './helpers.js';

const NAME = assetName(process.platform, process.arch)!;
const NEXT = '99.0.0';

function releases(options: { binary?: Buffer; sha?: string; status?: number; requireToken?: boolean } = {}) {
  const binary = options.binary ?? Buffer.from('#!/bin/sh\necho 99.0.0\n');
  const sha = options.sha ?? createHash('sha256').update(binary).digest('hex');
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seen.push({ url, headers });
    if (options.requireToken && headers.authorization !== 'Bearer gh-test') return new Response('{"message":"Not Found"}', { status: 404 });
    if (url === 'https://api.github.com/repos/break-rocks/break-rocks-cli/releases/latest' || url.endsWith(`/tags/v${NEXT}`)) {
      if (options.status) return new Response('{}', { status: options.status });
      const asset = (name: string, id: number) => ({ name, url: `https://api.github.com/repos/break-rocks/break-rocks-cli/releases/assets/${id}`, browser_download_url: `https://github.com/break-rocks/break-rocks-cli/releases/download/v${NEXT}/${name}` });
      return new Response(JSON.stringify({ tag_name: `v${NEXT}`, html_url: `https://github.com/break-rocks/break-rocks-cli/releases/tag/v${NEXT}`, assets: [asset(NAME, 1), asset(`${NAME}.sha256`, 2), asset('SHA256SUMS', 3)] }), { status: 200 });
    }
    if (url.endsWith(`/download/v${NEXT}/${NAME}`) || url.endsWith('/assets/1')) return new Response(binary);
    if (url.endsWith(`/download/v${NEXT}/${NAME}.sha256`) || url.endsWith('/assets/2')) return new Response(`${sha}  ${NAME}\n`);
    return new Response('not found', { status: 404 });
  };
  return { fetch, seen, binary };
}

describe('update', () => {
  it('compares versions and names the executable of each system', () => {
    expect(compareVersions('0.8.0', '0.7.0')).toBe(1);
    expect(compareVersions('v0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('0.8.0', '0.8.0')).toBe(0);
    expect(compareVersions('0.8.0-rc.1', '0.8.0')).toBe(-1);
    expect(assetName('darwin', 'arm64')).toBe('breakrocks-darwin-arm64');
    expect(assetName('win32', 'x64')).toBe('breakrocks-windows-x64.exe');
    expect(assetName('linux', 'arm64')).toBe('breakrocks-linux-arm64');
    expect(assetName('freebsd', 'x64')).toBeUndefined();
  });
  it('--check tells that a newer release exists, and changes nothing', async () => {
    const r = releases();
    const h = harness({ fetch: r.fetch });
    const exe = join(h.dir, 'breakrocks');
    writeFileSync(exe, 'old');
    h.io.executable = { path: exe, kind: 'binary' };
    expect(await h.run('update', '--check', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ current: VERSION, latest: NEXT, updateAvailable: true, installation: 'binary', updated: false, next: 'breakrocks update' });
    expect(readFileSync(exe, 'utf8')).toBe('old');
    expect(r.seen.every((s) => !s.url.includes('/download/'))).toBe(true);
  });
  it('replaces a single executable with the one of the release, its SHA-256 checked', async () => {
    const r = releases();
    const h = harness({ fetch: r.fetch });
    const exe = join(h.dir, process.platform === 'win32' ? 'breakrocks.exe' : 'breakrocks');
    writeFileSync(exe, 'old', { mode: 0o755 });
    h.io.executable = { path: exe, kind: 'binary' };
    expect(await h.run('update', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ updated: true, latest: NEXT, asset: NAME, path: exe, sha256: createHash('sha256').update(r.binary).digest('hex') });
    expect(readFileSync(exe)).toEqual(r.binary);
    if (process.platform !== 'win32') expect(statSync(exe).mode & 0o777).toBe(0o755);
  });
  it('replaces nothing when the SHA-256 differs', async () => {
    const r = releases({ sha: 'a'.repeat(64) });
    const h = harness({ fetch: r.fetch });
    const exe = join(h.dir, 'breakrocks');
    writeFileSync(exe, 'old');
    h.io.executable = { path: exe, kind: 'binary' };
    expect(await h.run('update', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'CHECKSUM_MISMATCH', asset: NAME } });
    expect(readFileSync(exe, 'utf8')).toBe('old');
  });
  it('installed by npm, says how to update instead', async () => {
    const h = harness({ fetch: releases().fetch });
    h.io.executable = { path: '/usr/lib/node_modules/breakrocks/dist/commands/update.js', kind: 'npm' };
    expect(await h.run('update', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ updated: false, installation: 'npm', next: expect.stringContaining('npm i -g breakrocks@latest') });
  });
  it('reads a private repository with GH_TOKEN, through the API of its assets', async () => {
    const r = releases({ requireToken: true });
    const without = harness({ fetch: r.fetch });
    expect(await without.run('update', '--check', '--json')).toBe(1);
    expect(last(without)).toMatchObject({ error: { code: 'RELEASE_NOT_FOUND', message: expect.stringContaining('GH_TOKEN') } });
    const h = harness({ fetch: r.fetch, env: { GH_TOKEN: 'gh-test' } });
    const exe = join(h.dir, 'breakrocks');
    writeFileSync(exe, 'old');
    h.io.executable = { path: exe, kind: 'binary' };
    expect(await h.run('update', '--json')).toBe(0);
    expect(r.seen.filter((s) => s.url.includes('/assets/')).map((s) => s.headers.accept)).toEqual(['application/octet-stream', 'application/octet-stream']);
    expect(h.all()).not.toContain('gh-test');
  });
  it('says when it is up to date', async () => {
    const h = harness({ fetch: async () => new Response(JSON.stringify({ tag_name: `v${VERSION}`, assets: [] })) });
    h.io.executable = { path: join(h.dir, 'breakrocks'), kind: 'binary' };
    expect(await h.run('update')).toBe(0);
    expect(h.lines.at(-1)).toBe(`Up to date (${VERSION})`);
  });
});
