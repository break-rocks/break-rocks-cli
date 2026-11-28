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
