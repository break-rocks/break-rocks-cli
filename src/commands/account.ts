// whoami, usage (C-08) and capabilities (C-29): who the profile is, what it used, what it may do.
import { selection } from '../api/graphql.js';
import type { Context } from '../context.js';
import { CliError } from '../errors.js';
import type { Command } from '../registry.js';
import { bool, int, list, object, openObject, str } from '../schema.js';
import { agentFromEnv, api, ensureSession, readSession } from '../session.js';
import { DEFAULT_MAX_USD_PER_DAY, formatUsdc, networkOf, spentToday } from '../x402.js';

const ME = '{ me { id kind handle displayName organizationName legalSpace paidTier paidUntil fullAgeConfirmedAt } }';
type Me = { id: string; kind: string; handle: string; displayName: string; organizationName: string | null; legalSpace: string | null; paidTier: string | null; paidUntil: string | null; fullAgeConfirmedAt: string | null };
type Window = { used: number; limit: number; resetAt: string };
type Usage = { minute: Window; hour: Window; quota: Window | null; tier: string | null; byCategory: { category: string; hour: number; quota: number | null }[] };
type Allowance = { allowance: number; operated: number; createdLast24Hours: number };
const USAGE = '{ myUsage { minute { used limit resetAt } hour { used limit resetAt } quota { used limit resetAt } tier byCategory { category hour quota } } }';

const meSchema = openObject({ id: str('The account id'), kind: str('human, operator or system'), handle: str('Its handle'), displayName: str('Its display name'), paidUntil: { type: ['string', 'null'], description: 'End of the paid period (an operator)' } });
const windowSchema = openObject({ used: int('Units used'), limit: int('Limit'), remaining: int('Units left'), resetAt: str('When the window resets') });

/** Who acts: a delegated agent (its token acts as its operator, `me` is the operator's account) or the operator. */
function actorOf(ctx: Context): 'delegated-agent' | 'operator' | 'unknown' {
  if (agentFromEnv(ctx.env)) return 'delegated-agent';
  const kind = readSession(ctx)?.kind ?? ctx.profile().kind;
  return kind === 'agent' ? 'delegated-agent' : kind === 'operator' ? 'operator' : 'unknown';
}
const remaining = (w: Window | null) => (w ? { ...w, remaining: Math.max(0, w.limit - w.used) } : null);

type WhoamiResult = { actor: string; profile: string; env: string; cell: string; account: Me; agentId?: string; session: { sessionId: string; expiresAt: string } };

export const whoami: Command<Record<string, never>, WhoamiResult> = {
  name: 'whoami', summary: 'The account signed in (me): handle, kind, paid period; and the delegated agent acting',
  description: 'A delegated agent acts as its operator: me is the operator\'s account, and agentId says which agent acts.',
  examples: ['breakrocks whoami', 'breakrocks whoami --json --fields account.handle,actor'],
  input: object({}),
  output: openObject({ actor: str('operator or delegated-agent'), profile: str('The profile'), env: str('Environment'), cell: str('Home cell'), account: meSchema, agentId: str('The delegated agent acting'), session: openObject({ sessionId: str('Session'), expiresAt: str('When it ends') }) }),
  run: async (ctx) => {
    const { session, at } = await ensureSession(ctx);
    const { me } = await api<{ me: Me }>(ctx, ME);
    const current = readSession(ctx) ?? session;
    return { actor: current.kind === 'agent' ? 'delegated-agent' : 'operator', profile: ctx.profileName, env: at.env, cell: at.cell, account: me, ...(current.agentId ? { agentId: current.agentId } : {}), session: { sessionId: current.sessionId, expiresAt: current.expiresAt } };
  },
  text: (r) => `${r.actor === 'delegated-agent' ? `delegated agent ${r.agentId} of ` : ''}@${r.account.handle} (${r.account.kind}, ${r.account.id})\n${r.env}, cell ${r.cell}, profile ${r.profile}${r.account.paidUntil ? `\npaid until ${r.account.paidUntil}` : ''}\nsession until ${r.session.expiresAt}`,
  quiet: (r) => r.account.id,
};

type UsageResult = { actor: string; tier: string | null; minute: ReturnType<typeof remaining>; hour: ReturnType<typeof remaining>; quota: ReturnType<typeof remaining>; byCategory: Usage['byCategory']; allowance?: Allowance };

export const usage: Command<Record<string, never>, UsageResult> = {
  name: 'usage', summary: 'Usage and the limits left: the minute, the hour, the quota of 24 hours (myUsage)',
  description: 'The usage of the profile: a delegated agent\'s is its own; an agent operator has no quota. For an operator, the allowance of delegated agents too.',
  examples: ['breakrocks usage', 'breakrocks usage --json --fields quota.remaining'],
  input: object({}),
  output: openObject({ actor: str('operator or delegated-agent'), tier: { type: ['string', 'null'], description: 'Usage tier' }, minute: windowSchema, hour: windowSchema, quota: windowSchema, byCategory: list('Units by category', openObject({ category: str('Category'), hour: int('This hour'), quota: { type: ['integer', 'null'] } })), allowance: openObject({ allowance: int('Delegated agents allowed'), operated: int('Operated'), createdLast24Hours: int('Created in 24 hours') }) }),
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
  operator: { id: string; state: 'active' | 'suspended'; paidUntil: string | null; recoveryKeyRequired: boolean };
  canManageAgents: boolean;
  restrictions: { known: boolean; interactions?: string[] | null; universes?: string[] | null; reason?: string };
  limits: { minute: ReturnType<typeof remaining>; hour: ReturnType<typeof remaining>; quota: ReturnType<typeof remaining>; tier: string | null };
  allowance?: Allowance;
  payments: { wallet: boolean; address?: string; network: string; maxUsdPerDay: number; spentToday: string };
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
  description: 'For an AI agent before it tries (C-29). The restrictions of a delegated agent are not served to the agent by the API (delegatedAgents is refused to it): they are said unknown, and a refusal tells them (DELEGATED_AGENT_NOT_ALLOWED, DELEGATED_AGENT_UNIVERSE_NOT_ALLOWED).',
  examples: ['breakrocks capabilities --json', 'breakrocks capabilities --universe %test-village-sport --json'],
  input: object({ universe: str('Also what the API tells in this universe: the role, the residence, the reason a join is refused') }),
  output: openObject({
    actor: str('operator or delegated-agent'), profile: str('The profile'), env: str('Environment'), account: meSchema,
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
      account: me ? { id: me.id, handle: me.handle, kind: me.kind } : { id: session.operatorId, handle: '', kind: 'operator' },
      operator: { id: session.operatorId, state: suspended ? 'suspended' : 'active', paidUntil, recoveryKeyRequired },
      canManageAgents: actor === 'operator' && !suspended && !recoveryKeyRequired,
      restrictions: actor === 'operator' ? { known: true, interactions: null, universes: null } : { known: false, reason: 'The API serves no restriction to the delegated agent itself; its operator reads them (agents show)' },
      limits, ...(allowance ? { allowance } : {}),
      payments: { wallet: !!profile.wallet, ...(profile.wallet ? { address: profile.wallet.address } : {}), network: network.id, maxUsdPerDay: profile.wallet?.maxUsdPerDay ?? DEFAULT_MAX_USD_PER_DAY, spentToday: formatUsdc(spentToday(ctx)) },
      ...(universe ? { universe: await inUniverse(ctx, universe) } : {}),
      notes,
    };
  },
};
