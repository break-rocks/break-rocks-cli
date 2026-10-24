// update (C-03): the latest release of break-rocks-cli on GitHub, the single executable of this
// system and its SHA-256 downloaded, checked, then put in the place of the executable that runs (a
// file renamed over it; on Windows the running one is set aside as .old first). Installed by npm,
// the CLI says how to update instead (npm i -g breakrocks@latest). --check only tells.
// BREAKROCKS_RELEASES_URL replaces the API of the releases (a mirror, a test); GH_TOKEN or
// GITHUB_TOKEN reads them while the repository is private.
import { createHash } from 'node:crypto';
import { chmodSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Context } from '../context.js';
import { CliError, cliRefusal, networkError } from '../errors.js';
import type { Command } from '../registry.js';
import { bool, object, openObject, str } from '../schema.js';
import { request } from '../transport.js';
import { VERSION } from '../version.js';

export const RELEASES_API = 'https://api.github.com/repos/break-rocks/break-rocks-cli/releases';

type Asset = { name: string; url: string; browser_download_url: string; size?: number };
type Release = { tag_name: string; html_url?: string; published_at?: string; assets: Asset[] };

/** The name of the single executable of a system (scripts/build-sea.mjs), undefined where none is built. */
export function assetName(platform: NodeJS.Platform, arch: string): string | undefined {
  const os = platform === 'win32' ? 'windows' : platform;
  const targets = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'windows-x64'];
  return targets.includes(`${os}-${arch}`) ? `breakrocks-${os}-${arch}${os === 'windows' ? '.exe' : ''}` : undefined;
}

/** -1, 0 or 1 as [a] is older, the same or newer than [b] (semantic versions; a pre-release before its release). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => { const [main, pre] = v.replace(/^v/, '').split('-', 2); return { parts: main.split('.').map((n) => Number.parseInt(n, 10) || 0), pre }; };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.parts[i] ?? 0) !== (y.parts[i] ?? 0)) return (x.parts[i] ?? 0) > (y.parts[i] ?? 0) ? 1 : -1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre > y.pre ? 1 : -1;
}

/** How the CLI that runs was installed: a single executable (replaced in place), the npm package, or the repository. */
export async function installation(ctx: Context): Promise<{ path: string; kind: 'binary' | 'npm' | 'source' }> {
  if (ctx.io.executable) return ctx.io.executable;
  try {
    const sea = await import('node:sea');
    if (sea.isSea()) return { path: process.execPath, kind: 'binary' };
  } catch { /* not a single executable */ }
  const here = fileURLToPath(import.meta.url);
  return { path: here, kind: here.includes(`${sep}node_modules${sep}`) ? 'npm' : 'source' };
}

const githubHeaders = (ctx: Context, accept: string): Record<string, string> => {
  const token = ctx.env.GH_TOKEN || ctx.env.GITHUB_TOKEN;
  return { accept, 'user-agent': `breakrocks/${VERSION}`, 'x-github-api-version': '2022-11-28', ...(token ? { authorization: `Bearer ${token}` } : {}) };
};

async function readRelease(ctx: Context, version?: string): Promise<Release> {
  const base = (ctx.env.BREAKROCKS_RELEASES_URL ?? RELEASES_API).replace(/\/+$/, '');
  const url = version ? `${base}/tags/v${version.replace(/^v/, '')}` : `${base}/latest`;
  const res = await request(ctx, url, { method: 'GET', headers: githubHeaders(ctx, 'application/vnd.github+json') });
  if (res.status === 404) {
    const hint = ctx.env.GH_TOKEN || ctx.env.GITHUB_TOKEN ? '' : ' (the repository is private until the publication: set GH_TOKEN to a token that reads it)';
    throw cliRefusal('RELEASE_NOT_FOUND', `${version ? `No release v${version.replace(/^v/, '')}` : 'No release found'}${hint}`, { url });
  }
  if (!res.ok) throw networkError('RELEASES_UNAVAILABLE', `The releases answered ${res.status}`, { status: res.status });
  const release = await res.json() as Release;
  if (!release?.tag_name || !Array.isArray(release.assets)) throw networkError('RELEASES_UNAVAILABLE', 'The answer of the releases is not a release');
  return release;
}

/** The bytes of an asset: through the API with a token (a private repository), else its public address. */
async function download(ctx: Context, asset: Asset): Promise<Buffer> {
  const token = ctx.env.GH_TOKEN || ctx.env.GITHUB_TOKEN;
  const res = await request(ctx, token ? asset.url : asset.browser_download_url, { method: 'GET', headers: token ? githubHeaders(ctx, 'application/octet-stream') : { 'user-agent': `breakrocks/${VERSION}` } });
  if (!res.ok) throw networkError('DOWNLOAD_FAILED', `${asset.name}: the download answered ${res.status}`, { asset: asset.name, status: res.status });
  return Buffer.from(await res.arrayBuffer());
}

/** Puts [data] in the place of the executable [target]: a file next to it renamed over it (on Windows, the running one set aside as .old). */
function replaceExecutable(target: string, data: Buffer): void {
  const fresh = `${target}.new-${process.pid}`;
  try {
    writeFileSync(fresh, data, { mode: 0o755 });
    if (process.platform !== 'win32') { chmodSync(fresh, 0o755); renameSync(fresh, target); return; }
    const old = `${target}.old`;
    rmSync(old, { force: true });
    renameSync(target, old);
    renameSync(fresh, target);
  } catch (error) {
    rmSync(fresh, { force: true });
    const code = (error as NodeJS.ErrnoException).code ?? '';
    throw cliRefusal('UPDATE_NOT_WRITABLE', `Cannot replace ${target} (${code || (error as Error).message}): install again with the installer, into a folder of yours (README § Installation)`, { path: target, folder: dirname(target) });
  }
}

type UpdateResult = {
  current: string; latest: string; updateAvailable: boolean; installation: 'binary' | 'npm' | 'source'; updated: boolean;
  path?: string; asset?: string; sha256?: string; release?: string; next?: string;
};

export const update: Command<{ check?: boolean; tag?: string }, UpdateResult> = {
  name: 'update', summary: 'Update the CLI to its latest release (--check: only tell whether there is one)',
  description: 'Reads the latest release of break-rocks-cli on GitHub; a single executable downloads the one of its system and its SHA-256, checks it, and replaces itself (nothing is written when the SHA-256 differs). Installed by npm: says npm i -g breakrocks@latest. GH_TOKEN reads the releases while the repository is private. Not an MCP tool.',
  examples: ['breakrocks update --check', 'breakrocks update', 'breakrocks update --tag v0.8.0'],
  input: object({ check: bool('Only tell whether a newer release exists'), tag: str('A release to install instead of the latest one (v0.8.0 or 0.8.0)', { pattern: '^v?\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$' }) }),
  output: openObject({
    current: str('The version that runs'), latest: str('The version of the release'), updateAvailable: bool('The release is newer'),
    installation: str('How the CLI was installed: binary, npm or source', { enum: ['binary', 'npm', 'source'] }), updated: bool('The executable was replaced'),
    path: str('The executable replaced'), asset: str('The file of the release'), sha256: str('Its SHA-256, checked'), release: str('The page of the release'), next: str('What to do'),
  }),
  mcp: false,
  run: async (ctx, { check, tag: version }) => {
    const release = await readRelease(ctx, version);
    const latest = release.tag_name.replace(/^v/, '');
    const newer = compareVersions(latest, VERSION) > 0;
    const install = await installation(ctx);
    const base = { current: VERSION, latest, updateAvailable: newer, installation: install.kind, updated: false, ...(release.html_url ? { release: release.html_url } : {}) };
    const wanted = version !== undefined && compareVersions(latest, VERSION) !== 0;
    if (check || (!newer && !wanted)) return { ...base, ...(newer ? { next: install.kind === 'binary' ? 'breakrocks update' : install.kind === 'npm' ? 'npm i -g breakrocks@latest' : 'git pull, then npm ci and npm run build' } : {}) };
    if (install.kind === 'npm') return { ...base, next: `npm i -g breakrocks@${version ? latest : 'latest'} (or npx breakrocks@${version ? latest : 'latest'})` };
    if (install.kind === 'source') return { ...base, next: 'A copy of the repository: git pull, then npm ci and npm run build' };
    const name = assetName(process.platform, process.arch);
    if (!name) throw cliRefusal('PLATFORM_NOT_SUPPORTED', `No executable is built for ${process.platform}-${process.arch}: npm i -g breakrocks@latest`);
    const asset = release.assets.find((a) => a.name === name), sum = release.assets.find((a) => a.name === `${name}.sha256`);
    if (!asset || !sum) throw cliRefusal('ASSET_MISSING', `The release ${release.tag_name} has no ${asset ? `${name}.sha256` : name}`, { asset: name });
    ctx.progress(`Downloading ${name} of ${release.tag_name}`);
    const [data, sumText] = await Promise.all([download(ctx, asset), download(ctx, sum)]);
    const expected = sumText.toString('utf8').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    const actual = createHash('sha256').update(data).digest('hex');
    if (!/^[0-9a-f]{64}$/.test(expected) || expected !== actual) throw new CliError('CHECKSUM_MISMATCH', `${name}: its SHA-256 is not the one of the release; nothing was replaced`, 1, { asset: name, expected, actual });
    replaceExecutable(install.path, data);
    return { ...base, updated: true, path: install.path, asset: name, sha256: actual };
  },
  text: (r) => (r.updated ? `Updated ${r.current} → ${r.latest} (${r.path}, sha256 ${r.sha256})`
    : r.updateAvailable ? `${r.latest} is available (this is ${r.current})${r.next ? `: ${r.next}` : ''}` : `Up to date (${r.current})${r.next ? `\n${r.next}` : ''}`),
  quiet: (r) => r.latest,
};
