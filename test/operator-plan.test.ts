// The plan of delegated agents paid by card: operator plan offer|show|start|change|stop|resume against the fake platform
// (native-sulfur); the payment page opened by a fake browser, the prices read from the API.
import { describe, expect, it } from 'vitest';
import { operatorOnPlatform } from './fake-platform.js';
import { last } from './helpers.js';

const code = (h: { values: unknown[] }) => last<{ error?: { code: string; source?: string } }>(h).error;

/** An agent operator on the fake platform, its browser a fake. */
async function x402Operator() {
  const { h, platform } = await operatorOnPlatform();
  const opened: string[] = [];
  h.io.openUrl = async (url) => { opened.push(url); return true; };
  return { h, platform, opened };
}

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
