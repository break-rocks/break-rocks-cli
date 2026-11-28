// A fake of native-sulfur for the tests (no network), at https://api.test (BREAKROCKS_SULFUR_URL): its token endpoint
// (an agent or an agent operator signs in with an assertion signed with its key, RFC 7523: the signature verified with the
// public key it was given) and a small GraphQL API (me, myUsage, the delegated agents, approvedTypefaces, the plans of
// delegated agents paid by card). An access token is a JWT the fake reads back: `sub` the operator, `act.sub` an agent.
import { createPublicKey, generateKeyPairSync, randomUUID, verify } from 'node:crypto';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const claimsOf = (token: string): Record<string, unknown> => { try { return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')); } catch { return {}; } };

export const USDC_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

type Operator = { id: string; publicKey: string; paidUntil: string; handle: string };
type Agent = { id: string; operatorId: string; name: string; publicKey: string; status: string; interactions: string[] | null; universes: string[] | null; createdAt: string };
type Plan = { automaticRenewal: boolean; delegatedAgents: number; interval: string; nextDelegatedAgents: number | null; nextFrom: string | null; paidUntil: string; payerId: string; provider: string; status: string };
/** The prices of the plans (the minor unit: 4000 USD = 40.00 USD), as the catalog of dev holds them. */
export const PLAN_PRICES = [[10, 4000, 40000], [100, 35000, 350000], [1000, 300000, 3000000]].flatMap(([delegatedAgents, month, year]) => [{ amount: month, currency: 'USD', delegatedAgents, interval: 'MONTH' }, { amount: year, currency: 'USD', delegatedAgents, interval: 'YEAR' }]);
const planOffered = (n: unknown) => typeof n === 'number' && (n === 10 || n === 100 || (n >= 1000 && n % 1000 === 0));
type SessionInfo = { kind: 'operator' | 'agent'; operatorId: string; agentId?: string; exp: number };

export function fakePlatform(options: { now: () => number }) {
  const calls: { method: string; url: string; headers: Record<string, string>; body?: unknown }[] = [];
  const operators = new Map<string, Operator>();
  const agents = new Map<string, Agent>();
  const plans = new Map<string, Plan>();
  const checkouts: { operatorId: string; delegatedAgents: number; interval: string; url: string }[] = [];
  const state = { failNextGraphql401: false };

  /** The token endpoint: an assertion of an agent or an operator, signed with its key (its `iss`), for a token of an hour. */
  function token(form: Record<string, string>): Response {
    if (form.grant_type !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') return json(400, { error: 'unsupported_grant_type' });
    const [h, p, sig] = String(form.assertion).split('.');
    const claims = claimsOf(String(form.assertion));
    const iss = String(claims.iss);
    const agent = agents.get(iss), operator = operators.get(iss);
    const pem = agent?.publicKey ?? operator?.publicKey;
    if (!pem || !verify(null, Buffer.from(`${h}.${p}`), createPublicKey(pem), Buffer.from(sig ?? '', 'base64url'))) return json(400, { error: 'invalid_grant', error_description: 'ASSERTION_INVALID' });
    if (agent && agent.status === 'suspended') return json(400, { error: 'invalid_grant', error_description: 'DELEGATED_AGENT_SUSPENDED' });
    const exp = Math.floor(options.now() / 1000) + 3600;
    const access = `${b64url({ alg: 'EdDSA' })}.${b64url({ sub: agent?.operatorId ?? iss, ...(agent ? { act: { sub: agent.id } } : {}), exp })}.sig`;
    return json(200, { access_token: access, token_type: 'Bearer', expires_in: 3600, session_kind: 'agent' });
  }

  const agentView = (a: Agent) => ({ id: a.id, name: a.name, status: a.status, interactions: a.interactions, universes: a.universes, createdAt: a.createdAt, credentialsUpdatedAt: a.createdAt, suspendedAt: null, deactivatedAt: null });
  const gqlError = (code: string) => json(200, { data: null, errors: [{ message: code, extensions: { code: 'REFUSED', reason: code } }] });

  function graphql(body: { query: string; variables?: Record<string, unknown> }, headers: Record<string, string>): Response {
    if (state.failNextGraphql401) { state.failNextGraphql401 = false; return json(401, { errors: [{ errorType: 'UnauthorizedException', message: 'no' }] }); }
    const claims = claimsOf(String(headers['x-authorization'] ?? '').replace(/^Bearer /, ''));
    const act = (claims.act as { sub?: string } | undefined)?.sub;
    const s: SessionInfo | undefined = claims.sub ? { kind: act ? 'agent' : 'operator', operatorId: String(claims.sub), ...(act ? { agentId: act } : {}), exp: Number(claims.exp) * 1000 } : undefined;
    if (!s || !operators.has(s.operatorId) || s.exp <= options.now()) return json(401, { errors: [{ message: 'token refused', extensions: { code: 'UNAUTHENTICATED' } }] });
    const q = body.query, v = body.variables ?? {};
    const op = operators.get(s.operatorId)!;
    const manage = /delegatedAgents|createDelegatedAgent|DelegatedAgent\(|delegatedAgentActivity|delegatedAgentAllowance/.test(q);
    if (manage && s.kind === 'agent') return gqlError('DELEGATED_AGENT_CANNOT_MANAGE_AGENTS');
    if (/OperatorPlan|operatorPlanOffer/.test(q)) {
      if (s.kind === 'agent') return gqlError('INSTANT_PAYMENT_NOT_ALLOWED');
      const plan = plans.get(op.id);
      if (q.includes('startOperatorPlan')) {
        if (!planOffered(v.delegatedAgents)) return gqlError('PLAN_NOT_OFFERED');
        if (plan) return gqlError('SUBSCRIPTION_EXISTS');
        const url = `https://checkout.test/c/${op.id}-${checkouts.length}`;
        checkouts.push({ operatorId: op.id, delegatedAgents: v.delegatedAgents as number, interval: (v.interval as string) ?? 'MONTH', url });
        return json(200, { data: { startOperatorPlan: { url, expiresAt: new Date(options.now() + 1800_000).toISOString() } } });
      }
      if (q.includes('changeOperatorPlan')) {
        if (!plan) return gqlError('SUBSCRIPTION_NOT_FOUND');
        if (!planOffered(v.delegatedAgents)) return gqlError('PLAN_NOT_OFFERED');
        const n = v.delegatedAgents as number;
        if (n > plan.delegatedAgents) Object.assign(plan, { delegatedAgents: n, nextDelegatedAgents: null, nextFrom: null });
        else Object.assign(plan, { nextDelegatedAgents: n, nextFrom: plan.paidUntil });
        return json(200, { data: { changeOperatorPlan: plan } });
      }
      if (q.includes('setOperatorPlanRenewal')) {
        if (!plan) return gqlError('SUBSCRIPTION_NOT_FOUND');
        plan.automaticRenewal = v.enabled === true;
        return json(200, { data: { setOperatorPlanRenewal: plan } });
      }
      const data: Record<string, unknown> = {};
      if (/\bme\b/.test(q)) data.me = { id: op.id, handle: op.handle, own: { paidUntil: op.paidUntil } };
      if (q.includes('myOperatorPlan')) data.myOperatorPlan = plan ?? null;
      const currency = (v.currency ?? v.c) as string | undefined, interval = (v.interval ?? v.i) as string | undefined;
      if (q.includes('operatorPlanOffer')) data.operatorPlanOffer = { prices: PLAN_PRICES.filter((p) => (!currency || p.currency === currency) && (!interval || p.interval === interval)), providers: ['stripe'] };
      return json(200, { data });
    }
    if (q.includes('createDelegatedAgent')) {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      const id = `eu_${randomUUID().slice(0, 8)}`;
      const agent: Agent = { id, operatorId: op.id, name: v.name as string, publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(), status: 'active', interactions: (v.interactions as string[]) ?? null, universes: (v.universes as string[]) ?? null, createdAt: new Date(options.now()).toISOString() };
      if ([...agents.values()].some((a) => a.operatorId === op.id && a.name === agent.name)) return gqlError('DELEGATED_AGENT_NAME_TAKEN');
      agents.set(id, agent);
      return json(200, { data: { createDelegatedAgent: { agentId: id, operatorId: op.id, algorithm: 'Ed25519', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), signInUrl: 'https://eu.api.dev.break.rocks/oauth/token', agent: agentView(agent) } } });
    }
    // changeDelegatedAgent (API v2): a name, suspended, restrictions, and the restrictions lifted (clear).
    if (q.includes('changeDelegatedAgent')) {
      const a = agents.get(v.id as string)!;
      const input = v.input as { name?: string; suspended?: boolean; interactions?: string[]; universes?: string[]; clear?: string[] };
      if (input.name !== undefined) a.name = input.name;
      if (input.suspended !== undefined) a.status = input.suspended ? 'suspended' : 'active';
      if (input.interactions) a.interactions = input.interactions;
      if (input.universes) a.universes = input.universes;
      if (input.clear?.includes('INTERACTIONS')) a.interactions = null;
      if (input.clear?.includes('UNIVERSES')) a.universes = null;
      return json(200, { data: { changeDelegatedAgent: agentView(a) } });
    }
    if (q.includes('delegatedAgents')) return json(200, { data: { delegatedAgents: [...agents.values()].filter((a) => a.operatorId === op.id).map(agentView) } });
    const data: Record<string, unknown> = {};
    // me through native-sulfur's accounts(ids) (the CLI's adapter): the operator's account.
    if (q.includes('accounts(')) data.accounts = ((v.ids as string[] | undefined) ?? []).map((id) => (id === op.id ? { id: op.id, kind: 'operator', handle: op.handle, displayName: op.handle, organizationName: null, own: { legalSpace: 'fra', paidTier: null, paidUntil: op.paidUntil, fullAgeConfirmedAt: '2026-10-23', minimumAgeCheckedAt: null } } : null));
    if (/\bme\b/.test(q)) data.me = { id: op.id, tier: 'free', card: { handle: op.handle, name: null }, kind: 'operator', handle: op.handle, displayName: op.handle, organizationName: null, own: { legalSpace: 'fra', paidTier: null, paidUntil: op.paidUntil, fullAgeConfirmedAt: '2026-10-23', minimumAgeCheckedAt: null } };
    // A delegated agent reads its own restrictions; null for anyone else.
    if (/\bme\b/.test(q) && q.includes('delegatedAgent')) {
      const self = s.kind === 'agent' ? agents.get(s.agentId!) : undefined;
      data.me = { ...(data.me as object), delegatedAgent: self ? { id: self.id, name: self.name, interactions: self.interactions, universes: self.universes } : null };
    }
    if (q.includes('myUsage')) {
      const w = (used: number, limit: number) => ({ used, limit, resetAt: new Date(options.now() + 60_000).toISOString() });
      data.myUsage = { minute: w(1, 600), hour: w(5, 6000), quota: s.kind === 'agent' ? w(5, 30000) : null, tier: s.kind === 'agent' ? 'X1' : null, byCategory: [{ category: 'OTHER', hour: 5, quota: s.kind === 'agent' ? 5 : null }] };
    }
    if (q.includes('delegatedAgentAllowance')) data.delegatedAgentAllowance = { allowance: 1, operated: [...agents.values()].filter((a) => a.operatorId === op.id).length, createdLast24Hours: 0 };
    if (q.includes('approvedTypefaces')) data.approvedTypefaces = [{ name: 'Bebas Neue', category: 'DISPLAY', scripts: ['Latin'], license: 'OFL-1.1' }];
    return json(200, { data });
  }

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const raw = init?.body ? String(init.body) : '';
    const form = headers['content-type']?.startsWith('application/x-www-form-urlencoded');
    const body = raw ? (form ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw)) : undefined;
    calls.push({ method: init?.method ?? 'GET', url: url.href, headers, body });
    if (url.host !== 'api.test') throw new TypeError(`fetch failed: ${url.host}`);
    if (url.pathname === '/oauth/token') return token(body ?? {});
    if (url.pathname === '/graphql') return graphql(body, headers);
    return json(404, { error: 'not_found' });
  };

  /** An agent operator of [publicKey] (PEM), its paid period running. */
  const addOperator = (id: string, publicKey: string) => { operators.set(id, { id, publicKey, paidUntil: new Date(options.now() + 30 * 86400_000).toISOString(), handle: `user-${id.slice(3, 9)}` }); return operators.get(id)!; };

  /** The payment of a Checkout page confirmed (as Stripe's webhook would): the plan written. */
  const payCheckout = (url: string) => {
    const c = checkouts.find((x) => x.url === url);
    if (!c) throw new Error(`no checkout ${url}`);
    const until = new Date(options.now() + (c.interval === 'YEAR' ? 365 : 30) * 86400_000).toISOString();
    operators.get(c.operatorId)!.paidUntil = until;
    plans.set(c.operatorId, { automaticRenewal: true, delegatedAgents: c.delegatedAgents, interval: c.interval, nextDelegatedAgents: null, nextFrom: null, paidUntil: until, payerId: c.operatorId, provider: 'stripe', status: 'ACTIVE' });
  };

  return { fetch, calls, operators, agents, state, plans, checkouts, payCheckout, addOperator };
}

/** A harness whose network is a fake of native-sulfur on the clock of the harness. */
export async function onPlatform(options: Parameters<typeof import('./helpers.js').harness>[0] = {}) {
  const { harness } = await import('./helpers.js');
  const holder: { platform?: ReturnType<typeof fakePlatform> } = {};
  const h = harness({ ...options, env: { BREAKROCKS_SULFUR_URL: 'https://api.test', ...options.env }, fetch: (input, init) => holder.platform!.fetch(input, init) });
  holder.platform = fakePlatform({ now: () => h.clock.now });
  return { h, platform: holder.platform };
}

/**
 * An agent operator on the fake platform: the profile "atlas" of dev made the operator's (its key made by operator keygen,
 * its account known to the platform); every command signs it in with its key.
 */
export async function operatorOnPlatform(options: Parameters<typeof onPlatform>[0] = {}) {
  const { h, platform } = await onPlatform(options);
  if (await h.run('profile', 'add', 'atlas', '--env', 'dev', '--use', '--json') !== 0) throw new Error('profile add');
  if (await h.run('operator', 'keygen', '--recovery-algorithm', 'Ed25519', '--json') !== 0) throw new Error('keygen');
  const keys = h.values[h.values.length - 1] as { publicKey: string };
  const operatorId = 'eu_op1';
  platform.addOperator(operatorId, keys.publicKey);
  const { Context, NO_FLAGS } = await import('../src/context.js');
  const store = new Context(h.io, NO_FLAGS).store;
  store.saveProfile('atlas', { ...store.profile('atlas')!, kind: 'operator', operatorId, cell: 'eu' });
  return { h, platform, operatorId };
}
