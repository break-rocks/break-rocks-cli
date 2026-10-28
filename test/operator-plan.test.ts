// The plan of delegated agents paid by card: at the registration (operator
// register --plan, the CLI waiting for the payment), then operator plan offer|show|start|change|stop|resume
// against the fake platform; the payment page opened by a fake browser, the prices read from the API.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fakePayer, onPlatform } from './fake-platform.js';
import { last } from './helpers.js';

const code = (h: { values: unknown[] }) => last<{ error?: { code: string; source?: string } }>(h).error;

async function withKeys() {
  const { h, platform } = await onPlatform({ payer: fakePayer });
  const opened: string[] = [];
  h.io.openUrl = async (url) => { opened.push(url); return true; };
  expect(await h.run('profile', 'add', 'atlas', '--env', 'dev', '--use', '--json')).toBe(0);
  expect(await h.run('operator', 'keygen', '--recovery-algorithm', 'Ed25519', '--json')).toBe(0);
  return { h, platform, opened };
}

/** An agent operator registered with x402 (a period paid with x402 in progress). */
async function x402Operator() {
  const r = await withKeys();
  const wallet = join(r.h.dir, 'wallet.key');
  writeFileSync(wallet, `0x${'11'.repeat(32)}\n`);
  expect(await r.h.run('wallet', 'set', '--key', wallet, '--json')).toBe(0);
  expect(await r.h.run('operator', 'register', '--country', 'FR', '--full-age', '--yes', '--json')).toBe(0);
  return r;
}

describe('a plan paid by card at the registration', () => {
  it('opens the payment page in the browser, waits for the payment, then signs in', async () => {
    const { h, platform, opened } = await withKeys();
    const sleep = h.io.sleep;
    h.io.sleep = async (ms) => { await sleep(ms); if (opened.length && !platform.plans.size) platform.payCheckout(opened[0]); };
    expect(await h.run('operator', 'register', '--country', 'FR', '--full-age', '--plan', '10', '--json')).toBe(0);
    const r = last<Record<string, unknown>>(h);
    expect(platform.calls.find((c) => c.url.endsWith('/plan'))!.body).toEqual({ delegatedAgents: 10, interval: 'MONTH' });
    expect(opened).toEqual([expect.stringMatching(/^https:\/\/checkout\.test\//)]);
    expect(r).toMatchObject({ operatorId: expect.stringMatching(/^eu-/), handle: expect.stringMatching(/^user-/), delegatedAgentAllowance: 10, checkout: { opened: true }, plan: { delegatedAgents: 10, provider: 'stripe' } });
    expect(platform.calls.some((c) => c.url.endsWith('/payment'))).toBe(false);
    expect(h.slept).toContain(5000);
    expect(h.all()).not.toContain('PRIVATE KEY');
    expect(JSON.stringify(r)).not.toContain('tok-');
    expect(await h.run('profile', 'show', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ kind: 'operator', operatorId: r.operatorId });
  });

  it('returns at once with --no-wait --no-open, and a second register finishes once paid', async () => {
    const { h, platform, opened } = await withKeys();
    expect(await h.run('operator', 'register', '--country', 'FR', '--full-age', '--plan', '100', '--interval', 'YEAR', '--currency', 'usd', '--no-wait', '--no-open', '--json')).toBe(0);
    const r = last<{ operatorId: string; pending: boolean; checkout: { url: string; opened: boolean }; next: string }>(h);
    expect(r).toMatchObject({ pending: true, checkout: { opened: false }, next: expect.stringContaining('--plan 100') });
    expect(opened).toEqual([]);
    expect(h.errors.join('\n')).toContain(r.checkout.url);
    expect(platform.calls.find((c) => c.url.endsWith('/plan'))!.body).toEqual({ delegatedAgents: 100, interval: 'YEAR', currency: 'USD' });
    platform.payCheckout(r.checkout.url);
    expect(await h.run('operator', 'register', '--country', 'FR', '--full-age', '--plan', '100', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ operatorId: r.operatorId, alreadyPaid: true });
  });

  it('refuses --plan with the options of x402, and says the plans not offered', async () => {
    const { h } = await withKeys();
    expect(await h.run('operator', 'register', '--country', 'FR', '--full-age', '--plan', '10', '--months', '2', '--json')).toBe(2);
    expect(code(h)?.code).toBe('INVALID_INPUT');
    expect(await h.run('operator', 'register', '--country', 'FR', '--full-age', '--interval', 'YEAR', '--json')).toBe(2);
    expect(await h.run('operator', 'register', '--country', 'FR', '--full-age', '--plan', '50', '--json')).toBe(1);
    expect(code(h)).toMatchObject({ code: 'PLAN_NOT_OFFERED', source: 'platform' });
  });
});

describe('the plan of an agent operator', () => {
  it('reads the offer from the API', async () => {
    const { h } = await x402Operator();
    expect(await h.run('operator', 'plan', 'offer', '--interval', 'YEAR', '--json')).toBe(0);
    expect(last<{ prices: { interval: string }[] }>(h).prices.map((p) => p.interval)).toEqual(['YEAR', 'YEAR', 'YEAR']);
    expect(await h.run('operator', 'plan', 'offer')).toBe(0);
    expect(h.lines.join('\n')).toMatch(/10 delegated agents\s+40\.00 USD a month/);
    expect(h.lines.join('\n')).toMatch(/1000 delegated agents\s+30000\.00 USD a year/);
  });

  it('starts a plan: the price and the x402 period without refund said, the payment page opened', async () => {
    const { h, platform, opened } = await x402Operator();
    expect(await h.run('operator', 'plan', 'show', '--json')).toBe(0);
    expect(last(h)).toBeNull();
    expect(await h.run('operator', 'plan', 'start', '10', '--json')).toBe(0);
    const r = last<{ url: string; opened: boolean; x402PaidUntil: string; price: { amount: number } }>(h);
    expect(r).toMatchObject({ opened: true, delegatedAgents: 10, interval: 'MONTH', price: { amount: 4000, currency: 'USD' }, x402PaidUntil: expect.any(String) });
    expect(opened).toEqual([r.url]);
    const said = h.errors.join('\n');
    expect(said).toContain('40.00 USD a month');
    expect(said).toContain('not refunded');
    platform.payCheckout(r.url);
    expect(await h.run('operator', 'plan', 'show')).toBe(0);
    expect(h.lines.join('\n')).toContain('Plan of 10 delegated agents, paid monthly by stripe (ACTIVE)');
    expect(await h.run('operator', 'plan', 'start', '100', '--no-open', '--json')).toBe(1);
    expect(code(h)?.code).toBe('SUBSCRIPTION_EXISTS');
  });

  it('upgrades at once and reduces at the end of the paid period, after a confirmation; stops and resumes', async () => {
    const { h, platform } = await x402Operator();
    expect(await h.run('operator', 'plan', 'change', '100', '--json')).toBe(1);
    expect(code(h)?.code).toBe('SUBSCRIPTION_NOT_FOUND');
    expect(await h.run('operator', 'plan', 'start', '10', '--no-open', '--json')).toBe(0);
    platform.payCheckout(last<{ url: string }>(h).url);
    expect(await h.run('operator', 'plan', 'change', '100', '--json')).toBe(2);
    expect(code(h)).toMatchObject({ code: 'CONFIRMATION_REQUIRED', question: expect.stringContaining('at once') });
    expect(await h.run('operator', 'plan', 'change', '100', '--yes', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ delegatedAgents: 100, nextDelegatedAgents: null });
    expect(await h.run('operator', 'plan', 'change', '10', '--json')).toBe(2);
    expect(code(h)).toMatchObject({ question: expect.stringContaining('the inactive ones first, then the oldest') });
    expect(await h.run('operator', 'plan', 'change', '10', '--yes', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ delegatedAgents: 100, nextDelegatedAgents: 10 });
    expect(await h.run('operator', 'plan', 'stop', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ automaticRenewal: false });
    expect(await h.run('operator', 'plan', 'resume', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ automaticRenewal: true });
    expect(platform.calls.filter((c) => JSON.stringify(c.body ?? '').includes('setOperatorPlanRenewal')).map((c) => (c.body as { variables: { enabled: boolean } }).variables.enabled)).toEqual([false, true]);
  });

  it('is the operator\'s own: a delegated agent is refused before any call', async () => {
    const { h } = await x402Operator();
    expect(await h.run('agents', 'create', 'herald', '--save-profile', 'herald', '--json')).toBe(0);
    expect(await h.run('--profile', 'herald', 'operator', 'plan', 'show', '--json')).toBe(1);
    expect(code(h)?.code).toBe('DELEGATED_AGENT_CANNOT_MANAGE_AGENTS');
  });
});
