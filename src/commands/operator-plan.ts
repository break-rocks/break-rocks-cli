// operator plan offer|show|start|change|stop|resume: the plan of delegated agents of an agent
// operator paid by card. Bought, changed and stopped from the CLI only, the
// payment opening in the browser (Stripe Checkout); the prices are read from the API, never written
// here. The plan at the registration is operator register --plan.
import { openInBrowser } from '../browser-login.js';
import type { Context } from '../context.js';
import { cliRefusal, usageError } from '../errors.js';
import { bool } from '../schema.js';
import { api, requireOperator } from '../session.js';
import { apiCommand } from '../api/command.js';

export type OperatorPlan = { automaticRenewal: boolean; delegatedAgents: number; interval: string; nextDelegatedAgents: number | null; nextFrom: string | null; paidUntil: string; payerId: string; provider: string; status: string };
export type PlanPrice = { amount: number; currency: string; delegatedAgents: number; interval: string };
type Offer = { prices: PlanPrice[]; providers: string[] };

const PLAN = 'automaticRenewal delegatedAgents interval nextDelegatedAgents nextFrom paidUntil payerId provider status';
const OFFER = '{ prices { amount currency delegatedAgents interval } providers }';
const day = (iso?: string | null) => (iso ? iso.slice(0, 10) : '?');
const per = (interval: string) => (interval === 'YEAR' ? 'a year' : 'a month');

/** An amount in the minor unit of its currency ("4000", "USD" → "40.00 USD"). */
export const money = (amount: number, currency: string) => `${(amount / 100).toFixed(2)} ${currency}`;

/** The profile must hold an agent operator: the plans paid by card are its own (a delegated agent pays with x402 only). */
function requirePlanOperator(ctx: Context): void {
  requireOperator(ctx);
  const profile = ctx.profile();
  if (profile.kind !== 'operator' || !profile.operatorId) throw usageError('NOT_AN_OPERATOR_PROFILE', `The profile "${ctx.profileName}" holds no agent operator: the plans of delegated agents are bought with the profile of an agent operator`, { profile: ctx.profileName });
}

const myPlan = async (ctx: Context) => (await api<{ myOperatorPlan: OperatorPlan | null }>(ctx, `{ myOperatorPlan { ${PLAN} } }`)).myOperatorPlan;

export const planText = (p: OperatorPlan | null) => {
  if (!p) return 'No plan paid by card (the paid period, if any, is paid with x402): breakrocks operator plan offer, then operator plan start <agents>';
  const lines = [`Plan of ${p.delegatedAgents} delegated agents, paid ${p.interval === 'YEAR' ? 'yearly' : 'monthly'} by ${p.provider} (${p.status})`, `  paid until ${day(p.paidUntil)}, automatic renewal ${p.automaticRenewal ? 'on' : 'off: it ends then, without refund'}`];
  if (p.nextDelegatedAgents != null) lines.push(`  ${p.nextDelegatedAgents} delegated agents from ${day(p.nextFrom)} (the agents beyond are deactivated then: the inactive ones first, then the oldest)`);
  return lines.join('\n');
};

const offerText = (o: Offer | null) => {
  if (!o || !o.prices.length) return 'No plan offered in this currency and interval.';
  const rows = [...o.prices].sort((a, b) => a.interval.localeCompare(b.interval) || a.delegatedAgents - b.delegatedAgents || a.currency.localeCompare(b.currency));
  return [...rows.map((p) => `${String(p.delegatedAgents).padStart(6)} delegated agents  ${money(p.amount, p.currency).padStart(14)} ${per(p.interval)}`), `Paid by card (${o.providers.join(', ') || 'none available'}), the payment opening in the browser: breakrocks operator plan start <agents>. Beyond 1,000: any multiple of 1,000, by blocks of 1,000.`].join('\n');
};

export const operatorPlanOffer = apiCommand<Offer | null>({
  name: 'operator plan offer', summary: 'The plans of delegated agents paid by card and their prices (operatorPlanOffer)', kind: 'query', op: 'operatorPlanOffer',
  description: 'The plans of 10, 100 and 1,000 delegated agents (beyond 1,000, any multiple of 1,000), monthly and yearly (a year: 10 times the monthly price), as the platform prices them; the amounts are in the minor unit of their currency (4000 USD = 40.00 USD).',
  descriptions: { currency: 'A currency (ISO 4217: USD, EUR): only its prices', interval: 'MONTH or YEAR: only those prices' },
  examples: ['breakrocks operator plan offer', 'breakrocks operator plan offer --interval YEAR --json'],
  select: OFFER, prepare: (i, ctx) => { requirePlanOperator(ctx); return i; }, text: offerText, quiet: () => undefined,
});

export const operatorPlanShow = apiCommand<OperatorPlan | null>({
  name: 'operator plan show', summary: 'The plan of delegated agents paid by card of the agent operator (myOperatorPlan)', kind: 'query', op: 'myOperatorPlan',
  description: 'null without a plan paid by card. nextDelegatedAgents and nextFrom: a smaller plan from the end of the paid period.',
  examples: ['breakrocks operator plan show', 'breakrocks operator plan show --json'],
  select: `{ ${PLAN} }`, prepare: (i, ctx) => { requirePlanOperator(ctx); return i; }, text: planText, quiet: (p) => (p ? String(p.delegatedAgents) : undefined),
});

type Started = { url: string; expiresAt: string; delegatedAgents: number; interval: string; price?: PlanPrice; x402PaidUntil?: string; opened?: boolean };

const startCommand = apiCommand<Started>({
  name: 'operator plan start', summary: 'Buy a plan of delegated agents by card: the payment opens in the browser (startOperatorPlan)', kind: 'mutation', op: 'startOperatorPlan',
  description: 'The Checkout page of the payment is opened in the browser (--no-open: its address is written only); the plan applies once the payment is confirmed (breakrocks operator plan show). The price is read from the offer and said first. A period paid with x402 in progress is taken over at once by the plan and is not refunded: the CLI says so before opening the payment. A plan already running changes with operator plan change.',
  positionals: ['delegatedAgents'], rename: { delegatedAgents: 'agents' },
  descriptions: { agents: 'Delegated agents of the plan: 10, 100, 1,000 or a multiple of 1,000', interval: 'MONTH (default) or YEAR (10 times the monthly price)', currency: 'A currency (ISO 4217); default: the first one with a price', returnPath: 'The path of the web app the payment page returns to (default: the usual one)' },
  extra: { open: bool('Open the payment page in the browser (--no-open: write its address only)', { default: true }) },
  examples: ['breakrocks operator plan start 10', 'breakrocks operator plan start 100 --interval YEAR --no-open --json'],
  prepare: async (i, ctx) => {
    requirePlanOperator(ctx);
    const interval = (i.interval as string | undefined) ?? 'MONTH';
    const data = await api<{ me: { paidUntil: string | null }; myOperatorPlan: OperatorPlan | null; operatorPlanOffer: Offer | null }>(ctx, `query($c: String, $i: BillingInterval) { me { paidUntil } myOperatorPlan { delegatedAgents status } operatorPlanOffer(currency: $c, interval: $i) ${OFFER} }`, { c: i.currency ?? null, i: interval });
    const agents = i.agents as number;
    const price = data.operatorPlanOffer?.prices.find((p) => p.delegatedAgents === agents && p.interval === interval && (!i.currency || p.currency === String(i.currency).toUpperCase()));
    if (price) ctx.notice(`The plan of ${agents} delegated agents costs ${money(price.amount, price.currency)} ${per(interval)}.`);
    else ctx.notice(`The offer lists no price for ${agents} delegated agents ${per(interval)}: the platform answers (beyond 1,000, a multiple of 1,000 is priced by blocks of 1,000).`);
    const x402PaidUntil = !data.myOperatorPlan && data.me.paidUntil && Date.parse(data.me.paidUntil) > ctx.now() ? data.me.paidUntil : undefined;
    if (x402PaidUntil) ctx.notice(`Your period paid with x402 runs until ${day(x402PaidUntil)}: the plan takes over at once, and that period is not refunded.`);
    return { ...i, _price: price, _x402: x402PaidUntil, _interval: interval };
  },
  map: (data, i) => {
    const c = data as { url: string; expiresAt: string };
    return { url: c.url, expiresAt: c.expiresAt, delegatedAgents: i.agents as number, interval: i._interval as string, ...(i._price ? { price: i._price as PlanPrice } : {}), ...(i._x402 ? { x402PaidUntil: i._x402 as string } : {}) };
  },
  text: (r) => `Pay the plan of ${r.delegatedAgents} delegated agents in the browser: ${r.url}\nThe page is open until ${r.expiresAt}. Once paid: breakrocks operator plan show`,
  quiet: (r) => r.url,
});

/** Opens the Checkout page in the browser (its address is in the answer anyway); false with --no-open or when it could not. */
export async function openCheckout(ctx: Context, url: string, open: boolean): Promise<boolean> {
  if (!open) return false;
  const opened = await (ctx.io.openUrl ?? openInBrowser)(url);
  if (!opened) ctx.notice(`The browser could not be opened: open the payment page yourself: ${url}`);
  return opened;
}

export const operatorPlanStart = {
  ...startCommand,
  run: async (ctx: Context, input: Record<string, unknown>) => {
    const r = await startCommand.run(ctx, input);
    return { ...r, opened: await openCheckout(ctx, r.url, input.open !== false) };
  },
};

export const operatorPlanChange = apiCommand<OperatorPlan>({
  name: 'operator plan change', summary: 'Change the number of delegated agents of the plan paid by card (changeOperatorPlan)', kind: 'mutation', op: 'changeOperatorPlan',
  description: 'A larger plan applies at once, the difference paid pro rata for the rest of the paid period with the card of the plan (PAYMENT_FAILED: refused by the card, nothing changes). A smaller plan applies at the end of the paid period, and the delegated agents beyond it are deactivated then: the inactive ones first, then the oldest. Both ask a confirmation (--yes).',
  positionals: ['delegatedAgents'], rename: { delegatedAgents: 'agents' }, descriptions: { agents: 'Delegated agents of the new plan: 10, 100, 1,000 or a multiple of 1,000' },
  examples: ['breakrocks operator plan change 100 --yes', 'breakrocks operator plan change 10'],
  select: `{ ${PLAN} }`,
  prepare: async (i, ctx) => {
    requirePlanOperator(ctx);
    const current = await myPlan(ctx);
    if (!current) throw cliRefusal('SUBSCRIPTION_NOT_FOUND', 'No plan paid by card to change: breakrocks operator plan start <agents>');
    if (current.delegatedAgents === i.agents && current.nextDelegatedAgents == null) throw cliRefusal('PLAN_UNCHANGED', `The plan already has ${current.delegatedAgents} delegated agents`, { delegatedAgents: current.delegatedAgents });
    return { ...i, _current: current };
  },
  confirm: (i) => {
    const current = i._current as OperatorPlan, agents = i.agents as number;
    return agents > current.delegatedAgents
      ? `Upgrade the plan from ${current.delegatedAgents} to ${agents} delegated agents at once? The card of the plan pays the difference for the rest of the paid period (until ${day(current.paidUntil)}).`
      : `Reduce the plan from ${current.delegatedAgents} to ${agents} delegated agents on ${day(current.paidUntil)}, the end of the paid period? Then the delegated agents beyond ${agents} are deactivated: the inactive ones first, then the oldest.`;
  },
  text: planText, quiet: (p) => String(p.delegatedAgents),
});

const renewal = (verb: 'stop' | 'resume') => apiCommand<OperatorPlan>({
  name: `operator plan ${verb}`, kind: 'mutation', op: 'setOperatorPlanRenewal', fixed: { enabled: verb === 'resume' },
  summary: verb === 'stop' ? 'Stop the plan paid by card: no renewal, it ends with its paid period, without refund (setOperatorPlanRenewal)' : 'Renew the plan paid by card again at the end of its paid period (setOperatorPlanRenewal)',
  description: verb === 'stop' ? 'The allowance of delegated agents stays until the end of the paid period; nothing is refunded. operator plan resume turns the renewal on again before that end.' : 'The automatic renewal turned on again, before the end of the paid period.',
  examples: [`breakrocks operator plan ${verb}`],
  select: `{ ${PLAN} }`, prepare: (i, ctx) => { requirePlanOperator(ctx); return i; }, text: planText, quiet: (p) => String(p.automaticRenewal),
});
export const operatorPlanStop = renewal('stop');
export const operatorPlanResume = renewal('resume');
