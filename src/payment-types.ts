// The types of an x402 payment that the CLI shares without loading the x402 libraries: what a 402 asks
// (x402 v2), and the payer that signs it (src/x402.ts; a fake in the tests).

export type Hex = `0x${string}`;
/** One way to pay of a 402 (x402 v2 `accepts`). */
export type Accept = { scheme: string; network: string; amount: string; asset: string; payTo: string; maxTimeoutSeconds?: number; extra?: Record<string, unknown> };
export type PaymentRequired = { x402Version: number; accepts: Accept[]; resource?: unknown; error?: string; extensions?: unknown };
/** Signs [accept] of [required] with the wallet key, within [maxAtomic]: the headers of the paid request (PAYMENT-SIGNATURE). */
export type Payer = (input: { key: Hex; required: PaymentRequired; accept: Accept; maxAtomic: bigint }) => Promise<Record<string, string>>;
