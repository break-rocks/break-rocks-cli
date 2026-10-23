// Payments with x402 v2: the CLI signs the transfer
// authorization itself, with the wallet key of the profile (a file of the configuration folder,
// 0600, or BREAKROCKS_WALLET_KEY), through @x402/core and @x402/evm. A 402 is paid only within the
// cap of the command (--max-usd, 1 US dollar by default) and the cap of the profile per UTC day
// (wallet set --max-usd-per-day, 5 by default), after a confirmation (--yes); each signed payment is
// written in payments/<profile>.json (counted in the day's cap from its signature, a refusal of the
// platform excepted). The keys never leave the device but as signatures.
import { createPrivateKey } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { Context } from './context.js';
import type { Environment, Profile } from './config.js';
import { readJson, writePrivate } from './config.js';
import { cliRefusal, platformRefusal, usageError } from './errors.js';
import type { Hex, Payer, PaymentRequired } from './payment-types.js';
import { agentsPost, agentsRefusal, type HttpAnswer } from './transport.js';

export type { Accept, Hex, Payer, PaymentRequired } from './payment-types.js';

export const DEFAULT_MAX_USD = 1;
export const DEFAULT_MAX_USD_PER_DAY = 5;
export const USDC_DECIMALS = 6;

export type Network = { id: string; name: string; rpc: string; usdc: string; explorer: string; testnet: boolean };
export const NETWORKS: Record<string, Network> = {
  'eip155:8453': { id: 'eip155:8453', name: 'Base', rpc: 'https://mainnet.base.org', usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', explorer: 'https://basescan.org/tx/', testnet: false },
  'eip155:84532': { id: 'eip155:84532', name: 'Base Sepolia', rpc: 'https://sepolia.base.org', usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', explorer: 'https://sepolia.basescan.org/tx/', testnet: true },
};
/** The network of each environment. */
export const networkOf = (env: Environment): Network => NETWORKS[env === 'prod' ? 'eip155:8453' : 'eip155:84532'];

/** Where test USDC come from on Base Sepolia (links, no call). */
export const FAUCETS = [
  { name: 'Circle faucet (USDC, Base Sepolia)', url: 'https://faucet.circle.com' },
  { name: 'Coinbase Developer Platform faucet', url: 'https://portal.cdp.coinbase.com/products/faucet' },
];

// ---- The wallet key ----


/** A wallet key from its text: 64 hexadecimal digits (with or without 0x), or a secp256k1 private key in PEM. */
export function walletKeyFrom(text: string, label: string): Hex {
  const trimmed = text.trim();
  const hex = /^(0x)?([0-9a-fA-F]{64})$/.exec(trimmed);
  if (hex) return `0x${hex[2].toLowerCase()}`;
  if (trimmed.includes('-----BEGIN')) {
    try {
      const jwk = createPrivateKey(trimmed).export({ format: 'jwk' }) as { crv?: string; d?: string };
      if (jwk.crv === 'secp256k1' && jwk.d) return `0x${Buffer.from(jwk.d, 'base64url').toString('hex').padStart(64, '0')}`;
    } catch { /* below */ }
  }
  throw usageError('WALLET_KEY_INVALID', `${label} is not an EVM private key (64 hexadecimal digits, or a secp256k1 key in PEM)`);
}

/** The wallet key of [profile] (WALLET_MISSING without one). */
export function walletKey(ctx: Context, profile: Profile): Hex {
  const wallet = profile.wallet;
  if (!wallet) throw cliRefusal('WALLET_MISSING', `The profile "${ctx.profileName}" has no wallet: breakrocks wallet set --key <file>, or --env with BREAKROCKS_WALLET_KEY`);
  if (wallet.source === 'env') {
    const value = ctx.env.BREAKROCKS_WALLET_KEY;
    if (!value) throw cliRefusal('WALLET_MISSING', 'BREAKROCKS_WALLET_KEY is not set');
    return walletKeyFrom(value, 'BREAKROCKS_WALLET_KEY');
  }
  if (!wallet.file || !existsSync(wallet.file)) throw cliRefusal('WALLET_MISSING', `The wallet key file of the profile "${ctx.profileName}" is missing`);
  return walletKeyFrom(readFileSync(wallet.file, 'utf8'), 'The wallet key file');
}

/** The address of a wallet key (viem). */
export async function addressOf(key: Hex): Promise<string> {
  const { privateKeyToAccount } = await import('viem/accounts');
  return privateKeyToAccount(key).address;
}

/** The USDC balance of [address] on [network], in atomic units (BREAKROCKS_RPC_URL replaces the public RPC). */
export async function usdcBalance(ctx: Context, network: Network, address: string): Promise<bigint> {
  const { createPublicClient, erc20Abi, http } = await import('viem');
  const client = createPublicClient({ transport: http(ctx.env.BREAKROCKS_RPC_URL ?? network.rpc) });
  return client.readContract({ address: network.usdc as Hex, abi: erc20Abi, functionName: 'balanceOf', args: [address as Hex] });
}

/** 10000n → "0.01" (USDC, the cents kept). */
export function formatUsdc(atomic: bigint): string {
  const unit = 10n ** BigInt(USDC_DECIMALS);
  const fraction = (atomic % unit).toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${atomic / unit}.${fraction}`;
}
/** 0.01 → 10000n. */
export const usdToAtomic = (usd: number) => BigInt(Math.round(usd * 10 ** USDC_DECIMALS));

// ---- The ledger of the payments ----

export type PaymentRecord = { at: string; usd: string; atomic: string; network: string; payTo: string; what: string; status: 'signed' | 'settled' | 'refused'; transaction?: string };

export const readLedger = (ctx: Context): PaymentRecord[] => readJson<PaymentRecord[]>(ctx.store.paymentsFile(ctx.profileName)) ?? [];
const writeLedger = (ctx: Context, records: PaymentRecord[]) => writePrivate(ctx.store.paymentsFile(ctx.profileName), `${JSON.stringify(records.slice(-1000), null, 2)}\n`);

/** What the profile signed today (UTC), in atomic units: every payment signed, those the platform refused apart. */
export function spentToday(ctx: Context): bigint {
  const day = new Date(ctx.now()).toISOString().slice(0, 10);
  return readLedger(ctx).filter((r) => r.at.slice(0, 10) === day && r.status !== 'refused').reduce((n, r) => n + BigInt(r.atomic), 0n);
}

// ---- Paying a 402 ----

/** The payer of @x402/core and @x402/evm (the exact scheme, EIP-3009), capped at [maxAtomic] by its spend controls. */
export const x402Payer: Payer = async ({ key, required, accept, maxAtomic }) => {
  const [{ x402Client }, { x402HTTPClient }, { ExactEvmScheme }, { toClientEvmSigner }, { privateKeyToAccount }] = await Promise.all([
    import('@x402/core/client'), import('@x402/core/http'), import('@x402/evm/exact/client'), import('@x402/evm'), import('viem/accounts'),
  ]);
  const client = new x402HTTPClient(x402Client.fromConfig({
    schemes: [{ network: 'eip155:*', client: new ExactEvmScheme(toClientEvmSigner(privateKeyToAccount(key))) }],
    spendControls: { maxAmountPerPayment: `$${formatUsdc(maxAtomic)}` },
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = await client.createPaymentPayload({ ...required, accepts: [accept] } as any);
  return client.encodePaymentSignatureHeader(payload);
};

function headerJson(headers: Headers, name: string): Record<string, unknown> | undefined {
  const value = headers.get(name);
  if (!value) return undefined;
  try { return JSON.parse(Buffer.from(value, 'base64').toString('utf8')); } catch { return undefined; }
}

/** The payment requirements of a 402: the PAYMENT-REQUIRED header (base64 JSON), else its body. */
export function requirementsOf(answer: HttpAnswer): PaymentRequired {
  const fromHeader = headerJson(answer.headers, 'payment-required') as PaymentRequired | undefined;
  const required = fromHeader ?? (answer.json as unknown as PaymentRequired);
  if (!required || !Array.isArray(required.accepts) || !required.accepts.length) throw platformRefusal('PAYMENT_REQUIREMENTS_INVALID', 'The 402 answer carries no payment requirements');
  return required;
}

export type Payment = { usd: string; network: string; networkName: string; payTo: string; transaction?: string; explorer?: string; payer?: string; success: boolean };

/**
 * A POST to the agents host that may ask to pay (402): paid with the wallet of the profile within
 * [maxUsd] and the cap of the day, after a confirmation naming [what] and the amount; the same
 * request sent again with PAYMENT-SIGNATURE. The answer, and the payment made (from PAYMENT-RESPONSE).
 */
export async function paidPost(ctx: Context, options: { base: string; path: string; body: unknown; headers?: Record<string, string>; maxUsd?: number; what: string }): Promise<{ answer: HttpAnswer; payment?: Payment }> {
  const first = await agentsPost(ctx, options.base, options.path, options.body, options.headers);
  if (first.status !== 402) return { answer: first };
  if ((first.json.error as { code?: string } | undefined)?.code) throw agentsRefusal(first);
  const profile = ctx.profile();
  const network = networkOf(profile.env);
  const required = requirementsOf(first);
  const accept = required.accepts.find((a) => a.network === network.id && a.asset.toLowerCase() === network.usdc.toLowerCase());
  if (!accept) {
    throw cliRefusal('PAYMENT_ASSET_UNKNOWN', `The platform asks to pay in an asset the CLI does not pay (it pays USDC on ${network.name})`, { accepts: required.accepts.map((a) => ({ network: a.network, asset: a.asset })) });
  }
  const atomic = BigInt(accept.amount);
  const usd = formatUsdc(atomic);
  const maxUsd = options.maxUsd ?? DEFAULT_MAX_USD;
  const maxAtomic = usdToAtomic(maxUsd);
  if (atomic > maxAtomic) throw cliRefusal('PAYMENT_CAP_EXCEEDED', `${usd} USDC is due, beyond the cap of the command (${maxUsd} US dollars): pass --max-usd`, { due: usd, maxUsd });
  const perDay = profile.wallet?.maxUsdPerDay ?? DEFAULT_MAX_USD_PER_DAY;
  const spent = spentToday(ctx);
  if (spent + atomic > usdToAtomic(perDay)) {
    throw cliRefusal('PAYMENT_DAILY_CAP_EXCEEDED', `${usd} USDC is due; ${formatUsdc(spent)} already signed today, the cap of the profile is ${perDay} US dollars a day (wallet set --max-usd-per-day)`, { due: usd, spentToday: formatUsdc(spent), maxUsdPerDay: perDay });
  }
  const key = walletKey(ctx, profile);
  await ctx.confirm(`Pay ${usd} USDC on ${network.name} to ${accept.payTo} for ${options.what}?`, { due: usd, network: network.id });
  const headers = await (ctx.io.payer ?? x402Payer)({ key, required, accept, maxAtomic });
  const record: PaymentRecord = { at: new Date(ctx.now()).toISOString(), usd, atomic: atomic.toString(), network: network.id, payTo: accept.payTo, what: options.what, status: 'signed' };
  writeLedger(ctx, [...readLedger(ctx), record]);
  ctx.progress(`Paying ${usd} USDC on ${network.name}…`);
  const answer = await agentsPost(ctx, options.base, options.path, options.body, { ...options.headers, ...headers });
  const settlement = headerJson(answer.headers, 'payment-response') as { success?: boolean; transaction?: string; payer?: string; network?: string } | undefined;
  const ok = answer.status >= 200 && answer.status < 300;
  const ledger = readLedger(ctx);
  const mine = ledger.findLast((r) => r.at === record.at && r.what === record.what);
  if (mine) { mine.status = ok ? 'settled' : 'refused'; if (settlement?.transaction) mine.transaction = settlement.transaction; writeLedger(ctx, ledger); }
  if (!ok) throw agentsRefusal(answer);
  return {
    answer,
    payment: {
      usd, network: network.id, networkName: network.name, payTo: accept.payTo, success: settlement?.success ?? true,
      ...(settlement?.transaction ? { transaction: settlement.transaction, explorer: `${network.explorer}${settlement.transaction}` } : {}),
      ...(settlement?.payer ? { payer: settlement.payer } : {}),
    },
  };
}
