// The paid tiers of the account (X2, X10) and their billing (D-92, D-303: the operations of before specs v83.1.0
// still without a command): the subscription and its offer, its start (a payment page of the provider, never paid
// from the CLI), its renewal, its billing day, the billing portal, the gift codes (offer, bought, used, refunded) and
// the verification of a seller. A payment page is given as its address: the payment is made in a browser.
import { apiCommand } from '../api/command.js';
import { listText } from './shared.js';

const paymentText = (r: unknown) => { const p = r as { url?: string; expiresAt?: string; accessFrom?: string | null } | null; return p ? [`open: ${p.url}`, `expires ${p.expiresAt}`, ...(p.accessFrom ? [`access from ${p.accessFrom}`] : [])].join('\n') : '(none)'; };
type Subscription = { tier?: string; status?: string; interval?: string; paidUntil?: string; automaticRenewal?: boolean; provider?: string; next?: { tier?: string } | null; billingDay?: { day?: number } | null };
const subscriptionText = (r: unknown) => {
  const s = r as Subscription | null;
  return s ? `${s.tier}  ${s.status}  ${s.interval ?? ''}  paid until ${s.paidUntil ?? '-'}  renewal ${s.automaticRenewal ? 'on' : 'off'}${s.billingDay?.day ? `  billing day ${s.billingDay.day}` : ''}${s.next?.tier ? `  next ${s.next.tier}` : ''}` : '(no subscription)';
};
const returnPath = { returnPath: 'Where the payment page comes back (a path of the web app)', currency: 'The currency (EUR, USD…; the first of the catalog by default)' };

export const subscriptionShow = apiCommand({ name: 'subscription show', summary: 'The paid tier subscription of the account (mySubscription; none: no subscription)', kind: 'query', op: 'mySubscription', text: subscriptionText, examples: ['breakrocks subscription show'] });
export const subscriptionOffer = apiCommand({
  name: 'subscription offer', summary: 'The prices of the paid tiers in a currency, and the payment providers (subscriptionOffer)', kind: 'query', op: 'subscriptionOffer', descriptions: returnPath,
  examples: ['breakrocks subscription offer', 'breakrocks subscription offer --currency USD --json'],
});
export const subscriptionStart = apiCommand({
  name: 'subscription start', summary: 'Subscribe to a paid tier: the address of the payment page, the subscription starts once the provider confirms (startSubscription)',
  description: 'The payment is made in a browser, never by the CLI. SUBSCRIPTION_EXISTS when one is in force.',
  kind: 'mutation', op: 'startSubscription', positionals: ['tier'], dry: true,
  descriptions: { ...returnPath, tier: 'X2 or X10', interval: 'MONTH or YEAR', automaticRenewal: 'Renewed on its own (--no-automatic-renewal: not)' },
  confirm: (i) => `Open a payment page for ${String(i.tier)} (${String(i.interval)})?`, text: paymentText,
  examples: ['breakrocks subscription start X2 --interval MONTH --automatic-renewal --yes'],
});
const renewal = (enabled: boolean) => apiCommand({
  name: `subscription renewal ${enabled ? 'on' : 'off'}`, summary: enabled ? 'Turn the automatic renewal back on (setAutomaticRenewal)' : 'Turn the automatic renewal off: the subscription ends at its paid date, without refund (setAutomaticRenewal)',
  kind: 'mutation', op: 'setAutomaticRenewal', fixed: { enabled }, text: subscriptionText, examples: [`breakrocks subscription renewal ${enabled ? 'on' : 'off'}`],
});
export const subscriptionRenewalOn = renewal(true);
export const subscriptionRenewalOff = renewal(false);
const billingDay = { flatten: ['input', 'subscription'], positionals: ['input.day'], descriptions: { day: 'The day of the month (1 to 28)', month: 'The month, for a yearly subscription (1 to 12)', settleNow: 'Settle the difference now', kind: 'The subscription: PAID_TIER, TIER_SUBSCRIPTION (with --universe) or OPERATOR_PLAN', universe: 'The universe of a tier subscription' } };
export const billingDayOffer = apiCommand({
  name: 'subscription billing-day offer', summary: 'What a billing day would cost, changing nothing (billingDayOffer)', kind: 'query', op: 'billingDayOffer', ...billingDay,
  examples: ['breakrocks subscription billing-day offer 15 --kind PAID_TIER'],
});
export const billingDaySet = apiCommand({
  name: 'subscription billing-day set', summary: 'Choose the billing day of a subscription paid by card, once per paid period (setBillingDay)', kind: 'mutation', op: 'setBillingDay', ...billingDay, dry: true,
  confirm: (i) => `Set the billing day to ${String(i.day)}? Once per paid period.`,
  text: (r) => { const d = r as { day?: number; month?: number | null; nextDueDate?: string; pending?: boolean } | null; return d ? `day ${d.day}${d.month ? `, month ${d.month}` : ''}  next due ${d.nextDueDate ?? '-'}${d.pending ? '  pending' : ''}` : '(none)'; },
  examples: ['breakrocks subscription billing-day set 15 --kind PAID_TIER --yes'],
});
export const subscriptionPortal = apiCommand({
  name: 'subscription portal', summary: 'The billing portal of the payment provider: payment methods and invoices (openBillingPortal)', kind: 'mutation', op: 'openBillingPortal', descriptions: returnPath, text: paymentText,
  examples: ['breakrocks subscription portal'],
});
export const sellerVerify = apiCommand({
  name: 'subscription seller-verify', summary: 'The page of the payment provider that verifies you as a seller, valid 5 minutes (verifySellerIdentity)', kind: 'mutation', op: 'verifySellerIdentity', descriptions: returnPath, text: paymentText,
  examples: ['breakrocks subscription seller-verify'],
});

type GiftCode = { code?: string; tier?: string; months?: number; status?: string; amount?: number; currency?: string; purchasedAt?: string; refundableUntil?: string | null; usedAt?: string | null; link?: string };
const giftLine = (g: GiftCode) => `${g.code ?? ''}  ${g.tier} ${g.months} month(s)  ${g.status ?? ''}  ${g.amount ?? ''} ${g.currency ?? ''}${g.refundableUntil ? `  refundable until ${g.refundableUntil}` : ''}`;
export const giftCodesOffer = apiCommand({
  name: 'gift-codes offer', summary: 'The gift codes offered in a currency: one per paid tier and number of months (giftCodeOffer)', kind: 'query', op: 'giftCodeOffer', descriptions: returnPath,
  text: listText((p: { tier?: string; months?: number; amount?: number; currency?: string }) => `${p.tier} ${p.months} month(s)  ${p.amount} ${p.currency}`), examples: ['breakrocks gift-codes offer --currency EUR'],
});
export const giftCodesList = apiCommand({ name: 'gift-codes list', summary: 'The gift codes the account bought (myGiftCodes)', kind: 'query', op: 'myGiftCodes', text: listText(giftLine), examples: ['breakrocks gift-codes list'] });
export const giftCodesBuy = apiCommand({
  name: 'gift-codes buy', summary: 'Buy a gift code of a paid tier for 1, 3 or 12 months: the address of the payment page; the code is made once paid (buyGiftCode)', kind: 'mutation', op: 'buyGiftCode', positionals: ['tier', 'months'], dry: true,
  descriptions: { ...returnPath, tier: 'X2 or X10', months: '1, 3 or 12' }, confirm: (i) => `Open a payment page for a gift code of ${String(i.tier)}, ${String(i.months)} month(s)?`, text: paymentText,
  examples: ['breakrocks gift-codes buy X2 3 --yes'],
});
export const giftCodesRedeem = apiCommand({
  name: 'gift-codes redeem', summary: 'Use a gift code: its tier for its months (redeemGiftCode)', kind: 'mutation', op: 'redeemGiftCode', positionals: ['code'], descriptions: { code: 'The gift code' },
  confirm: (i) => `Use the gift code ${String(i.code)} on this account?`, text: subscriptionText, examples: ['breakrocks gift-codes redeem ABCD-EFGH --yes'],
});
export const giftCodesRefund = apiCommand({
  name: 'gift-codes refund', summary: 'Ask the refund of an unused gift code within 14 days of its purchase (refundGiftCode)', kind: 'mutation', op: 'refundGiftCode', positionals: ['code'], descriptions: { code: 'The gift code' },
  confirm: (i) => `Refund the gift code ${String(i.code)}? It stops working.`, text: (r) => (r ? giftLine(r as GiftCode) : '(none)'), examples: ['breakrocks gift-codes refund ABCD-EFGH --yes'],
});

export const billingCommands = [
  subscriptionShow, subscriptionOffer, subscriptionStart, subscriptionRenewalOn, subscriptionRenewalOff, billingDayOffer, billingDaySet, subscriptionPortal, sellerVerify,
  giftCodesOffer, giftCodesList, giftCodesBuy, giftCodesRedeem, giftCodesRefund,
];
