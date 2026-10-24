// A fake of the platform for the tests (no network): the cell map, the agents host
// (registrations, challenges, sessions, recovery, renewal, deletion; signatures verified with the
// public keys given) and a small GraphQL API (me, myUsage, the delegated agents, approvedTypefaces).
import { createPublicKey, generateKeyPairSync, randomUUID, verify } from 'node:crypto';

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const refuse = (status: number, code: string) => json(status, { error: { code, message: code } });

export const USDC_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

type Challenge = { text: string; purpose: string; subject: Record<string, string> };
type Operator = { id: string; publicKey: string; recoveryKey: string; paidUntil: string; handle: string; recoveryKeyRequired?: boolean; deleted?: boolean };
type Agent = { id: string; operatorId: string; name: string; publicKey: string; status: string; interactions: string[] | null; universes: string[] | null; createdAt: string };
type SessionInfo = { kind: 'operator' | 'agent'; operatorId: string; agentId?: string; sessionId: string; exp: number };

export function fakePlatform(options: { now: () => number; price?: string; agentsStatus?: Record<string, string> }) {
  const calls: { method: string; url: string; headers: Record<string, string>; body?: unknown }[] = [];
  const challenges = new Map<string, Challenge>();
  const registrations = new Map<string, { publicKey: string; recoveryKey: string; paid: boolean; country: string }>();
  const operators = new Map<string, Operator>();
  const agents = new Map<string, Agent>();
  const sessions = new Map<string, SessionInfo>();
  const state = { failNextGraphql401: false, throttleNext: 0, graphqlRateLimitedNext: 0 };
  const amount = options.price ?? '10000';

  const challenge = (purpose: string, subject: Record<string, string>) => {
    const challengeId = randomUUID();
    const text = `breakrocks-${purpose}\n${challengeId}\n${randomUUID()}`;
    challenges.set(challengeId, { text, purpose, subject });
    return json(200, { challengeId, challenge: text, expiresAt: new Date(options.now() + 300_000).toISOString() });
  };
  const takeChallenge = (body: { challengeId?: string; signature?: string }, purpose: string, key: (c: Challenge) => string | undefined) => {
    const c = body.challengeId ? challenges.get(body.challengeId) : undefined;
    if (!c || c.purpose !== purpose) return { refusal: refuse(401, 'CHALLENGE_INVALID') };
    challenges.delete(body.challengeId!);
    const pem = key(c);
    if (!pem) return { refusal: refuse(401, 'CHALLENGE_INVALID') };
    const ok = verify(null, Buffer.from(c.text), createPublicKey(pem), Buffer.from(body.signature ?? '', 'base64url'));
    return ok ? { challenge: c } : { refusal: refuse(401, 'SIGNATURE_INVALID') };
  };
  const openSession = (info: Omit<SessionInfo, 'sessionId' | 'exp'>, bearer?: string) => {
    let sessionId: string = randomUUID();
    if (bearer) {
      const current = sessions.get(bearer);
      if (!current || current.exp <= options.now() || current.operatorId !== info.operatorId || current.agentId !== info.agentId) return { refusal: refuse(401, 'SESSION_EXPIRED') };
      sessionId = current.sessionId;
    }
    const token = `tok-${randomUUID()}`;
    const exp = options.now() + 3600_000;
    sessions.set(token, { ...info, sessionId, exp });
    return { token, sessionId, expiresAt: new Date(exp).toISOString() };
  };
  const required = (url: string) => ({ x402Version: 2, resource: { url, description: 'plan', mimeType: 'application/json' }, accepts: [{ scheme: 'exact', network: 'eip155:84532', amount, asset: USDC_SEPOLIA, payTo: '0x00000000000000000000000000000000000000aa', maxTimeoutSeconds: 300, extra: { name: 'USDC', version: '2' } }] });
  const ask402 = (url: string, plan: unknown) => json(402, { ...required(url), plan }, { 'payment-required': b64(required(url)) });
  const settled = { 'payment-response': b64({ success: true, transaction: '0xfeed', network: 'eip155:84532', payer: '0xpayer' }) };

  function agentsHost(path: string, body: Record<string, unknown>, headers: Record<string, string>): Response {
    const bearer = headers.authorization?.replace(/^Bearer /, '');
    if (state.throttleNext > 0) { state.throttleNext--; return new Response('{}', { status: 429, headers: { 'retry-after': '2' } }); }
    switch (path) {
      case '/v1/operators/registrations': {
        if (body.recoveryKey === body.publicKey) return refuse(400, 'RECOVERY_KEY_SAME_AS_PUBLIC_KEY');
        if (body.fullAge !== true) return refuse(400, 'FULL_AGE_REQUIRED');
        if ([...operators.values()].some((o) => o.publicKey === body.publicKey)) return refuse(409, 'PUBLIC_KEY_USED');
        return challenge('operator-registration', { publicKey: body.publicKey as string, recoveryKey: body.recoveryKey as string, country: body.country as string });
      }
      case '/v1/operators/registrations/signature': {
        const r = takeChallenge(body, 'operator-registration', (c) => c.subject.publicKey);
        if (r.refusal) return r.refusal;
        const id = `eu-${randomUUID()}`;
        registrations.set(id, { publicKey: r.challenge!.subject.publicKey, recoveryKey: r.challenge!.subject.recoveryKey, paid: false, country: r.challenge!.subject.country });
        return json(200, { registration: { id, expiresAt: new Date(options.now() + 3600_000).toISOString(), payUrl: `https://agents.test/v1/operators/registrations/${id}/payment` }, minimum: { months: 1, delegatedAgents: 1, price: '$0.01' } });
      }
      case '/v1/operators/challenges': {
        const op = operators.get(body.operatorId as string);
        return challenge('operator-session', { operatorId: body.operatorId as string, publicKey: op?.publicKey ?? '' });
      }
      case '/v1/operators/sessions': {
        const r = takeChallenge(body, 'operator-session', (c) => operators.get(c.subject.operatorId)?.publicKey);
        if (r.refusal) return r.refusal;
        const op = operators.get(r.challenge!.subject.operatorId)!;
        const s = openSession({ kind: 'operator', operatorId: op.id }, bearer);
        if ('refusal' in s) return s.refusal!;
        return json(200, { ...s, ...(op.recoveryKeyRequired ? { recoveryKeyRequired: true } : {}) });
      }
      case '/v1/delegated-agents/challenges': return challenge('agent-session', { operatorId: body.operatorId as string, agentId: body.agentId as string });
      case '/v1/delegated-agents/sessions': {
        const r = takeChallenge(body, 'agent-session', (c) => { const a = agents.get(c.subject.agentId); return a && a.operatorId === c.subject.operatorId ? a.publicKey : undefined; });
        if (r.refusal) return r.refusal;
        const agent = agents.get(r.challenge!.subject.agentId)!;
        if (agent.status === 'suspended') return refuse(403, 'DELEGATED_AGENT_SUSPENDED');
        const s = openSession({ kind: 'agent', operatorId: agent.operatorId, agentId: agent.id }, bearer);
        return 'refusal' in s ? s.refusal! : json(200, s);
      }
      case '/v1/operators/recovery/challenges': return challenge('operator-recovery', { operatorId: body.operatorId as string, publicKey: body.publicKey as string });
      case '/v1/operators/recovery': {
        const r = takeChallenge(body, 'operator-recovery', (c) => operators.get(c.subject.operatorId)?.recoveryKey);
        if (r.refusal) return r.refusal;
        const op = operators.get(r.challenge!.subject.operatorId)!;
        op.publicKey = r.challenge!.subject.publicKey; op.recoveryKeyRequired = true;
        for (const [t, s] of sessions) if (s.kind === 'operator' && s.operatorId === op.id) sessions.delete(t);
        const s = openSession({ kind: 'operator', operatorId: op.id });
        return json(200, { ...s, recoveryKeyRequired: true });
      }
      case '/v1/operators/recovery-key/challenges': return challenge('operator-recovery-key', { operatorId: body.operatorId as string, recoveryKey: body.recoveryKey as string });
      case '/v1/operators/recovery-key': {
        const r = takeChallenge(body, 'operator-recovery-key', (c) => operators.get(c.subject.operatorId)?.publicKey);
        if (r.refusal) return r.refusal;
        const op = operators.get(r.challenge!.subject.operatorId)!;
        op.recoveryKey = r.challenge!.subject.recoveryKey; delete op.recoveryKeyRequired;
        return json(200, { recoveryKeyReplaced: true });
      }
      case '/v1/operators/renewal': {
        const s = bearer ? sessions.get(bearer) : undefined;
        if (!s || s.exp <= options.now()) return refuse(401, 'SESSION_EXPIRED');
        if (!headers['payment-signature']) return ask402('https://agents.test/v1/operators/renewal', { months: body.months, delegatedAgents: 1, price: '$0.01' });
        const op = operators.get(s.operatorId)!;
        op.paidUntil = new Date(Date.parse(op.paidUntil) + 30 * 86400_000).toISOString();
        return json(200, { operatorId: op.id, paidUntil: op.paidUntil }, settled);
      }
      case '/v1/operators/deletion/challenges': return challenge('operator-deletion', { operatorId: body.operatorId as string });
      case '/v1/operators/deletion': {
        const r = takeChallenge(body, 'operator-deletion', (c) => operators.get(c.subject.operatorId)?.publicKey);
        if (r.refusal) return r.refusal;
        operators.get(r.challenge!.subject.operatorId)!.deleted = true;
        return json(200, { deleted: true, deletedAt: new Date(options.now()).toISOString(), disappearsAt: new Date(options.now()).toISOString() });
      }
    }
    const pay = /^\/v1\/operators\/registrations\/([^/]+)\/payment$/.exec(path);
    if (pay) {
      const reg = registrations.get(pay[1]);
      if (!reg) return refuse(401, 'CHALLENGE_INVALID');
      if (reg.paid) return refuse(409, 'REGISTRATION_ALREADY_PAID');
      if (!headers['payment-signature']) return ask402(`https://agents.test${path}`, { months: body.months, delegatedAgents: body.delegatedAgents, price: '$0.01' });
      if (headers['payment-signature'] === 'bad') return json(402, { ...required(path), error: { code: 'PAYMENT_INVALID', message: 'invalid' } });
      reg.paid = true;
      const handle = `user-${pay[1].slice(3, 9)}`;
      operators.set(pay[1], { id: pay[1], publicKey: reg.publicKey, recoveryKey: reg.recoveryKey, paidUntil: new Date(options.now() + 30 * 86400_000).toISOString(), handle });
      const s = openSession({ kind: 'operator', operatorId: pay[1] });
      return json(201, { operatorId: pay[1], handle, paidUntil: operators.get(pay[1])!.paidUntil, delegatedAgentAllowance: body.delegatedAgents, ...s }, settled);
    }
    return refuse(404, 'NOT_FOUND');
  }

  const agentView = (a: Agent) => ({ id: a.id, name: a.name, status: a.status, interactions: a.interactions, universes: a.universes, createdAt: a.createdAt, credentialsUpdatedAt: a.createdAt, suspendedAt: null, deactivatedAt: null });
  const gqlError = (errorType: string, extra: Record<string, unknown> = {}) => json(200, { data: null, errors: [{ errorType, message: errorType, ...extra }] });

  function graphql(body: { query: string; variables?: Record<string, unknown> }, headers: Record<string, string>): Response {
    if (state.failNextGraphql401) { state.failNextGraphql401 = false; return json(401, { errors: [{ errorType: 'UnauthorizedException', message: 'no' }] }); }
    const s = headers.authorization ? sessions.get(headers.authorization) : undefined;
    if (!s || s.exp <= options.now()) return json(401, { errors: [{ errorType: 'UnauthorizedException', message: 'no' }] });
    if (state.graphqlRateLimitedNext > 0) { state.graphqlRateLimitedNext--; return gqlError('RATE_LIMITED', { errorInfo: { limit: 'MINUTE', retryAt: new Date(options.now() + 3000).toISOString() } }); }
    const q = body.query, v = body.variables ?? {};
    const op = operators.get(s.operatorId)!;
    if (op.recoveryKeyRequired) return gqlError('RECOVERY_KEY_REQUIRED');
    const manage = /delegatedAgents|createDelegatedAgent|DelegatedAgent\(|delegatedAgentActivity|delegatedAgentAllowance/.test(q);
    if (manage && s.kind === 'agent') return gqlError('DELEGATED_AGENT_CANNOT_MANAGE_AGENTS');
    if (q.includes('createDelegatedAgent')) {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      const id = randomUUID();
      const agent: Agent = { id, operatorId: op.id, name: v.name as string, publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(), status: 'active', interactions: (v.interactions as string[]) ?? null, universes: (v.universes as string[]) ?? null, createdAt: new Date(options.now()).toISOString() };
      if ([...agents.values()].some((a) => a.operatorId === op.id && a.name === agent.name)) return gqlError('DELEGATED_AGENT_NAME_TAKEN');
      agents.set(id, agent);
      return json(200, { data: { createDelegatedAgent: { agentId: id, operatorId: op.id, algorithm: 'Ed25519', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), signInUrl: 'https://agents.test/v1/delegated-agents', agent: agentView(agent) } } });
    }
    if (q.includes('restrictDelegatedAgent')) {
      const a = agents.get(v.id as string)!;
      if ('interactions' in v) a.interactions = v.interactions as string[] | null;
      if ('universes' in v) a.universes = v.universes as string[] | null;
      return json(200, { data: { restrictDelegatedAgent: agentView(a) } });
    }
    if (q.includes('suspendDelegatedAgent')) { const a = agents.get(v.id as string)!; a.status = 'suspended'; return json(200, { data: { suspendDelegatedAgent: agentView(a) } }); }
    if (q.includes('delegatedAgents')) return json(200, { data: { delegatedAgents: [...agents.values()].filter((a) => a.operatorId === op.id).map(agentView) } });
    const data: Record<string, unknown> = {};
    if (/\bme\b/.test(q)) data.me = { id: op.id, kind: 'operator', handle: op.handle, displayName: op.handle, organizationName: null, legalSpace: 'fra', paidTier: null, paidUntil: op.paidUntil, fullAgeConfirmedAt: '2026-10-23' };
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
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? 'GET', url: url.href, headers, body });
    if (url.host === 'apps.dev.break.rocks' && url.pathname === '/config/cells.json') {
      return json(200, { version: 1, default: 'eu', cells: { eu: { region: 'eu-west-1', api: 'https://api.test/graphql', agents: 'https://agents.test', media: 'https://media.test' } }, byCountry: { US: 'us' } });
    }
    if (url.host === 'agents.test') return agentsHost(url.pathname, body ?? {}, headers);
    if (url.host === 'api.test') return graphql(body, headers);
    throw new TypeError(`fetch failed: ${url.host}`);
  };

  return { fetch, calls, operators, agents, sessions, registrations, state };
}

/** A payer that signs nothing: the header the fake platform takes. */
export const fakePayer = async () => ({ 'PAYMENT-SIGNATURE': 'signed' });

/** A harness whose network is a fake platform on the clock of the harness. */
export async function onPlatform(options: Parameters<typeof import('./helpers.js').harness>[0] & { price?: string } = {}) {
  const { harness } = await import('./helpers.js');
  const { price, ...rest } = options;
  const holder: { platform?: ReturnType<typeof fakePlatform> } = {};
  const h = harness({ ...rest, fetch: (input, init) => holder.platform!.fetch(input, init) });
  holder.platform = fakePlatform({ now: () => h.clock.now, price });
  return { h, platform: holder.platform };
}
