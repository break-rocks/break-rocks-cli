// login --browser: the CLI listens on 127.0.0.1 (a port of its own), opens the page /cli/login of
// the web app with that port, a state and the challenge of a verifier (S256, as PKCE); the person
// signed in there confirms "connect the command line on this computer", and the page sends to
// http://127.0.0.1:<port>/callback, by fetch, a code for one use only (never a token). The CLI then
// exchanges the code, with its verifier, for a session of the user pool. CORS is open on that local
// endpoint only, to the origin of the web app of the environment only.
//
// The exchange is not served by the API yet (no operation in schema/schema.graphql): it stays
// behind CodeExchange, and the command answers NOT_AVAILABLE_YET with the reason until the contract
// exists (the proposal is in the README § Connexion par le navigateur).
import { spawn } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { CognitoTokens, UserPool } from './cognito.js';
import type { Context } from './context.js';
import { CliError, EXIT, cliRefusal } from './errors.js';

/** What the page sends to the CLI (with the state it was given): the code, the username of the account in its user pool, its cell. */
export type BrowserCode = { code: string; username?: string; cell?: string };

/** The exchange of the code of the web app for the tokens of the user pool (with the verifier of its challenge). */
export type CodeExchange =
  | { available: false; reason: string }
  | { available: true; exchange: (ctx: Context, input: { pool: UserPool; code: string; username?: string; verifier: string }) => Promise<CognitoTokens> };

/** The exchange of the platform: not served yet. */
export const PLATFORM_EXCHANGE: CodeExchange = {
  available: false,
  reason: 'the API has no operation yet to give the CLI a session for the code of the web app (schema/schema.graphql); sign in with breakrocks login (email and password) meanwhile',
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

/**
 * Listens on 127.0.0.1:[port] (0: a free port) for the code of the page: POST /callback with
 * { state, code, username?, cell? } from [origin] only (403 otherwise), the state equal to [state] (400
 * otherwise, the CLI waits on), a preflight OPTIONS answered with the CORS headers of [origin] (and
 * Access-Control-Allow-Private-Network when the browser asks for it). Resolves with the first good
 * code and stops listening; refuses after [timeoutMs] (BROWSER_LOGIN_TIMEOUT, exit 3).
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
    res.writeHead(status, { 'cache-control': 'no-store', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };
  let done = false;
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (path !== CALLBACK_PATH) return answer(res, 404);
    if (req.headers.origin !== options.origin) return answer(res, 403);
    if (req.method === 'OPTIONS') return answer(res, 204, cors(req));
    if (req.method !== 'POST') return answer(res, 405, { ...cors(req), allow: 'POST, OPTIONS' });
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => { size += chunk.length; if (size <= MAX_BODY) chunks.push(chunk); });
    req.on('end', () => {
      if (size > MAX_BODY) return answer(res, 413, cors(req), { error: 'TOO_LARGE' });
      let body: { state?: unknown; code?: unknown; username?: unknown; cell?: unknown };
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return answer(res, 400, cors(req), { error: 'JSON_EXPECTED' }); }
      if (typeof body?.state !== 'string' || !same(body.state, options.state)) return answer(res, 400, cors(req), { error: 'STATE_MISMATCH' });
      if (typeof body.code !== 'string' || !CODE.test(body.code)) return answer(res, 400, cors(req), { error: 'CODE_INVALID' });
      if (body.username !== undefined && (typeof body.username !== 'string' || body.username.length > 256)) return answer(res, 400, cors(req), { error: 'USERNAME_INVALID' });
      if (body.cell !== undefined && (typeof body.cell !== 'string' || !/^[a-z]{2}$/.test(body.cell))) return answer(res, 400, cors(req), { error: 'CELL_INVALID' });
      if (done) return answer(res, 409, cors(req), { error: 'ALREADY_RECEIVED' });
      done = true;
      res.once('finish', close);
      answer(res, 204, cors(req));
      resolveCode({ code: body.code, ...(typeof body.username === 'string' ? { username: body.username } : {}), ...(typeof body.cell === 'string' ? { cell: body.cell } : {}) });
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
