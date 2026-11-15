// The proxy (README § Proxy): its precedence (--proxy, the profile, the environment), NO_PROXY, the
// credentials never printed, and real requests through a local recording proxy (http and socks5), on
// 127.0.0.1 only: no request leaves the machine.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { connect, createServer as createTcpServer, type AddressInfo, type Server as TcpServer } from 'node:net';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as tls from 'node:tls';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyNetwork, createDispatcher, goesThroughProxy, networkSettings, proxyFile, redactText, redactUrl, type NetworkSettings } from '../src/network.js';
import { parseGlobals } from '../src/cli.js';
import { harness, last } from './helpers.js';

type Seen = { url: string; auth?: string; method: string };

/** A target server: answers { ok: true } to anything, records the paths. */
let target: Server, targetUrl: string;
const targetSeen: string[] = [];
/** A forward proxy (absolute-form http requests and CONNECT) that records what it forwards. */
let proxy: Server, proxyPort: number;
const proxySeen: Seen[] = [];
/** A SOCKS5 proxy without authentication that records the hosts it connects to. */
let socks: TcpServer, socksPort: number;
const socksSeen: string[] = [];

const listen = (server: Server | TcpServer) => new Promise<number>((done) => server.listen(0, '127.0.0.1', () => done((server.address() as AddressInfo).port)));

beforeAll(async () => {
  target = createServer((req, res) => { targetSeen.push(req.url ?? ''); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: { __typename: 'Query' }, ok: true, version: '0.0.1', tag_name: 'v0.0.1' })); });
  targetUrl = `http://127.0.0.1:${await listen(target)}`;
  proxy = createServer((req: IncomingMessage, res) => {
    proxySeen.push({ url: req.url ?? '', auth: req.headers['proxy-authorization'], method: req.method ?? '' });
    const url = new URL(req.url!);
    const upstream = connect(Number(url.port), url.hostname, () => {
      upstream.write(`${req.method} ${url.pathname}${url.search} HTTP/1.1\r\nhost: ${url.host}\r\nconnection: close\r\n${req.headers['content-type'] ? `content-type: ${req.headers['content-type']}\r\n` : ''}${req.headers['content-length'] ? `content-length: ${req.headers['content-length']}\r\n` : ''}\r\n`);
      req.pipe(upstream);
    });
    upstream.once('data', function first(chunk) { res.socket!.write(chunk); upstream.pipe(res.socket!); });
    res.on('close', () => upstream.destroy());
  });
  proxy.on('connect', (req, socket) => {
    proxySeen.push({ url: req.url ?? '', auth: req.headers['proxy-authorization'], method: 'CONNECT' });
    const [host, port] = (req.url ?? '').split(':');
    // Never further than this machine.
    if (host !== '127.0.0.1') { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const upstream = connect(Number(port), host, () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); upstream.pipe(socket); socket.pipe(upstream); });
  });
  proxyPort = await listen(proxy);
  socks = createTcpServer((socket) => {
    socket.once('data', () => {
      socket.write(Buffer.from([5, 0]));
      socket.once('data', (request) => {
        const atyp = request[3];
        let host: string, offset: number;
        if (atyp === 1) { host = [...request.subarray(4, 8)].join('.'); offset = 8; } else { const n = request[4]; host = request.subarray(5, 5 + n).toString(); offset = 5 + n; }
        const port = request.readUInt16BE(offset);
        socksSeen.push(`${host}:${port}`);
        if (host !== '127.0.0.1') { socket.destroy(); return; }
        const upstream = connect(port, host, () => { socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])); upstream.pipe(socket); socket.pipe(upstream); });
        upstream.on('error', () => socket.destroy());
      });
    });
  });
  socksPort = await listen(socks);
});
afterAll(() => { target.close(); proxy.close(); socks.close(); });

const via = async (settings: NetworkSettings, url: string) => {
  const dispatcher = await createDispatcher(settings);
  try { return await (await fetch(url, { dispatcher } as RequestInit)).json(); } finally { await dispatcher.close(); }
};

describe('the settings', () => {
  const env = { HTTPS_PROXY: 'http://env-upper:1', https_proxy: 'http://env-lower:1', HTTP_PROXY: 'http://env-http:1', NO_PROXY: 'localhost' };
  it('take --proxy first, then the profile, then the environment (its lowercase form first)', () => {
    expect(networkSettings({ proxy: 'http://option:1' }, { proxy: 'http://profile:1' }, env)).toMatchObject({ httpsProxy: 'http://option:1', httpProxy: 'http://option:1', proxySource: 'option', noProxy: 'localhost' });
    expect(networkSettings({}, { proxy: 'http://profile:1' }, env)).toMatchObject({ httpsProxy: 'http://profile:1', proxySource: 'profile' });
    expect(networkSettings({}, {}, env)).toMatchObject({ httpsProxy: 'http://env-lower:1', httpProxy: 'http://env-http:1', proxySource: 'environment' });
    expect(networkSettings({}, {}, { HTTPS_PROXY: 'http://env-upper:1' })).toMatchObject({ httpsProxy: 'http://env-upper:1' });
    expect(networkSettings({}, {}, {})).toEqual({ noProxy: '' });
    expect(networkSettings({}, { noProxy: '.corp' }, env).noProxy).toBe('.corp');
    expect(networkSettings({ caFile: 'ca.pem' }, { caFile: '/etc/other.pem' }, {}, '/home/u')).toMatchObject({ caFile: join('/home/u', 'ca.pem'), caSource: 'option' });
  });
  it('refuse a proxy URL that is not one, without printing its credentials', () => {
    expect(() => networkSettings({ proxy: 'ftp://user:s3cret@proxy:21' }, {}, {})).toThrow(/PROXY|proxy/);
    try { networkSettings({ proxy: 'ftp://user:s3cret@proxy:21' }, {}, {}); } catch (e) { expect((e as Error).message).not.toContain('s3cret'); expect((e as { code: string }).code).toBe('PROXY_INVALID'); }
  });
  it('read NO_PROXY as curl does: hosts, suffixes, ports, "*"', () => {
    expect(goesThroughProxy('https://api.break.rocks/graphql', '')).toBe(true);
    expect(goesThroughProxy('https://api.break.rocks/graphql', 'localhost,.break.rocks')).toBe(false);
    expect(goesThroughProxy('https://break.rocks/', '.break.rocks')).toBe(false);
    expect(goesThroughProxy('https://notbreak.rocks/', '.break.rocks')).toBe(true);
    expect(goesThroughProxy('http://127.0.0.1:8080/', '127.0.0.1:9090')).toBe(true);
    expect(goesThroughProxy('http://127.0.0.1:8080/', '127.0.0.1:8080')).toBe(false);
    expect(goesThroughProxy('https://x.example/', '*')).toBe(false);
  });
  it('are read as global options', () => {
    expect(parseGlobals(['--proxy', 'http://p:1', '--ca-file=ca.pem', 'doctor']).flags).toMatchObject({ proxy: 'http://p:1', caFile: 'ca.pem' });
  });
});

describe('the credentials', () => {
  it('are hidden in what is printed', () => {
    expect(redactUrl('http://alice:s3cret@proxy.corp:3128')).toBe('http://***:***@proxy.corp:3128/');
    expect(redactUrl('http://proxy.corp:3128')).toBe('http://proxy.corp:3128');
    expect(redactText('connect to https://alice:s3cret@proxy.corp:3128 failed')).toBe('connect to https://***@proxy.corp:3128 failed');
  });
  it('stay out of config.json and of config show, in a file for the user alone', async () => {
    const h = harness();
    expect(await h.run('config', 'add', 'work', '--env', 'dev', '--use')).toBe(0);
    expect(await h.run('config', 'set', 'proxy', 'http://alice:s3cret@proxy.corp:3128', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ name: 'work', proxy: 'http://***:***@proxy.corp:3128/', network: { proxy: 'http://***:***@proxy.corp:3128/', proxySource: 'profile' } });
    const dir = join(h.dir, 'config');
    expect(readFileSync(join(dir, 'config.json'), 'utf8')).not.toContain('s3cret');
    const file = join(dir, 'proxies', 'work.url');
    expect(readFileSync(file, 'utf8')).toContain('alice:s3cret@');
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o077).toBe(0);
    expect(await h.run('config', 'show')).toBe(0);
    expect(await h.run('--proxy', 'http://bob:hunter2@other:8080', 'config', 'show', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ network: { proxy: 'http://***:***@other:8080/', proxySource: 'option' } });
    expect(h.all()).not.toMatch(/s3cret|hunter2/);
    expect(await h.run('config', 'unset', 'proxy')).toBe(0);
    expect(existsSync(file)).toBe(false);
    expect(await h.run('config', 'set', 'ca-file', 'missing.pem')).toBe(2);
  });
});

describe('the requests', () => {
  it('go through an http proxy, with its credentials, unless NO_PROXY names the host', async () => {
    proxySeen.length = 0;
    const settings = networkSettings({ proxy: `http://alice:s3cret@127.0.0.1:${proxyPort}` }, {}, {});
    expect(await via(settings, `${targetUrl}/through`)).toMatchObject({ ok: true });
    // undici tunnels http too (CONNECT), the credentials in Proxy-Authorization.
    expect(proxySeen).toEqual([{ url: new URL(targetUrl).host, auth: `Basic ${Buffer.from('alice:s3cret').toString('base64')}`, method: 'CONNECT' }]);
    expect(targetSeen).toContain('/through');
    proxySeen.length = 0;
    const direct = networkSettings({ proxy: `http://127.0.0.1:${proxyPort}` }, {}, { NO_PROXY: '127.0.0.1' });
    expect(await via(direct, `${targetUrl}/direct`)).toMatchObject({ ok: true });
    expect(proxySeen).toEqual([]);
    expect(targetSeen).toContain('/direct');
  });
  it('follow the environment when nothing else is given', async () => {
    proxySeen.length = 0;
    expect(await via(networkSettings({}, {}, { http_proxy: `http://127.0.0.1:${proxyPort}` }), `${targetUrl}/env`)).toMatchObject({ ok: true });
    expect(proxySeen.map((s) => s.url)).toEqual([new URL(targetUrl).host]);
    expect(targetSeen).toContain('/env');
  });
  it('of the fetch of Node go through the proxy once the settings are applied (the global dispatcher, as the CLI does)', async () => {
    const { Agent, getGlobalDispatcher, setGlobalDispatcher } = await import('undici');
    const before = getGlobalDispatcher();
    proxySeen.length = 0;
    try {
      await applyNetwork(networkSettings({ proxy: `http://127.0.0.1:${proxyPort}` }, {}, {}));
      expect(await (await fetch(`${targetUrl}/global`)).json()).toMatchObject({ ok: true });
      expect(proxySeen.map((s) => s.url)).toEqual([new URL(targetUrl).host]);
    } finally { setGlobalDispatcher(before ?? new Agent()); }
  });
  it('go through a socks5 proxy', async () => {
    socksSeen.length = 0;
    expect(await via(networkSettings({ proxy: `socks5://127.0.0.1:${socksPort}` }, {}, {}), `${targetUrl}/socks`)).toMatchObject({ ok: true });
    expect(socksSeen).toEqual([new URL(targetUrl).host]);
  });
  it('take a CA bundle, and refuse a missing one', async () => {
    const h = harness();
    writeFileSync(join(h.dir, 'ca.pem'), tls.rootCertificates[0]);
    expect(await via(networkSettings({ caFile: join(h.dir, 'ca.pem') }, {}, {}), `${targetUrl}/ca`)).toMatchObject({ ok: true });
    await expect(createDispatcher(networkSettings({ caFile: join(h.dir, 'none.pem') }, {}, {}))).rejects.toMatchObject({ code: 'CA_FILE_NOT_FOUND' });
  });
  it('of a command go through the proxy of --proxy before the profile and the environment; doctor shows it, redacted', async () => {
    proxySeen.length = 0;
    let dispatcher: Awaited<ReturnType<typeof createDispatcher>> | undefined;
    const h = harness({
      env: { BREAKROCKS_API_URL: `${targetUrl}/graphql`, BREAKROCKS_AGENTS_URL: `${targetUrl}/agents`, BREAKROCKS_NPM_URL: `${targetUrl}/npm`, BREAKROCKS_RELEASES_URL: `${targetUrl}/releases`, HTTP_PROXY: 'http://127.0.0.1:9/' },
      fetch: (url, init) => fetch(url, { ...init, ...(dispatcher ? { dispatcher } : {}) } as RequestInit),
    });
    h.io.configureNetwork = async (s) => { dispatcher = await createDispatcher(s); };
    expect(await h.run('config', 'add', 'work', '--env', 'dev', '--use')).toBe(0);
    expect(await h.run('config', 'set', 'proxy', 'http://127.0.0.1:9/')).toBe(0);
    await h.run('--proxy', `http://alice:s3cret@127.0.0.1:${proxyPort}`, 'doctor', '--json');
    const result = last<{ checks: { name: string; status: string; detail: string }[] }>(h);
    expect(result.checks.find((c) => c.name === 'proxy')).toMatchObject({ status: 'ok', detail: expect.stringContaining(`http://***:***@127.0.0.1:${proxyPort}/ (option)`) });
    expect(result.checks.find((c) => c.name === 'api')).toMatchObject({ status: 'ok', detail: expect.stringContaining('through the proxy http://***:***@') });
    // Through the proxy of --proxy only (neither the profile's nor HTTP_PROXY, both on a closed port).
    expect(proxySeen.length).toBeGreaterThan(0);
    expect(new Set(proxySeen.map((s) => s.url))).toEqual(new Set([new URL(targetUrl).host]));
    expect(targetSeen).toEqual(expect.arrayContaining(['/npm', '/graphql']));
    expect(h.all()).not.toContain('s3cret');
    await dispatcher?.close();
  });
  it('fail with the proxy unreachable, without its credentials in the error', async () => {
    let dispatcher: Awaited<ReturnType<typeof createDispatcher>> | undefined;
    const h = harness({ env: { BREAKROCKS_API_URL: `${targetUrl}/graphql`, BREAKROCKS_AGENTS_URL: `${targetUrl}/agents` }, fetch: (url, init) => fetch(url, { ...init, ...(dispatcher ? { dispatcher } : {}) } as RequestInit) });
    h.io.configureNetwork = async (s) => { dispatcher = await createDispatcher(s); };
    expect(await h.run('--proxy', 'http://alice:s3cret@127.0.0.1:9', 'universes', 'show', '%paris', '--json')).not.toBe(0);
    expect(h.all()).not.toContain('s3cret');
    expect(proxyFile).toBeTypeOf('function');
    await dispatcher?.close();
  });
});
