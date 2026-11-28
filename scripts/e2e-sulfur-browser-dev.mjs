#!/usr/bin/env node
// `login --browser` on native-sulfur in dev (README § native-sulfur): the CLI is started with --no-open and waits on
// 127.0.0.1; this script plays the web page: a web session by e-mail code (the dev e2e mailbox, as e2e-sulfur-dev.mjs),
// `POST /auth/cli/authorize` with its token (client `cli`, loopback redirect `/cb`, the challenge of the page address), then
// the browser's redirect to `http://127.0.0.1:<port>/cb?code=&state=`. Then whoami. Never run against prod.
// Usage: npm run build && node scripts/e2e-sulfur-browser-dev.mjs (BREAKROCKS_SERVER_DIR, AWS_PROFILE as the other journey).
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = resolve(process.env.BREAKROCKS_SERVER_DIR ?? join(root, '..', 'server'));
const api = process.env.BREAKROCKS_SULFUR_URL ?? 'https://eu.api.dev.break.rocks';
const config = mkdtempSync(join(tmpdir(), 'breakrocks-e2e-sulfur-browser-'));
const env = { ...process.env, BREAKROCKS_CONFIG_DIR: config, BREAKROCKS_KEYCHAIN: 'off', NO_COLOR: '1' };
delete env.BREAKROCKS_PROFILE;
const done = (code) => { rmSync(config, { recursive: true, force: true }); process.exit(code); };
const check = (step, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${ok ? '' : `: ${detail}`}`); if (!ok) done(1); };
const sha = (s) => createHash('sha256').update(s).digest('hex');

async function post(path, body, { form = false, token } = {}) {
  const raw = form ? new URLSearchParams(body).toString() : JSON.stringify(body);
  const res = await fetch(`${api}${path}`, { method: 'POST', headers: { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json', 'x-amz-content-sha256': sha(raw), ...(token ? { 'x-authorization': `Bearer ${token}` } : {}) }, body: raw });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
function mailCode(address, since) {
  const r = spawnSync('npx', ['tsx', 'tools/e2e-mailbox/cli.ts', 'code', address, '--since', String(since), '--timeout', '90'], { cwd: serverDir, env: { ...process.env, AWS_PROFILE: process.env.AWS_PROFILE ?? 'breakrocks-dev' }, encoding: 'utf8' });
  const code = r.stdout.trim();
  check('e-mail code', r.status === 0 && /^[0-9]{8}$/.test(code), r.stderr.trim());
  return code;
}
const b64 = (b) => b.toString('base64url');

// 1. The CLI waits.
const child = spawn(process.execPath, [join(root, 'bin', 'breakrocks.js'), '--env', 'dev', 'login', '--browser', '--no-open', '--timeout', '120', '--json'], { env });
let stderr = '', stdout = '';
child.stderr.on('data', (d) => { stderr += d; });
child.stdout.on('data', (d) => { stdout += d; });
const exited = new Promise((r) => child.on('close', r));
let page;
for (let n = 0; n < 100 && !page; n++) { await new Promise((r) => setTimeout(r, 100)); const m = /(https:\/\/\S+\/cli\/login\?\S+)/.exec(stderr); if (m) page = new URL(m[1]); }
check('the CLI wrote the page address', !!page, stderr);
const port = page.searchParams.get('port'), state = page.searchParams.get('state'), challenge = page.searchParams.get('challenge');
check('the address has port, state, challenge', /^\d{4,5}$/.test(port) && state.length === 43 && challenge.length === 43);

// 2. The page: a web session by e-mail code (a new account), then the hand-off.
const address = `cli-e2e-browser-${Date.now()}@inbox.dev.break.rocks`;
const verifier = b64(randomBytes(32)), webVerifier = b64(randomBytes(32));
const since = Date.now() - 2000;
const start = await post('/auth/email/start', { email: address, intent: 'sign-up', challenge: b64(createHash('sha256').update(verifier).digest()) });
check('web: code sent', start.status === 200 && start.json.flowId, JSON.stringify(start));
const verified = await post('/auth/email/verify', { email: address, flowId: start.json.flowId, code: mailCode(address, since), verifier });
check('web: code verified', verified.status === 200 && verified.json.ticket, JSON.stringify(verified));
const completed = await post('/auth/complete', { ticket: verified.json.ticket, verifier, clientId: 'web', codeChallenge: b64(createHash('sha256').update(webVerifier).digest()), locale: 'en' });
check('web: authorization code', completed.status === 200 && completed.json.code, JSON.stringify(completed));
const token = await post('/oauth/token', { grant_type: 'authorization_code', client_id: 'web', code: completed.json.code, code_verifier: webVerifier }, { form: true });
check('web: access token', token.status === 200 && token.json.access_token, JSON.stringify(token));
const handoff = await post('/auth/cli/authorize', { clientId: 'cli', redirectUri: `http://127.0.0.1:${port}/cb`, codeChallenge: challenge }, { token: token.json.access_token });
check('/auth/cli/authorize', handoff.status === 200 && handoff.json.code, `${JSON.stringify(handoff)}${handoff.status === 403 ? ' (the edge blocked the loopback address: the WAF exception of D-595 is not deployed on this environment)' : ''}`);
const bad = await fetch(`http://127.0.0.1:${port}/cb?${new URLSearchParams({ code: handoff.json.code, state: b64(randomBytes(32)) })}`);
check('a wrong state is refused and the CLI waits on', bad.status === 400);
const back = await fetch(`http://127.0.0.1:${port}/cb?${new URLSearchParams({ code: handoff.json.code, state })}`);
check('the redirect to /cb is taken', back.status === 200);

// 3. The CLI is signed in.
const code = await exited;
let out; try { out = JSON.parse(stdout); } catch { out = stdout; }
check('login --browser exit 0', code === 0 && out?.session?.method === 'browser' && out?.accountId, `exit ${code} ${stdout} ${stderr}`);
const who = spawnSync(process.execPath, [join(root, 'bin', 'breakrocks.js'), '--env', 'dev', 'whoami', '--json'], { env, encoding: 'utf8' });
check('whoami', who.status === 0 && JSON.parse(who.stdout).account?.id === out.accountId, who.stdout + who.stderr);
const gone = spawnSync(process.execPath, [join(root, 'bin', 'breakrocks.js'), '--env', 'dev', 'logout', '--json'], { env, encoding: 'utf8' });
check('logout', gone.status === 0, gone.stdout + gone.stderr);
console.log('login --browser on dev: all steps passed');
done(0);
