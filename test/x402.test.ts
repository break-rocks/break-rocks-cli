// The payer of @x402/core and @x402/evm, offline: it signs the authorization of a 402 locally (no
// RPC), within its cap.
import { describe, expect, it } from 'vitest';
import { x402Payer, formatUsdc, usdToAtomic, type PaymentRequired } from '../src/x402.js';
import { USDC_SEPOLIA } from './fake-platform.js';

const required: PaymentRequired = {
  x402Version: 2,
  resource: { url: 'https://agents.test/v1/operators/registrations/x/payment', description: 'plan', mimeType: 'application/json' },
  accepts: [{ scheme: 'exact', network: 'eip155:84532', amount: '10000', asset: USDC_SEPOLIA, payTo: '0x00000000000000000000000000000000000000aa', maxTimeoutSeconds: 300, extra: { name: 'USDC', version: '2' } }],
};

describe('x402', () => {
  it('signs a PAYMENT-SIGNATURE of x402 v2 for the accepted requirement, offline', async () => {
    const headers = await x402Payer({ key: `0x${'11'.repeat(32)}`, required, accept: required.accepts[0], maxAtomic: usdToAtomic(1) });
    const name = Object.keys(headers).find((h) => h.toLowerCase() === 'payment-signature')!;
    const payload = JSON.parse(Buffer.from(headers[name], 'base64').toString('utf8'));
    expect(payload.x402Version).toBe(2);
    expect(payload.accepted).toMatchObject({ network: 'eip155:84532', amount: '10000', payTo: required.accepts[0].payTo });
    expect(payload.payload.signature).toMatch(/^0x[0-9a-f]+$/);
  });
  it('refuses to sign beyond its cap', async () => {
    await expect(x402Payer({ key: `0x${'11'.repeat(32)}`, required, accept: required.accepts[0], maxAtomic: 5000n })).rejects.toThrow();
  });
  it('counts USDC in atomic units of 6 decimals', () => {
    expect(formatUsdc(10000n)).toBe('0.01');
    expect(formatUsdc(1_500_000n)).toBe('1.50');
    expect(usdToAtomic(0.01)).toBe(10000n);
  });
});

describe('the extra usage of a delegated agent beyond its quota (delegated-agents.feature)', () => {
  const conditions = { limit: 'QUOTA', retryAt: '2026-11-09T00:00:00.000Z', x402Version: 2, accepts: required.accepts, price: '0.01', weight: 1, units: 416, resource: 'graphql:setLike' };
  async function agent(wallet: { extraUsage?: boolean } | null) {
    const calls: { headers: Record<string, string>; body: { query: string } }[] = [];
    const { harness } = await import('./helpers.js');
    const h = harness({
      env: { BREAKROCKS_API_URL: 'https://api.test/graphql', BREAKROCKS_AGENTS_URL: 'https://agents.test/v1', BREAKROCKS_WALLET_KEY: `0x${'11'.repeat(32)}` },
      payer: async () => ({ 'PAYMENT-SIGNATURE': 'signed' }),
      fetch: async (_url, init) => {
        const headers = init!.headers as Record<string, string>;
        calls.push({ headers, body: JSON.parse(String(init!.body)) });
        if (!headers['PAYMENT-SIGNATURE']) return Response.json({ data: { setLike: null }, errors: [{ errorType: 'PAYMENT_REQUIRED', message: 'Beyond the quota', errorInfo: conditions }] });
        return Response.json({ data: { setLike: { id: 'p1' } } }, { headers: { 'payment-response': Buffer.from(JSON.stringify({ success: true, transaction: '0xfeed' })).toString('base64') } });
      },
    });
    const { Context, NO_FLAGS } = await import('../src/context.js');
    const { saveSession } = await import('../src/session.js');
    const ctx = new Context(h.io, { ...NO_FLAGS, env: 'dev' });
    ctx.saveProfile({ env: 'dev', kind: 'agent', operatorId: 'eu-op', agentId: 'ag', ...(wallet ? { wallet: { source: 'env', address: '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A', maxUsdPerDay: 5, ...wallet } } : {}) });
    saveSession(ctx, { kind: 'agent', token: 't', sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z', operatorId: 'eu-op', agentId: 'ag' });
    return { h, calls };
  }
  it('pays it with x402 and sends the request again with PAYMENT-SIGNATURE, without asking when the profile allows it', async () => {
    const { h, calls } = await agent({ extraUsage: true });
    expect(await h.run('like', 'p1', '--json')).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[1].headers['PAYMENT-SIGNATURE']).toBe('signed');
    expect(calls[1].body.query).toBe(calls[0].body.query);
  });
  it('asks a confirmation otherwise (--yes pays), and is refused PAYMENT_REQUIRED without a wallet', async () => {
    const asked = await agent({});
    expect(await asked.h.run('like', 'p1', '--json')).toBe(2);
    expect(asked.calls).toHaveLength(1);
    expect(await asked.h.run('like', 'p1', '--yes', '--json')).toBe(0);
    const none = await agent(null);
    expect(await none.h.run('like', 'p1', '--json')).toBe(1);
    expect(none.calls).toHaveLength(1);
    expect((none.h.values.at(-1) as { error: { code: string } }).error.code).toBe('PAYMENT_REQUIRED');
  });
});

describe('agents tier', () => {
  it('buys the paid tier X10 of a delegated agent with x402, after a confirmation', async () => {
    const posts: { url: string; headers: Record<string, string>; body: unknown }[] = [];
    const { harness } = await import('./helpers.js');
    const h = harness({
      env: { BREAKROCKS_API_URL: 'https://api.test/graphql', BREAKROCKS_AGENTS_URL: 'https://agents.test/v1', BREAKROCKS_WALLET_KEY: `0x${'11'.repeat(32)}` },
      payer: async () => ({ 'PAYMENT-SIGNATURE': 'signed' }),
      fetch: async (url, init) => {
        if (String(url) === 'https://api.test/graphql') return Response.json({ data: { delegatedAgents: [{ id: 'ag-1', name: 'herald', status: 'active', interactions: null, universes: null, createdAt: 'x', credentialsUpdatedAt: 'x', suspendedAt: null, deactivatedAt: null }] } });
        const headers = init!.headers as Record<string, string>;
        posts.push({ url: String(url), headers, body: JSON.parse(String(init!.body)) });
        if (!headers['PAYMENT-SIGNATURE']) return Response.json({}, { status: 402, headers: { 'payment-required': Buffer.from(JSON.stringify(required)).toString('base64') } });
        return Response.json({ agentId: 'ag-1', tier: 'X10', paidUntil: '2026-12-08T00:00:00.000Z', next: null }, { headers: { 'payment-response': Buffer.from(JSON.stringify({ success: true, transaction: '0xfeed' })).toString('base64') } });
      },
    });
    const { Context, NO_FLAGS } = await import('../src/context.js');
    const { saveSession } = await import('../src/session.js');
    const ctx = new Context(h.io, { ...NO_FLAGS, env: 'dev' });
    ctx.saveProfile({ env: 'dev', kind: 'operator', operatorId: 'eu-op', wallet: { source: 'env', address: '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A', maxUsdPerDay: 5 } });
    saveSession(ctx, { kind: 'operator', token: 'tok', sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z', operatorId: 'eu-op' });
    expect(await h.run('agents', 'tier', 'herald', '--tier', 'X10', '--json')).toBe(2);
    expect(await h.run('agents', 'tier', 'herald', '--tier', 'X10', '--months', '1', '--yes', '--json')).toBe(0);
    const paid = posts.at(-1)!;
    expect(paid.url).toBe('https://agents.test/v1/operators/delegated-agents/ag-1/tier');
    expect(paid.body).toEqual({ tier: 'X10', months: 1 });
    expect(paid.headers.authorization).toBe('Bearer tok');
    const { last } = await import('./helpers.js');
    expect(last(h)).toMatchObject({ agentId: 'ag-1', tier: 'X10', payment: { usd: '0.01', transaction: '0xfeed' } });
  });
});
