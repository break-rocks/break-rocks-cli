#!/usr/bin/env node
// The journey of the CLI on the new backend (native-sulfur) in dev, by hand or in a host-side check (README § The new
// backend): sign-up by e-mail code, whoami, profile show and set, a post in %root, the timeline, sign-out, sign-in again.
// The e-mail codes come from the dev e2e mailbox (*@inbox.dev.break.rocks) through the server's helper
// (tools/e2e-mailbox/cli.ts): BREAKROCKS_SERVER_DIR names the server checkout (default ../server), AWS_PROFILE its
// credentials (default breakrocks-dev). A fresh configuration folder in the system's temporary folder, the tokens in a file
// (no keychain), removed at the end. Never run against prod. Usage: npm run build && node scripts/e2e-sulfur-dev.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = resolve(process.env.BREAKROCKS_SERVER_DIR ?? join(root, '..', 'server'));
const config = mkdtempSync(join(tmpdir(), 'breakrocks-e2e-sulfur-'));
const env = { ...process.env, BREAKROCKS_CONFIG_DIR: config, BREAKROCKS_KEYCHAIN: 'off', BREAKROCKS_BACKEND: 'sulfur', NO_COLOR: '1' };
delete env.BREAKROCKS_PROFILE;

function cli(...args) {
  const r = spawnSync(process.execPath, [join(root, 'bin', 'breakrocks.js'), '--env', 'dev', ...args, '--json'], { env, encoding: 'utf8' });
  let out;
  try { out = JSON.parse(r.stdout || 'null'); } catch { out = r.stdout; }
  return { code: r.status, out, err: r.stderr };
}
function expectOk(step, r, check = () => true) {
  const ok = r.code === 0 && check(r.out);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${ok ? '' : `: exit ${r.code} ${JSON.stringify(r.out)} ${r.err.trim()}`}`);
  if (!ok) { rmSync(config, { recursive: true, force: true }); process.exit(1); }
  return r.out;
}
function mailCode(address, since) {
  const r = spawnSync('npx', ['tsx', 'tools/e2e-mailbox/cli.ts', 'code', address, '--since', String(since), '--timeout', '90'], { cwd: serverDir, env: { ...process.env, AWS_PROFILE: process.env.AWS_PROFILE ?? 'breakrocks-dev' }, encoding: 'utf8', shell: process.platform === 'win32' });
  const code = r.stdout.trim();
  if (r.status !== 0 || !/^[0-9]{8}$/.test(code)) { console.log(`FAIL e-mail code for ${address}: ${r.stderr.trim()}`); rmSync(config, { recursive: true, force: true }); process.exit(1); }
  // As the e-mail shows it: two groups of four.
  return `${code.slice(0, 4)} ${code.slice(4)}`;
}
function signIn(step, address, signUp) {
  const since = Date.now() - 2000;
  expectOk(`${step}: code sent`, cli('login', '--email', address, ...(signUp ? ['--sign-up'] : [])), (o) => o?.codeSent === true);
  return expectOk(`${step}: code typed`, cli('login', '--email', address, '--code', mailCode(address, since)), (o) => o?.session?.kind === 'untrusted');
}

const address = `cli-e2e-${Date.now()}@inbox.dev.break.rocks`;
const text = `CLI e2e ${new Date().toISOString()}`;
const account = signIn('sign-up', address, true);
expectOk('whoami', cli('whoami'), (o) => o.account?.id === account.accountId);
expectOk('profile set', cli('me', 'profile', 'set', '--name', 'CLI E2E'), (o) => o.name === 'CLI E2E');
expectOk('profile show', cli('me', 'profile', 'show'), (o) => o.name === 'CLI E2E');
const post = expectOk('post in %root', cli('posts', 'create', text, '--in', '%root'), (o) => !!o.id);
// The timeline is written after the post (asynchronously): read again for up to 30 s.
const inFeed = (o) => o?.items?.some((p) => p.id === post.id || p.text === text);
let feed = cli('posts', 'feed', '--limit', '20');
for (let i = 0; i < 15 && feed.code === 0 && !inFeed(feed.out); i++) { spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 2000)']); feed = cli('posts', 'feed', '--limit', '20'); }
expectOk('timeline', feed, inFeed);
expectOk('not served there', { ...cli('universes', 'join', '%root'), code: 0 }, (o) => o?.error?.code === 'NOT_ON_NEW_BACKEND');
expectOk('logout', cli('logout'), (o) => o.signedOut && o.revoked);
expectOk('signed out', { ...cli('whoami'), code: 0 }, (o) => o?.error?.code === 'SIGN_IN_REQUIRED');
signIn('sign-in again', address, false);
expectOk('whoami again', cli('whoami'), (o) => o.account?.id === account.accountId && o.account?.name === 'CLI E2E');
expectOk('logout again', cli('logout'), (o) => o.signedOut);
rmSync(config, { recursive: true, force: true });
console.log(`journey done on dev: ${account.accountId}`);
