// The browser sign-in on native-sulfur (client `cli`, RFC 8252 loopback + PKCE S256; server core/auth/cli-handoff.ts):
// the CLI listens on 127.0.0.1 (a random port), opens the web page `/cli/login?port=&state=&challenge=` of the environment;
// the person confirms there, the page asks `POST /auth/cli/authorize` for an authorization code and sends the browser to
// `http://127.0.0.1:<port>/cb?code=&state=` (the path is exactly `/cb`); the CLI checks the state and exchanges the code at
// `/oauth/token` with its verifier and the same redirect URI. The code (60 s, one use) is never a token and never printed.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import type { Context } from '../context.js';
import type { Environment } from '../config.js';
import { CliError, EXIT, cliRefusal, platformRefusal } from '../errors.js';
import { openInBrowser } from '../open-browser.js';
import { authRefusal, SULFUR_DEFAULT_CELL, SULFUR_SITES, sulfurBase, sulfurPost } from './http.js';
import { finish } from './auth.js';
import { CLIENT_ID, type SulfurSession } from './session.js';

export const CALLBACK_PATH = '/cb';
export const BROWSER_SECONDS = 300;
const CODE = /^[A-Za-z0-9._~-]{16,512}$/;

/** The web site of the environment (BREAKROCKS_WEB_URL replaces it, a preview for instance). */
export const sulfurWebOrigin = (ctx: Context, env: Environment) => new URL(ctx.env.BREAKROCKS_WEB_URL?.trim() || `https://${SULFUR_SITES[env]}`).origin;

/** The page that confirms the connection: /cli/login?port=&state=&challenge=. */
export function browserLoginUrl(origin: string, port: number, state: string, challenge: string): string {
  const url = new URL('/cli/login', origin);
  url.searchParams.set('port', String(port));
  url.searchParams.set('state', state);
  url.searchParams.set('challenge', challenge);
  return url.href;
}

/**
 * Whether the default of `login` is the browser: a terminal, not an SSH session, and a display on Linux (macOS and Windows have
 * one). `BREAKROCKS_NO_BROWSER=1` says no, `BREAKROCKS_BROWSER=1` says yes.
 */
export function canOpenBrowser(ctx: Context, platform: NodeJS.Platform = process.platform): boolean {
  const e = ctx.env;
  if (e.BREAKROCKS_NO_BROWSER) return false;
  if (e.BREAKROCKS_BROWSER) return true;
  if (!ctx.io.interactive) return false;
  if (e.SSH_CONNECTION || e.SSH_CLIENT || e.SSH_TTY) return false;
  if (platform === 'linux' || platform === 'freebsd' || platform === 'openbsd') return !!(e.DISPLAY || e.WAYLAND_DISPLAY);
  return true;
}

const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const page = (title: string, text: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font:16px system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem"><h1 style="font-size:1.25rem">${title}</h1><p>${text}</p></body></html>`;

type Callback = { code: string };
export type LoopbackServer = { port: number; redirectUri: string; result: Promise<Callback>; close: () => void };

/**
 * Listens on 127.0.0.1 (a free port, or [port]) for GET /cb?code=&state=. A wrong state, a code of a wrong shape, another
 * path or another Host is refused and the wait goes on; `error=access_denied` (the person refused on the page) and the first
 * good code end it. Refuses after [timeoutMs] (BROWSER_LOGIN_TIMEOUT, exit 3).
 */
export async function loopbackServer(options: { state: string; timeoutMs: number; port?: number }): Promise<LoopbackServer> {
  let resolveCode!: (c: Callback) => void, rejectCode!: (e: Error) => void;
  const result = new Promise<Callback>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  result.catch(() => undefined);
  let done = false;
  const answer = (res: ServerResponse, status: number, title: string, text: string) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" });
    res.end(page(title, text));
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const host = req.headers.host ?? '';
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    if (url.pathname !== CALLBACK_PATH || req.method !== 'GET' || host !== `127.0.0.1:${port}`) return answer(res, 404, 'Not found', 'Nothing here.');
    const state = url.searchParams.get('state') ?? '';
    if (done || !same(state, options.state)) return answer(res, 400, 'Not accepted', 'This link is not the one of the command that is waiting. Run breakrocks login again.');
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code') ?? '';
    if (!error && !CODE.test(code)) return answer(res, 400, 'Not accepted', 'The code is missing or not valid. Run breakrocks login again.');
    done = true;
    res.once('finish', close);
    if (error) {
      answer(res, 200, 'Sign-in cancelled', 'You can close this tab: the command line was not connected.');
      rejectCode(error === 'access_denied' ? platformRefusal('BROWSER_LOGIN_DENIED', 'The sign-in was refused in the browser') : platformRefusal('BROWSER_LOGIN_FAILED', `The browser sign-in failed (${error.slice(0, 64).replace(/[^\w.-]/g, '')})`));
    } else {
      answer(res, 200, 'Command line connected', 'You can close this tab and go back to the terminal.');
      resolveCode({ code });
    }
  });
  const timer = setTimeout(() => { rejectCode(new CliError('BROWSER_LOGIN_TIMEOUT', `No confirmation from the browser within ${Math.round(options.timeoutMs / 1000)} s: run breakrocks login again (or login --device)`, EXIT.NETWORK)); close(); }, options.timeoutMs);
  (timer as { unref?: () => void }).unref?.();
  function close() { clearTimeout(timer); server.close(); server.closeAllConnections?.(); }
  await new Promise<void>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => reject(cliRefusal('PORT_UNAVAILABLE', `Cannot listen on 127.0.0.1:${options.port ?? 0} (${error.code ?? error.message})`, { port: options.port ?? 0 })));
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { port, redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`, result, close };
}

/** State and verifier of 32 random bytes, and the S256 challenge of the verifier. */
export function browserSecrets(random: (n: number) => Buffer = randomBytes) {
  const state = random(32).toString('base64url');
  const verifier = random(32).toString('base64url');
  return { state, verifier, challenge: createHash('sha256').update(verifier, 'ascii').digest('base64url') };
}

/** The browser sign-in: the page opened (or its address written), the code received, exchanged, the session saved. */
export async function browserSignIn(ctx: Context, env: Environment, options: { cell?: string; open?: boolean; timeoutSeconds?: number; port?: number } = {}): Promise<SulfurSession> {
  const cell = options.cell ?? SULFUR_DEFAULT_CELL;
  const { state, verifier, challenge } = browserSecrets();
  const server = await loopbackServer({ state, port: options.port, timeoutMs: (options.timeoutSeconds ?? BROWSER_SECONDS) * 1000 });
  let code: string;
  try {
    const url = browserLoginUrl(sulfurWebOrigin(ctx, env), server.port, state, challenge);
    ctx.notice(`To sign in, open this address in your browser: ${url}`);
    if (options.open !== false && !(await (ctx.io.openUrl ?? openInBrowser)(url))) ctx.notice('The browser could not be opened: open the address above, or use login --device.');
    ctx.progress('Waiting for the confirmation in the browser (Ctrl-C to cancel)');
    code = (await server.result).code;
  } finally { server.close(); }
  const tokens = await sulfurPost(ctx, sulfurBase(ctx, env, cell), '/oauth/token', { grant_type: 'authorization_code', client_id: CLIENT_ID, code, code_verifier: verifier, redirect_uri: server.redirectUri }, { form: true });
  if (tokens.status !== 200) throw authRefusal(tokens, 'The browser sign-in');
  return finish(ctx, env, cell, tokens.json, 'browser');
}
