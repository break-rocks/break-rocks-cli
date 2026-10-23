// wallet set|show|balance|faucet: the EVM key that signs the x402 payments of the
// profile, kept in the configuration folder (0600) or read from BREAKROCKS_WALLET_KEY; its address,
// its USDC balance on the network of the environment, the cap of the day.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { writePrivate } from '../config.js';
import { cliRefusal, usageError } from '../errors.js';
import type { Command } from '../registry.js';
import { bool, list, num, object, openObject, str } from '../schema.js';
import { DEFAULT_MAX_USD_PER_DAY, FAUCETS, addressOf, formatUsdc, networkOf, spentToday, usdcBalance, walletKey, walletKeyFrom } from '../x402.js';

const walletSchema = openObject({ profile: str('The profile'), address: str('The address of the wallet'), source: str('file or env'), network: str('CAIP-2 network of the environment'), networkName: str('Its name'), maxUsdPerDay: num('Cap per UTC day, in US dollars'), spentToday: str('Signed today, in USDC') });
type WalletView = { profile: string; address: string; source: 'file' | 'env'; network: string; networkName: string; maxUsdPerDay: number; spentToday: string; file?: string };

export const walletSet: Command<{ key?: string; fromEnv?: boolean; maxUsdPerDay?: number }, WalletView> = {
  name: 'wallet set', summary: 'Set the x402 wallet of the profile (a key file, or --env) and its cap per day',
  description: 'The key (64 hexadecimal digits, or a secp256k1 key in PEM) is copied in the configuration folder (0600) and never printed; --env reads it from BREAKROCKS_WALLET_KEY at each payment instead. --max-usd-per-day caps what the profile signs per UTC day (default 5).',
  examples: ['breakrocks wallet set --key wallet.pem --max-usd-per-day 2', 'BREAKROCKS_WALLET_KEY=0x… breakrocks wallet set --env', 'breakrocks wallet set --max-usd-per-day 10'],
  input: object({ key: str('The file of the wallet key'), fromEnv: bool('Read the key from BREAKROCKS_WALLET_KEY (flag: --env)'), maxUsdPerDay: num('Cap per UTC day, in US dollars', { minimum: 0, maximum: 10000 }) }),
  output: walletSchema, args: { aliases: { env: 'fromEnv' } }, offline: true,
  run: async (ctx, { key, fromEnv, maxUsdPerDay }) => {
    const profile = ctx.profile();
    if (key && fromEnv) throw usageError('INVALID_INPUT', '--key and --env are exclusive');
    let wallet = profile.wallet;
    if (key) {
      const path = resolve(ctx.io.cwd, key);
      if (!existsSync(path)) throw usageError('FILE_NOT_FOUND', `No file ${key}`, { path: key });
      const hex = walletKeyFrom(readFileSync(path, 'utf8'), key);
      const file = join(ctx.store.keysDir(ctx.profileName), 'wallet.key');
      writePrivate(file, `${hex}\n`);
      wallet = { source: 'file', file, address: await addressOf(hex), maxUsdPerDay: maxUsdPerDay ?? wallet?.maxUsdPerDay ?? DEFAULT_MAX_USD_PER_DAY };
    } else if (fromEnv) {
      const value = ctx.env.BREAKROCKS_WALLET_KEY;
      if (!value) throw usageError('WALLET_MISSING', 'BREAKROCKS_WALLET_KEY is not set');
      wallet = { source: 'env', address: await addressOf(walletKeyFrom(value, 'BREAKROCKS_WALLET_KEY')), maxUsdPerDay: maxUsdPerDay ?? wallet?.maxUsdPerDay ?? DEFAULT_MAX_USD_PER_DAY };
    } else if (maxUsdPerDay !== undefined) {
      if (!wallet) throw cliRefusal('WALLET_MISSING', 'Set the wallet first: --key <file> or --env');
      wallet = { ...wallet, maxUsdPerDay };
    } else throw usageError('INVALID_INPUT', 'Give --key <file>, --env or --max-usd-per-day');
    ctx.saveProfile({ ...profile, wallet });
    const network = networkOf(profile.env);
    return { profile: ctx.profileName, address: wallet.address, source: wallet.source, network: network.id, networkName: network.name, maxUsdPerDay: wallet.maxUsdPerDay, spentToday: formatUsdc(spentToday(ctx)), ...(wallet.file ? { file: wallet.file } : {}) };
  },
  quiet: (r) => r.address,
};

export const walletShow: Command<Record<string, never>, WalletView> = {
  name: 'wallet show', summary: 'Show the wallet of the profile: its address, its cap, what it signed today',
  examples: ['breakrocks wallet show', 'breakrocks wallet show --json'],
  input: object({}), output: walletSchema, offline: true,
  run: (ctx) => {
    const profile = ctx.profile();
    if (!profile.wallet) throw cliRefusal('WALLET_MISSING', `The profile "${ctx.profileName}" has no wallet: breakrocks wallet set --key <file>`);
    const network = networkOf(profile.env);
    return { profile: ctx.profileName, address: profile.wallet.address, source: profile.wallet.source, network: network.id, networkName: network.name, maxUsdPerDay: profile.wallet.maxUsdPerDay, spentToday: formatUsdc(spentToday(ctx)) };
  },
  quiet: (r) => r.address,
};

export const walletBalance: Command<Record<string, never>, { address: string; network: string; networkName: string; usdc: string; testnet: boolean }> = {
  name: 'wallet balance', summary: 'The USDC balance of the wallet on the network of the environment',
  description: 'Base Sepolia (test USDC) in dev and staging, Base in production; read on the public RPC of the network (BREAKROCKS_RPC_URL replaces it).',
  examples: ['breakrocks wallet balance', 'breakrocks --profile atlas-dev wallet balance --json'],
  input: object({}), output: openObject({ address: str('The wallet'), network: str('CAIP-2 network'), networkName: str('Its name'), usdc: str('The balance in USDC'), testnet: bool('Test USDC, without value') }),
  run: async (ctx) => {
    const profile = ctx.profile();
    const address = profile.wallet?.address ?? await addressOf(walletKey(ctx, profile));
    const network = networkOf(profile.env);
    return { address, network: network.id, networkName: network.name, usdc: formatUsdc(await usdcBalance(ctx, network, address)), testnet: network.testnet };
  },
  quiet: (r) => r.usdc,
};

export const walletFaucet: Command<Record<string, never>, { network: string; networkName: string; address?: string; faucets: { name: string; url: string }[]; note: string }> = {
  name: 'wallet faucet', summary: 'Where to get test USDC on Base Sepolia (dev and staging; links, no call)',
  examples: ['breakrocks --env dev wallet faucet'],
  input: object({}), output: openObject({ network: str('CAIP-2 network'), networkName: str('Its name'), address: str('The wallet to fund'), faucets: list('Faucets', openObject({ name: str('Name'), url: str('Address') })), note: str('How') }), offline: true,
  run: (ctx) => {
    const profile = ctx.profile();
    if (profile.env === 'prod') throw cliRefusal('FAUCET_NOT_IN_PRODUCTION', 'In production the payments are real USDC on Base: no faucet');
    const network = networkOf(profile.env);
    return { network: network.id, networkName: network.name, ...(profile.wallet ? { address: profile.wallet.address } : {}), faucets: FAUCETS, note: `Ask for USDC on ${network.name} for the address of the wallet; test USDC have no value. Outside production, a delegated agent costs 0.01 US dollar a month.` };
  },
  text: (r) => [`Test USDC on ${r.networkName}${r.address ? ` for ${r.address}` : ''}:`, ...r.faucets.map((f) => `  ${f.name}: ${f.url}`), r.note].join('\n'),
};
