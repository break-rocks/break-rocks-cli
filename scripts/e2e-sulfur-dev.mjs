#!/usr/bin/env node
// The journey of the CLI on native-sulfur in dev, by hand or in a host-side check (README § The new
// backend): a headless sign-up by e-mail code (the code on stdin, the handle taken), whoami, the profile with its avatar,
// posts (two images in the first post of a new universe and its sub-level, a clip when BREAKROCKS_E2E_CLIP names a vertical MP4), a
// reply, a quote and a repost into %root, a like, the thread, the universe feed, join and leave (read back), follow and
// unfollow (read back), a group and a quick poll, its changes (catch-up), delete (read back), another environment refused, the timeline, a
// command not served, sign-out, sign-in again.
// The e-mail codes come from the dev e2e mailbox (*@inbox.dev.break.rocks) through the server's helper
// (tools/e2e-mailbox/cli.ts): BREAKROCKS_SERVER_DIR names the server checkout (default ../server), AWS_PROFILE its
// credentials (default breakrocks-dev). A fresh configuration folder in the system's temporary folder, the tokens in a file
// (no keychain), removed at the end. Never run against prod. Usage: npm run build && node scripts/e2e-sulfur-dev.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = resolve(process.env.BREAKROCKS_SERVER_DIR ?? join(root, '..', 'server'));
const config = mkdtempSync(join(tmpdir(), 'breakrocks-e2e-sulfur-'));
const env = { ...process.env, BREAKROCKS_CONFIG_DIR: config, BREAKROCKS_KEYCHAIN: 'off', NO_COLOR: '1' };
delete env.BREAKROCKS_PROFILE;

function cli(...args) {
  const options = typeof args[0] === 'object' ? args.shift() : {};
  const r = spawnSync(process.execPath, [join(root, 'bin', 'breakrocks.js'), '--env', 'dev', ...args, '--json'], { env, encoding: 'utf8', input: options.input });
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

/** A PNG of [w]×[h] pixels of one colour (no file in git, no dependency). */
function png(path, w, h, rgb) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, sum]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]));
  return path;
}

const stamp = Date.now();
const address = `cli-e2e-${stamp}@inbox.dev.break.rocks`;
const handle = `cli_e2e_${String(stamp).slice(-8)}`;
const text = `CLI e2e ${new Date().toISOString()}`;
const red = png(join(config, 'red.png'), 64, 48, [200, 30, 30]);
const blue = png(join(config, 'blue.png'), 48, 64, [30, 30, 200]);
// The sign-up: the code given on the standard input, the handle taken.
const since = Date.now() - 2000;
expectOk('sign-up: code sent', cli('login', '--email', address, '--sign-up'), (o) => o?.codeSent === true);
const account = expectOk('sign-up: code typed (stdin), handle taken', cli({ input: mailCode(address, since) }, 'login', '--email', address, '--code', '-', '--handle', handle), (o) => o?.session?.kind === 'untrusted' && o.handle === handle);
expectOk('whoami', cli('whoami'), (o) => o.account?.id === account.accountId && o.account.handle === handle);
expectOk('profile set (name, bio, avatar)', cli('me', 'profile', 'set', '--display-name', 'CLI E2E', '--bio', 'The CLI journey', '--avatar-file', red), (o) => o.displayName === 'CLI E2E' && !!o.avatar?.id);
expectOk('profile show', cli('me', 'profile', 'show'), (o) => o.displayName === 'CLI E2E' && o.bio === 'The CLI journey');
const post = expectOk('post in %root', cli('posts', 'create', `${text} #clie2e`, '--in', '%root'), (o) => !!o.id && o.tags?.includes('clie2e'));
const universe = `%clie2e${String(stamp).slice(-6)}`;
// A public universe and its levels are created by their first post, which carries its images (the upload names the posting
// address, no universe is looked up).
const images = expectOk('a new universe and its sub-level, by a first post with two images', cli('posts', 'create', 'Two images', '--in', `${universe}/sub`, '--image', red, '--alt', 'Red', '--image', blue, '--alt', 'Blue'), (o) => o.universe === `${universe}/sub` && o.images?.length === 2);
expectOk('resolve an address (resolveAddress)', cli('explore', 'resolve', `${universe}/sub`), (o) => typeof o?.address === 'string' && typeof o.url === 'string');
if (process.env.BREAKROCKS_E2E_CLIP) expectOk('post with a vertical clip', cli('posts', 'create', 'A clip', '--in', universe, '--video', process.env.BREAKROCKS_E2E_CLIP), (o) => !!o.clip?.id);
// A post is published once its media are processed (server D-422): replies wait for it (NOT_PUBLISHED meanwhile).
const pause = () => spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 2000)']);
// The first post carried images: its universe is placed once the media are processed (server D-422), a moment later.
let made = cli('universes', 'show', universe);
for (let i = 0; i < 30 && made.out?.universe?.exists !== true; i++) { pause(); made = cli('universes', 'show', universe); }
expectOk('the new universe (placed when its first post is published)', made, (o) => o.universe?.exists === true);
let reply = cli('posts', 'reply', images.id, 'A reply', '--image', blue);
for (let i = 0; i < 30 && reply.out?.error?.code === 'NOT_PUBLISHED'; i++) { pause(); reply = cli('posts', 'reply', images.id, 'A reply', '--image', blue); }
expectOk('reply with an image (once the post is published)', reply, (o) => o.parentId === images.id);
expectOk('quote into %root', cli('posts', 'quote', images.id, 'A quote', '--in', '%root'), (o) => o.universe === '%root');
expectOk('repost into %root', cli('posts', 'repost', images.id, '--universe', '%root'), (o) => o.universe === '%root');
expectOk('like', cli('posts', 'like', images.id), (o) => o.likedByMe === true);
expectOk('thread', cli('posts', 'thread', images.id), (o) => Array.isArray(o.items));
expectOk('universe feed', cli('posts', 'list', `${universe}/sub`), (o) => o.items?.some((p) => p.id === images.id));
const readerRole = () => cli('universes', 'show', universe).out?.universe?.myReaderRole;
expectOk('join', cli('universes', 'join', universe), (o) => o !== null && typeof o === 'object');
expectOk('joined: a resident', { code: 0, out: readerRole(), err: '' }, (role) => role === 'RESIDENT');
expectOk('leave', cli('universes', 'leave', universe, '--yes'), (o) => o?.name === universe);
expectOk('left: no longer a resident', { code: 0, out: readerRole(), err: '' }, (role) => !!role && role !== 'RESIDENT');
// Follow an author of %root other than this account (an account, or an account in a universe: a universe alone is not followed).
const other = (cli('posts', 'list', '%root').out?.items ?? []).map((p) => p.author?.handle).find((h) => h && h !== handle);
if (other) {
  expectOk(`follow @${other}`, cli('accounts', 'follow', `@${other}`), (o) => o.address === `@${other}`);
  expectOk('is following', cli('accounts', 'is-following', `@${other}`), (o) => o === true);
  expectOk('unfollow', cli('accounts', 'unfollow', `@${other}`), (o) => o === null);
  expectOk('no longer following', cli('accounts', 'is-following', `@${other}`), (o) => o === false);
  // A group with an account not connected: the group made, the invitation refused told beside it (or, on a server
  // without partial answers yet, left out).
  const group = expectOk('a group with an account not connected', cli('messages', 'groups', 'create', `CLI e2e ${stamp}`, `@${other}`), (o) => !!o?.group?.id && Array.isArray(o.refused) && o.refused.every((r) => r.accountId && r.code));
  expectOk('a quick poll in the group (its discussion by its id)', cli('messages', 'quick-poll', 'Ride on Sunday?', '--choices', 'yes,no', '--group', group.group.id), (o) => !!o?.id);
  const said = expectOk('a message in the group', cli('messages', 'groups', 'send', group.group.id, 'Catching up'), (o) => !!o?.id);
  // The catch-up: the new messages since a time, the pages followed to the end (messageChanges; its index lags a moment).
  const sinceHour = new Date(Date.now() - 3600_000).toISOString();
  let changes = cli('messages', 'changes', '--group', group.group.id, '--since', sinceHour);
  for (let i = 0; i < 10 && changes.code === 0 && !changes.out?.items?.length; i++) { pause(); changes = cli('messages', 'changes', '--group', group.group.id, '--since', sinceHour); }
  expectOk('the changes of the group since an hour (the catch-up)', changes, (o) => o?.items?.some((m) => m.id === said.id) && !o.next);
}
const gone = expectOk('a post to delete', cli('posts', 'create', 'To delete', '--in', '%root'), (o) => !!o.id);
expectOk('delete', cli('posts', 'delete', gone.id, '--yes'), (o) => o?.id === gone.id && o.deleted === true);
expectOk('deleted: no longer read', cli('posts', 'show', gone.id), (o) => o?.post === null);
// A session of dev is never used for another environment (nothing sent).
expectOk('another environment refused', { ...cli('--env', 'prod', 'whoami'), code: 0 }, (o) => o?.error?.code === 'ENV_MISMATCH');
// The timeline is written after the post (asynchronously): read again for up to 30 s.
const inFeed = (o) => o?.items?.some((p) => p.id === post.id);
let feed = cli('posts', 'feed', '--limit', '20');
for (let i = 0; i < 15 && feed.code === 0 && !inFeed(feed.out); i++) { pause(); feed = cli('posts', 'feed', '--limit', '20'); }
expectOk('timeline', feed, inFeed);
expectOk('not served there', { ...cli('look', 'personal', 'saved'), code: 0 }, (o) => o?.error?.code === 'NOT_AVAILABLE' && o.error.operation === 'personalThemes');
expectOk('logout', cli('logout'), (o) => o.signedOut && o.revoked);
expectOk('signed out', { ...cli('whoami'), code: 0 }, (o) => o?.error?.code === 'SIGN_IN_REQUIRED');
signIn('sign-in again', address, false);
expectOk('whoami again', cli('whoami'), (o) => o.account?.id === account.accountId && o.account?.name === 'CLI E2E');
expectOk('logout again', cli('logout'), (o) => o.signedOut);
rmSync(config, { recursive: true, force: true });
console.log(`journey done on dev: ${account.accountId} @${handle}`);
