// login --browser: the CLI listens on 127.0.0.1 (a port of its own), opens the page /cli/login of
// the web app with that port, a state and the challenge of a verifier (S256, as PKCE); the person
// signed in there confirms "connect the command line on this computer", and the page sends to
// http://127.0.0.1:<port>/callback a code for one use only (never a token): by fetch when the
// browser lets it reach the loopback (CORS open on that local endpoint only, to the origin of the web
// app of the environment only), else by a navigation that comes back to the web app (Chromium and
// WebKit ask a permission for a fetch to the loopback from a public page). The CLI then exchanges
// the code, with its verifier, for a session of the user pool.
//
// The exchange (contracts/accounts.md § The command-line client signed in from the browser, specs
// v49.7.0): the code of the web app (createCliSignInCode, one use, 5 minutes, bound to the account
// and to the challenge) answers the CUSTOM_AUTH challenge of the user pool with its verifier.
import { spawn } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { signInWithCode, type CognitoTokens, type UserPool } from './cognito.js';
import type { Context } from './context.js';
import { CliError, EXIT, cliRefusal } from './errors.js';

/** What the page sends to the CLI (with the state it was given): the code, the username of the account in its user pool, its cell. */
export type BrowserCode = { code: string; username?: string; cell?: string };

/** The exchange of the code of the web app for the tokens of the user pool (with the verifier of its challenge). */
export type CodeExchange =
  | { available: false; reason: string }
  | { available: true; exchange: (ctx: Context, input: { pool: UserPool; code: string; username?: string; verifier: string }) => Promise<CognitoTokens> };

/** The exchange of the platform: the CUSTOM_AUTH flow of the user pool, the username the page gave (USERNAME_MISSING without it). */
export const PLATFORM_EXCHANGE: CodeExchange = {
  available: true,
  exchange: async (ctx, { pool, code, username, verifier }) => {
    if (!username) throw cliRefusal('USERNAME_MISSING', 'The web app gave the code without the username of the account: run breakrocks login --browser again');
    return signInWithCode(ctx, pool, username, code, verifier);
  },
};

export const CALLBACK_PATH = '/callback';
export const BROWSER_LOGIN_SECONDS = 300;
const MAX_BODY = 4096;
const CODE = /^[A-Za-z0-9._~-]{16,512}$/;

const b64url = (bytes: Buffer) => bytes.toString('base64url');
/** A state and a verifier of 32 random bytes, and the S256 challenge of the verifier (RFC 7636). */
export function loginSecrets(random: (n: number) => Buffer = randomBytes) {
  const state = b64url(random(32));
  const verifier = b64url(random(32));
  return { state, verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

/** The page of the web app that confirms the connection: /cli/login?port=&state=&challenge=. */
export function loginPageUrl(webOrigin: string, port: number, state: string, challenge: string): string {
  const url = new URL('/cli/login', webOrigin);
  url.searchParams.set('port', String(port));
  url.searchParams.set('state', state);
  url.searchParams.set('challenge', challenge);
  return url.href;
}

const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export type CallbackServer = { port: number; result: Promise<BrowserCode>; close: () => void };

/** The page of the web app that says the outcome after a navigation to the CLI: /cli/login?outcome=done|refused. */
export const outcomeUrl = (webOrigin: string, outcome: 'done' | 'refused') => new URL(`/cli/login?outcome=${outcome}`, webOrigin).href;

type Fields = { state?: unknown; code?: unknown; username?: unknown; cell?: unknown };

/** Why [fields] are refused, or undefined when they are a code for this state. */
function refusal(fields: Fields, state: string): string | undefined {
  if (typeof fields.state !== 'string' || !same(fields.state, state)) return 'STATE_MISMATCH';
  if (typeof fields.code !== 'string' || !CODE.test(fields.code)) return 'CODE_INVALID';
  if (fields.username !== undefined && (typeof fields.username !== 'string' || fields.username.length > 256)) return 'USERNAME_INVALID';
  if (fields.cell !== undefined && (typeof fields.cell !== 'string' || !/^[a-z]{2}$/.test(fields.cell))) return 'CELL_INVALID';
  return undefined;
}

/**
 * Listens on 127.0.0.1:[port] (0: a free port) for the code of the page, in one of two ways:
 * - by fetch: POST /callback with { state, code, username?, cell? } from [origin] only (403
 *   otherwise), a preflight OPTIONS answered with the CORS headers of [origin] (and
 *   Access-Control-Allow-Private-Network when the browser asks for it); 204, or 400 with the reason;
 * - by a navigation of the page (the browsers that gate a fetch to the loopback behind a permission,
 *   Chromium and WebKit): GET /callback?state=&code=&username=&cell=, answered by a 303 to the page
 *   of the web app that says the outcome ([origin]/cli/login?outcome=done|refused).
 * A state that is not [state] is refused and the CLI waits on. Resolves with the first good code and
 * stops listening; refuses after [timeoutMs] (BROWSER_LOGIN_TIMEOUT, exit 3).
 */
export async function callbackServer(options: { origin: string; state: string; port?: number; timeoutMs: number }): Promise<CallbackServer> {
  let resolveCode!: (c: BrowserCode) => void, rejectCode!: (e: Error) => void;
  const result = new Promise<BrowserCode>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  result.catch(() => undefined);
  const cors = (req: IncomingMessage): Record<string, string> => ({
    'access-control-allow-origin': options.origin, vary: 'Origin', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '60',
    ...(req.headers['access-control-request-private-network'] === 'true' ? { 'access-control-allow-private-network': 'true' } : {}),
  });
  const answer = (res: ServerResponse, status: number, headers: Record<string, string> = {}, body?: unknown) => {
    res.writeHead(status, { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };
  let done = false;
  /** The code taken once: the answer sent, then the server closed. */
  const take = (res: ServerResponse, fields: Fields, send: () => void) => {
    done = true;
    res.once('finish', close);
    send();
    resolveCode({ code: fields.code as string, ...(typeof fields.username === 'string' ? { username: fields.username } : {}), ...(typeof fields.cell === 'string' ? { cell: fields.cell } : {}) });
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== CALLBACK_PATH) return answer(res, 404);
    if (req.method === 'GET') {
      // A navigation of the page: no Origin to check (the state is the proof), the outcome said by the web app.
      const fields: Fields = Object.fromEntries(['state', 'code', 'username', 'cell'].filter((k) => url.searchParams.has(k)).map((k) => [k, url.searchParams.get(k)]));
      const why = refusal(fields, options.state) ?? (done ? 'ALREADY_RECEIVED' : undefined);
      if (why) return answer(res, 303, { location: outcomeUrl(options.origin, 'refused') });
      return take(res, fields, () => answer(res, 303, { location: outcomeUrl(options.origin, 'done') }));
    }
    if (req.headers.origin !== options.origin) return answer(res, 403);
    if (req.method === 'OPTIONS') return answer(res, 204, cors(req));
    if (req.method !== 'POST') return answer(res, 405, { ...cors(req), allow: 'GET, POST, OPTIONS' });
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => { size += chunk.length; if (size <= MAX_BODY) chunks.push(chunk); });
    req.on('end', () => {
      if (size > MAX_BODY) return answer(res, 413, cors(req), { error: 'TOO_LARGE' });
      let body: Fields;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) ?? {}; } catch { return answer(res, 400, cors(req), { error: 'JSON_EXPECTED' }); }
      const why = refusal(body, options.state);
      if (why) return answer(res, 400, cors(req), { error: why });
      if (done) return answer(res, 409, cors(req), { error: 'ALREADY_RECEIVED' });
      take(res, body, () => answer(res, 204, cors(req)));
    });
  });
  const timer = setTimeout(() => { rejectCode(new CliError('BROWSER_LOGIN_TIMEOUT', `No confirmation from the browser within ${Math.round(options.timeoutMs / 1000)} s: run breakrocks login --browser again`, EXIT.NETWORK)); close(); }, options.timeoutMs);
  (timer as { unref?: () => void }).unref?.();
  function close() { clearTimeout(timer); server.close(); server.closeAllConnections?.(); }
  await new Promise<void>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => reject(cliRefusal('PORT_UNAVAILABLE', `Cannot listen on 127.0.0.1:${options.port ?? 0} (${error.code ?? error.message})`, { port: options.port ?? 0 })));
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  return { port: typeof address === 'object' && address ? address.port : 0, result, close };
}

/**
 * Opens [url] in the browser of the person, without a shell: `open` (macOS), `xdg-open` (Linux and
 * the others), `rundll32 url.dll,FileProtocolHandler` (Windows). The one call of a program of the
 * system the CLI makes (README § Systèmes): optional (--no-open), and the address is always written
 * for the person to open it. False when it could not start.
 */
export function openInBrowser(url: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  const [command, args] = platform === 'darwin' ? ['open', [url]] : platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args as string[], { stdio: 'ignore', detached: true, windowsHide: true, shell: false });
      child.once('error', () => resolve(false));
      child.once('spawn', () => { child.unref(); resolve(true); });
    } catch { resolve(false); }
  });
}
