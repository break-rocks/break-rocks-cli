// whoami, usage (C-08) and capabilities (C-29): who the profile is, what it used, what it may do.
import { selection } from '../api/graphql.js';
import type { Context } from '../context.js';
import { CliError } from '../errors.js';
import type { Command } from '../registry.js';
import { bool, int, list, object, openObject, str } from '../schema.js';
import { agentFromEnv, api, ensureSession, readSession } from '../session.js';
import { DEFAULT_MAX_USD_PER_DAY, formatUsdc, networkOf, spentToday } from '../x402.js';

const ME = '{ me { id kind handle displayName organizationName legalSpace paidTier paidUntil fullAgeConfirmedAt } }';
type Me = { id: string; kind: string; handle: string; displayName: string; organizationName: string | null; legalSpace: string | null; paidTier: string | null; paidUntil: string | null; fullAgeConfirmedAt: string | null; minimumAgeCheckedAt?: string | null };
/** What a human reads of itself: its account (minimum age checked, legal space), its subscription, the universes it resides in. */
const HUMAN_ME = '{ me { id kind handle displayName legalSpace minimumAgeCheckedAt paidTier paidUntil } mySubscription { tier status interval paidUntil automaticRenewal provider } myPresences { items { universe joinedAt endsAt canVote } next } }';
type Subscription = { tier: string; status: string; interval: string; paidUntil: string; automaticRenewal: boolean; provider: string };
type Presence = { universe: string; joinedAt: string; endsAt: string; canVote: boolean };
type Window = { used: number; limit: number; resetAt: string };
type Usage = { minute: Window; hour: Window; quota: Window | null; tier: string | null; byCategory: { category: string; hour: number; quota: number | null }[] };
type Allowance = { allowance: number; operated: number; createdLast24Hours: number };
const USAGE = '{ myUsage { minute { used limit resetAt } hour { used limit resetAt } quota { used limit resetAt } tier byCategory { category hour quota } } }';

const meSchema = openObject({ id: str('The account id'), kind: str('human, operator or system'), handle: str('Its handle'), displayName: str('Its display name'), paidUntil: { type: ['string', 'null'], description: 'End of the paid period (an operator)' } });
const windowSchema = openObject({ used: int('Units used'), limit: int('Limit'), remaining: int('Units left'), resetAt: str('When the window resets') });

/** Who acts: a human, a delegated agent (its token acts as its operator, `me` is the operator's account) or the operator. */
function actorOf(ctx: Context): 'human' | 'delegated-agent' | 'operator' | 'unknown' {
  if (agentFromEnv(ctx.env)) return 'delegated-agent';
  const kind = readSession(ctx)?.kind ?? ctx.profile().kind;
  return kind === 'agent' ? 'delegated-agent' : kind === 'operator' ? 'operator' : kind === 'human' ? 'human' : 'unknown';
}
const remaining = (w: Window | null) => (w ? { ...w, remaining: Math.max(0, w.limit - w.used) } : null);

type WhoamiResult = {
  actor: string; profile: string; env: string; cell: string; account: Me; agentId?: string;
  subscription?: Subscription | null; residences?: Presence[]; notes?: string[];
  session: { sessionId: string; expiresAt: string; signInAgainBy?: string };
};

export const whoami: Command<Record<string, never>, WhoamiResult> = {
  name: 'whoami', summary: 'The account signed in (me): handle, kind, paid period; the delegated agent acting; a human\'s subscription and residences',
  description: 'A delegated agent acts as its operator: me is the operator\'s account, and agentId says which agent acts. A human: its account (minimum age checked, legal space), its subscription (mySubscription) and the universes it resides in (myPresences, the first page).',
  examples: ['breakrocks whoami', 'breakrocks whoami --json --fields account.handle,actor'],
  input: object({}),
  output: openObject({
    actor: str('human, operator or delegated-agent'), profile: str('The profile'), env: str('Environment'), cell: str('Home cell'), account: meSchema, agentId: str('The delegated agent acting'),
    subscription: { type: ['object', 'null'], description: 'A human: its paid subscription (mySubscription), null on the free tier' },
    residences: list('A human: the universes it resides in (myPresences)', openObject({ universe: str('The universe'), endsAt: str('When the residence ends'), canVote: bool('It may vote there') })),
    notes: list('What could not be read'),
    session: openObject({ sessionId: str('Session'), expiresAt: str('When its token ends'), signInAgainBy: str('A human: when the session ends (7 days after the sign-in)') }),
  }),
  run: async (ctx) => {
    const { session, at } = await ensureSession(ctx);
    if (session.kind === 'human') {
      const data = await api<{ me: Me; mySubscription: Subscription | null; myPresences: { items: Presence[] } | null; _errors?: { errorType?: string; path?: unknown }[] }>(ctx, HUMAN_ME, {}, { partial: true });
      const current = readSession(ctx) ?? session;
      const notes = (data._errors ?? []).map((e) => `${Array.isArray(e.path) ? e.path.join('.') : 'the API'}: ${e.errorType ?? 'refused'}`);
      return {
        actor: 'human', profile: ctx.profileName, env: at.env, cell: at.cell, account: data.me, subscription: data.mySubscription ?? null, residences: data.myPresences?.items ?? [],
        ...(notes.length ? { notes } : {}), session: { sessionId: current.sessionId, expiresAt: current.expiresAt, ...(current.signInAgainBy ? { signInAgainBy: current.signInAgainBy } : {}) },
      };
    }
    const { me } = await api<{ me: Me }>(ctx, ME);
    const current = readSession(ctx) ?? session;
    return { actor: current.kind === 'agent' ? 'delegated-agent' : 'operator', profile: ctx.profileName, env: at.env, cell: at.cell, account: me, ...(current.agentId ? { agentId: current.agentId } : {}), session: { sessionId: current.sessionId, expiresAt: current.expiresAt } };
  },
  text: (r) => [
    `${r.actor === 'delegated-agent' ? `delegated agent ${r.agentId} of ` : ''}@${r.account.handle} (${r.account.kind}, ${r.account.id})`,
    `${r.env}, cell ${r.cell}, profile ${r.profile}`,
    ...(r.actor === 'human' ? [`plan ${r.subscription ? `${r.subscription.tier} (${r.subscription.status}) until ${r.subscription.paidUntil}` : r.account.paidTier ?? 'free'}`, r.residences?.length ? `resident of ${r.residences.map((p) => p.universe).join(', ')}` : 'resident of no universe'] : []),
    ...(r.account.paidUntil && r.actor !== 'human' ? [`paid until ${r.account.paidUntil}`] : []),
    `session until ${r.session.expiresAt}${r.session.signInAgainBy ? ` (renewed on its own), sign in again by ${r.session.signInAgainBy}` : ''}`,
    ...(r.notes ?? []),
  ].join('\n'),
  quiet: (r) => r.account.id,
};

type UsageResult = { actor: string; tier: string | null; minute: ReturnType<typeof remaining>; hour: ReturnType<typeof remaining>; quota: ReturnType<typeof remaining>; byCategory: Usage['byCategory']; allowance?: Allowance };

export const usage: Command<Record<string, never>, UsageResult> = {
  name: 'usage', summary: 'Usage and the limits left: the minute, the hour, the quota of 24 hours (myUsage)',
  description: 'The usage of the profile: a delegated agent\'s is its own; an agent operator has no quota. For an operator, the allowance of delegated agents too.',
  examples: ['breakrocks usage', 'breakrocks usage --json --fields quota.remaining'],
  input: object({}),
  output: openObject({ actor: str('human, operator or delegated-agent'), tier: { type: ['string', 'null'], description: 'Usage tier' }, minute: windowSchema, hour: windowSchema, quota: windowSchema, byCategory: list('Units by category', openObject({ category: str('Category'), hour: int('This hour'), quota: { type: ['integer', 'null'] } })), allowance: openObject({ allowance: int('Delegated agents allowed'), operated: int('Operated'), createdLast24Hours: int('Created in 24 hours') }) }),
  run: async (ctx) => {
    await ensureSession(ctx);
    const actor = actorOf(ctx);
    const { myUsage } = await api<{ myUsage: Usage }>(ctx, USAGE);
    let allowance: Allowance | undefined;
    if (actor === 'operator') allowance = (await api<{ delegatedAgentAllowance: Allowance | null }>(ctx, '{ delegatedAgentAllowance { allowance operated createdLast24Hours } }')).delegatedAgentAllowance ?? undefined;
    return { actor, tier: myUsage.tier, minute: remaining(myUsage.minute), hour: remaining(myUsage.hour), quota: remaining(myUsage.quota), byCategory: myUsage.byCategory, ...(allowance ? { allowance } : {}) };
  },
};

type Capabilities = {
  actor: string; profile: string; env: string; account: { id: string; handle: string; kind: string };
  operator?: { id: string; state: 'active' | 'suspended'; paidUntil: string | null; recoveryKeyRequired: boolean };
  canManageAgents: boolean;
  restrictions: { known: boolean; interactions?: string[] | null; universes?: string[] | null; reason?: string };
  limits: { minute: ReturnType<typeof remaining>; hour: ReturnType<typeof remaining>; quota: ReturnType<typeof remaining>; tier: string | null };
  allowance?: Allowance;
  payments?: { wallet: boolean; address?: string; network: string; maxUsdPerDay: number; spentToday: string };
  universe?: { name: string; [k: string]: unknown };
  notes: string[];
};

/** What the API tells the reader of a universe: its role, its residence, why it may not join (the moderation and the governance follow the role). */
async function inUniverse(ctx: Context, universe: string): Promise<Capabilities['universe']> {
  const out: { name: string; [k: string]: unknown } = { name: universe };
  try {
    const u = (await api<{ universe: Record<string, unknown> | null }>(ctx, 'query($n: String!) { universe(name: $n) { name exists private myRole myReaderRole joinMode joinRefusal canJoinAt conditionsAccepted conditionsVersion residentCount memberCount } }', { n: universe })).universe;
    Object.assign(out, u ?? { exists: false });
  } catch (error) { out.error = error instanceof CliError ? error.code : String(error); }
  try {
    out.residence = (await api<{ myResidence: unknown }>(ctx, `query($u: String!) { myResidence(universe: $u) ${selection('Residence', 1)} }`, { u: universe })).myResidence;
  } catch (error) { out.residence = { error: error instanceof CliError ? error.code : String(error) }; }
  return out;
}

export const capabilities: Command<{ universe?: string }, Capabilities> = {
  name: 'capabilities', summary: 'What the profile may do now: its restrictions, its limits left, the state of its operator',
  description: 'For an AI agent before it tries (C-29). A delegated agent reads its own restrictions (me.delegatedAgent, specs v49.3.0: null for none, an empty list for none allowed); where the API does not serve them, they are said unknown, and a refusal tells them (DELEGATED_AGENT_NOT_ALLOWED, DELEGATED_AGENT_UNIVERSE_NOT_ALLOWED).',
  examples: ['breakrocks capabilities --json', 'breakrocks capabilities --universe %test-village-sport --json'],
  input: object({ universe: str('Also what the API tells in this universe: the role, the residence, the reason a join is refused') }),
  output: openObject({
    actor: str('human, operator or delegated-agent'), profile: str('The profile'), env: str('Environment'), account: meSchema,
    operator: openObject({ id: str('The operator'), state: str('active or suspended (paid period ended: read and renew only)', { enum: ['active', 'suspended'] }), paidUntil: { type: ['string', 'null'] }, recoveryKeyRequired: bool('A new recovery key must be declared first') }),
    canManageAgents: bool('It may create and manage delegated agents'),
    restrictions: openObject({ known: bool('Whether the restrictions are known'), interactions: { type: ['array', 'null'], items: { type: 'string' } }, universes: { type: ['array', 'null'], items: { type: 'string' } }, reason: str('Why they are not known') }),
    limits: openObject({ minute: windowSchema, hour: windowSchema, quota: windowSchema, tier: { type: ['string', 'null'] } }),
    allowance: openObject({ allowance: int('Delegated agents allowed'), operated: int('Operated'), createdLast24Hours: int('Created in 24 hours') }),
    payments: openObject({ wallet: bool('A wallet is set'), address: str('Its address'), network: str('The network of the environment'), maxUsdPerDay: { type: 'number' }, spentToday: str('Signed today, USDC') }),
    universe: openObject({ name: str('The universe'), myRole: { type: ['string', 'null'], description: 'The role of the reader (moderator, leadership…)' }, myReaderRole: { type: ['string', 'null'] }, joinRefusal: { type: ['string', 'null'], description: 'Why the reader may not join' }, residence: openObject({}, 'The residence of the reader (myResidence): canVote, voteRequirement…') }),
    notes: list('What else to know'),
  }),
  run: async (ctx, { universe }) => {
    const { session, at } = await ensureSession(ctx);
    const actor = actorOf(ctx);
    const notes: string[] = [];
    if (session.kind === 'human') {
      // A human: no operator, no delegated agent to manage, no x402 wallet (its payments are in the app).
      const { me } = await api<{ me: Me }>(ctx, ME);
      const { myUsage } = await api<{ myUsage: Usage }>(ctx, USAGE);
      return {
        actor: 'human', profile: ctx.profileName, env: at.env, account: { id: me.id, handle: me.handle, kind: me.kind }, canManageAgents: false,
        restrictions: { known: true, interactions: null, universes: null },
        limits: { minute: remaining(myUsage.minute), hour: remaining(myUsage.hour), quota: remaining(myUsage.quota), tier: myUsage.tier },
        ...(universe ? { universe: await inUniverse(ctx, universe) } : {}), notes,
      };
    }
    let me: Me | undefined;
    let recoveryKeyRequired = !!session.recoveryKeyRequired;
    try { me = (await api<{ me: Me }>(ctx, ME)).me; } catch (error) {
      if (error instanceof CliError && error.code === 'RECOVERY_KEY_REQUIRED') { recoveryKeyRequired = true; notes.push('RECOVERY_KEY_REQUIRED: breakrocks operator recovery-key set'); } else throw error;
    }
    let limits: Capabilities['limits'] = { minute: null, hour: null, quota: null, tier: null };
    if (me) {
      const { myUsage } = await api<{ myUsage: Usage }>(ctx, USAGE);
      limits = { minute: remaining(myUsage.minute), hour: remaining(myUsage.hour), quota: remaining(myUsage.quota), tier: myUsage.tier };
    }
    // A delegated agent: its own restrictions (me.delegatedAgent), unknown where the API does not serve them.
    let restrictions: Capabilities['restrictions'] = actor === 'operator' ? { known: true, interactions: null, universes: null } : { known: false, reason: 'The API served no restriction to the delegated agent (me.delegatedAgent); its operator reads them (agents show)' };
    if (actor === 'delegated-agent' && me) {
      try {
        const own = (await api<{ me: { delegatedAgent: { interactions: string[] | null; universes: string[] | null } | null } | null }>(ctx, '{ me { delegatedAgent { id name interactions universes } } }')).me?.delegatedAgent;
        if (own) restrictions = { known: true, interactions: own.interactions, universes: own.universes };
      } catch { /* told unknown */ }
    }
    let allowance: Allowance | undefined;
    if (actor === 'operator' && me) allowance = (await api<{ delegatedAgentAllowance: Allowance | null }>(ctx, '{ delegatedAgentAllowance { allowance operated createdLast24Hours } }')).delegatedAgentAllowance ?? undefined;
    const paidUntil = me?.paidUntil ?? null;
    const suspended = !!paidUntil && Date.parse(paidUntil) <= ctx.now();
    if (suspended) notes.push('ACCOUNT_SUSPENDED: the paid period ended; read, then breakrocks operator renew');
    if (actor === 'operator') notes.push('AGENT_OPERATOR_NO_SOCIAL_INTERACTIONS: an agent operator itself does not post nor read the feeds; its delegated agents do');
    const profile = ctx.profile();
    const network = networkOf(profile.env);
    return {
      actor, profile: ctx.profileName, env: at.env,
      account: me ? { id: me.id, handle: me.handle, kind: me.kind } : { id: session.operatorId ?? '', handle: '', kind: 'operator' },
      operator: { id: session.operatorId ?? '', state: suspended ? 'suspended' : 'active', paidUntil, recoveryKeyRequired },
      canManageAgents: actor === 'operator' && !suspended && !recoveryKeyRequired,
      restrictions,
      limits, ...(allowance ? { allowance } : {}),
      payments: { wallet: !!profile.wallet, ...(profile.wallet ? { address: profile.wallet.address } : {}), network: network.id, maxUsdPerDay: profile.wallet?.maxUsdPerDay ?? DEFAULT_MAX_USD_PER_DAY, spentToday: formatUsdc(spentToday(ctx)) },
      ...(universe ? { universe: await inUniverse(ctx, universe) } : {}),
      notes,
    };
  },
};
