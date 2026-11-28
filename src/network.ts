// The network settings of the CLI (README § Proxy): the proxy and the certificate authorities every
// request goes through: the API, the sign-in, the uploads, x402 and the wallet RPC, the update
// check, the MCP server. The proxy comes from --proxy, else the profile (config set proxy), else the
// environment (https_proxy / HTTPS_PROXY for https, http_proxy / HTTP_PROXY for http; the lowercase form
// first); NO_PROXY (no_proxy) or the profile's no-proxy lists the hosts reached directly. http, https and
// socks5 proxies, credentials in the URL; they are never printed (redactUrl, redactText). A corporate CA
// bundle comes from --ca-file, else the profile (config set ca-file), added to the authorities of Node
// (NODE_EXTRA_CA_CERTS still works on its own). One dispatcher of undici, made global: Node's fetch, and
// every library built on it (viem), use it.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as tls from 'node:tls';
import type { ConfigStore, Profile } from './config.js';
import { writePrivate } from './config.js';
import { usageError } from './errors.js';

export type Source = 'option' | 'profile' | 'environment';
export type NetworkSettings = {
  /** The proxy of the https requests (full URL, credentials included: never printed). */
  httpsProxy?: string;
  /** The proxy of the http requests. */
  httpProxy?: string;
  proxySource?: Source;
  /** The hosts reached without the proxy (NO_PROXY syntax: "localhost,.corp.example,10.0.0.1:8080", "*"). */
  noProxy: string;
  caFile?: string;
  caSource?: Exclude<Source, 'environment'>;
};

export const PROXY_PROTOCOLS = ['http:', 'https:', 'socks5:', 'socks:'];

/** [url] without its credentials ("http://***:***@proxy:3128/"), for anything printed. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!u.username && !u.password) return url;
    u.username = '***';
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return redactText(url);
  }
}

/** Any credentials of a URL in [text] hidden ("scheme://user:pass@host" → "scheme://***@host"): errors and logs. */
export const redactText = (text: string) => text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@');

/** A proxy URL checked: an http, https or socks5 URL with a host (PROXY_INVALID, exit 2, the URL redacted). */
export function checkProxyUrl(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { throw usageError('PROXY_INVALID', `Not a proxy URL: ${redactText(url)} (http://host:port, https://…, socks5://…)`); }
  if (!PROXY_PROTOCOLS.includes(u.protocol) || !u.hostname) throw usageError('PROXY_INVALID', `A proxy URL is http://, https:// or socks5://, with a host: not ${redactUrl(url)}`);
  return url;
}

/** The URL of the proxy without its credentials (kept in config.json) and whether it had any. */
export function withoutCredentials(url: string): { url: string; credentials: boolean } {
  const u = new URL(url);
  const credentials = !!(u.username || u.password);
  u.username = ''; u.password = '';
  return { url: u.toString(), credentials };
}

/** The private file of the proxy URL of a profile when it holds credentials (0600, never config.json). */
export const proxyFile = (store: ConfigStore, profile: string) => join(store.dir, 'proxies', `${profile}.url`);

/** The proxy of [profile] (named [name]): its full URL, the credentials read from its private file. */
export function profileProxy(store: ConfigStore, name: string, profile: Profile | undefined): string | undefined {
  if (!profile?.proxy) return undefined;
  const file = proxyFile(store, name);
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : profile.proxy;
}

/** Saves the proxy of a profile: the URL without credentials in [profile], the full one in its private file. */
export function saveProfileProxy(store: ConfigStore, name: string, profile: Profile, url: string | undefined): Profile {
  const file = proxyFile(store, name);
  rmSync(file, { force: true });
  const { proxy: _old, ...rest } = profile;
  if (!url) return rest;
  const { url: bare, credentials } = withoutCredentials(checkProxyUrl(url));
  if (credentials) writePrivate(file, `${url}\n`);
  return { ...rest, proxy: bare };
}

const first = (...values: (string | undefined)[]) => values.find((v) => v !== undefined && v.trim() !== '')?.trim();

/** The settings of a run: --proxy / --ca-file, else the profile, else the environment. */
export function networkSettings(flags: { proxy?: string; caFile?: string }, profile: { proxy?: string; noProxy?: string; caFile?: string }, env: NodeJS.ProcessEnv, cwd = process.cwd()): NetworkSettings {
  const noProxy = first(profile.noProxy, env.no_proxy, env.NO_PROXY) ?? '';
  const ca = flags.caFile ? { caFile: resolve(cwd, flags.caFile), caSource: 'option' as const } : profile.caFile ? { caFile: profile.caFile, caSource: 'profile' as const } : {};
  const one = flags.proxy ? { proxy: flags.proxy, source: 'option' as const } : profile.proxy ? { proxy: profile.proxy, source: 'profile' as const } : undefined;
  if (one) { checkProxyUrl(one.proxy); return { httpsProxy: one.proxy, httpProxy: one.proxy, proxySource: one.source, noProxy, ...ca }; }
  const httpsProxy = first(env.https_proxy, env.HTTPS_PROXY);
  const httpProxy = first(env.http_proxy, env.HTTP_PROXY);
  for (const p of [httpsProxy, httpProxy]) if (p) checkProxyUrl(p);
  return { ...(httpsProxy ? { httpsProxy } : {}), ...(httpProxy ? { httpProxy } : {}), ...(httpsProxy || httpProxy ? { proxySource: 'environment' as const } : {}), noProxy, ...ca };
}

type NoProxyEntry = { host: string; port: number };
const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443 };

function parseNoProxy(value: string): NoProxyEntry[] | '*' {
  if (value.trim() === '*') return '*';
  return value.split(/[,\s]+/).filter(Boolean).map((entry) => {
    const m = /^(.*?)(?::(\d+))?$/.exec(entry.trim().toLowerCase())!;
    return { host: m[1].replace(/^\*?\./, '.'), port: m[2] ? Number(m[2]) : 0 };
  });
}

/** Whether a request to [url] goes through the proxy: not when NO_PROXY names its host (a domain, a suffix ".corp", "*"). */
export function goesThroughProxy(url: string | URL, noProxy: string): boolean {
  const u = new URL(url);
  const entries = parseNoProxy(noProxy);
  if (entries === '*') return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const port = Number(u.port) || DEFAULT_PORTS[u.protocol] || 0;
  return !entries.some((e) => (!e.port || e.port === port) && (e.host.startsWith('.') ? host.endsWith(e.host) || host === e.host.slice(1) : host === e.host.replace(/^\[|\]$/g, '')));
}

/** The proxy a request to [url] goes through, if any. */
export function proxyFor(settings: NetworkSettings, url: string | URL): string | undefined {
  const u = new URL(url);
  const proxy = u.protocol === 'https:' || u.protocol === 'wss:' ? settings.httpsProxy ?? settings.httpProxy : settings.httpProxy;
  return proxy && goesThroughProxy(u, settings.noProxy) ? proxy : undefined;
}

/** The certificate authorities: those of Node (bundled, NODE_EXTRA_CA_CERTS) and the CA bundle (CA_FILE_NOT_FOUND). */
function authorities(caFile: string): string[] {
  if (!existsSync(caFile)) throw usageError('CA_FILE_NOT_FOUND', `No CA bundle at ${caFile}`, { caFile });
  const extra = readFileSync(caFile, 'utf8');
  const node = (tls as { getCACertificates?: (type?: string) => string[] }).getCACertificates?.('default') ?? [...tls.rootCertificates];
  return [...node, extra];
}

/** Whether the settings change anything: a proxy, or a CA bundle. */
export const isDefault = (s: NetworkSettings) => !s.httpProxy && !s.httpsProxy && !s.caFile;

/**
 * The dispatcher of undici for [settings] (undici is loaded only then): each request goes directly, or
 * through the http(s) proxy (ProxyAgent: CONNECT for https) or the socks5 proxy (Socks5ProxyAgent), by
 * its protocol and NO_PROXY.
 */
export async function createDispatcher(settings: NetworkSettings) {
  const undici = await import('undici');
  const ca = settings.caFile ? authorities(settings.caFile) : undefined;
  const tlsOptions = ca ? { ca } : {};
  const direct = new undici.Agent({ connect: tlsOptions });
  const agents = new Map<string, InstanceType<typeof undici.Dispatcher>>();
  const agentOf = (proxy: string) => {
    let agent = agents.get(proxy);
    if (!agent) {
      const protocol = new URL(proxy).protocol;
      agent = protocol === 'socks5:' || protocol === 'socks:'
        // requestTls: the TLS of the target through the tunnel (in undici, not in its types yet); no proxyTls (it would speak TLS to the proxy).
        ? new undici.Socks5ProxyAgent(proxy, (ca ? { requestTls: tlsOptions } : {}) as ConstructorParameters<typeof undici.Socks5ProxyAgent>[1])
        // proxyTunnel: plain http through CONNECT too, as before undici 8 (which forwards it in absolute form by default).
        : new undici.ProxyAgent({ uri: proxy, requestTls: tlsOptions, proxyTls: tlsOptions, connect: tlsOptions, proxyTunnel: true });
      agents.set(proxy, agent);
    }
    return agent;
  };
  class Router extends undici.Dispatcher {
    dispatch(options: Parameters<InstanceType<typeof undici.Dispatcher>['dispatch']>[0], handler: Parameters<InstanceType<typeof undici.Dispatcher>['dispatch']>[1]): boolean {
      const proxy = options.origin ? proxyFor(settings, String(options.origin)) : undefined;
      return (proxy ? agentOf(proxy) : direct).dispatch(options, handler);
    }
    async close(): Promise<void> { await Promise.all([direct.close(), ...[...agents.values()].map((a) => a.close())]); }
    async destroy(): Promise<void> { await Promise.all([direct.destroy(), ...[...agents.values()].map((a) => a.destroy())]); }
  }
  return new Router();
}

/** Makes [settings] those of every request of this process (Node's fetch and what uses it). */
export async function applyNetwork(settings: NetworkSettings): Promise<void> {
  if (isDefault(settings)) return;
  const { setGlobalDispatcher } = await import('undici');
  setGlobalDispatcher(await createDispatcher(settings));
}

/** The settings as printed (config show, doctor): the proxies redacted. */
export function describeNetwork(s: NetworkSettings): { proxy?: string; httpProxy?: string; proxySource?: Source; noProxy?: string; caFile?: string; caSource?: string } {
  const out: ReturnType<typeof describeNetwork> = {};
  if (s.httpsProxy) out.proxy = redactUrl(s.httpsProxy);
  if (s.httpProxy && s.httpProxy !== s.httpsProxy) out.httpProxy = redactUrl(s.httpProxy);
  if (s.proxySource) out.proxySource = s.proxySource;
  if (s.noProxy) out.noProxy = s.noProxy;
  if (s.caFile) { out.caFile = s.caFile; out.caSource = s.caSource; }
  return out;
}
