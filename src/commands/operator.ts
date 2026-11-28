// operator keygen, and register|renew|recover|recovery-key set|delete: kept, NOT_AVAILABLE until ported to native-sulfur's
// REST routes (operator login: src/sulfur/commands.ts).
// The private keys stay in the
// configuration folder (0600); only public keys, signatures and payments leave the device.
import { existsSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Algorithm } from '../config.js';
import { writePrivate } from '../config.js';
import { cliRefusal, commandNotAvailable, usageError } from '../errors.js';
import { ALGORITHMS, fingerprint, generateKeys, supports } from '../keys.js';
import type { Command } from '../registry.js';
import { bool, int, num, object, openObject, str } from '../schema.js';
import type { Payment } from '../x402.js';
import { planText, type OperatorPlan } from './operator-plan.js';

const algorithmSchema = (description: string) => str(description, { enum: ALGORITHMS });
const paymentSchema = openObject({ usd: str('Amount paid, in USDC'), network: str('CAIP-2 network'), networkName: str('Network'), payTo: str('Recipient'), transaction: str('Transaction hash'), explorer: str('Link to the transaction') });
const sessionSchema = openObject({ sessionId: str('The session'), expiresAt: str('When it ends (1 hour)'), recoveryKeyRequired: bool('A new recovery key must be declared first') });

/** The default algorithm of a recovery key: ML-DSA-65 where Node has it (it lives long), else Ed25519. */
export const defaultRecoveryAlgorithm = (): Algorithm => (supports('ML-DSA-65') ? 'ML-DSA-65' : 'Ed25519');

function backup(path: string, now: number) {
  if (existsSync(path)) renameSync(path, `${path}.${new Date(now).toISOString().replace(/[:.]/g, '-')}.old`);
}

type PublicSession = { sessionId: string; expiresAt: string; recoveryKeyRequired?: boolean };

type KeygenResult = { profile: string; algorithm: Algorithm; fingerprint: string; publicKey: string; recoveryAlgorithm: Algorithm; recoveryFingerprint: string; files: { operator: string; recovery: string } };

export const operatorKeygen: Command<{ algorithm?: Algorithm; recoveryAlgorithm?: Algorithm; recoveryOut?: string; force?: boolean }, KeygenResult> = {
  name: 'operator keygen', summary: 'Make the keys of an agent operator: its private key and its recovery key',
  description: 'Both private keys are written in the configuration folder (0600), never printed; --recovery-out writes the recovery key elsewhere (keep it apart: it recovers the account when the private key is lost). ML-DSA-65 needs a Node that has it in node:crypto; the CLI says so otherwise.',
  examples: ['breakrocks operator keygen', 'breakrocks operator keygen --algorithm ML-DSA-65 --recovery-out ~/safe/atlas-recovery.pem'],
  input: object({
    algorithm: algorithmSchema('The algorithm of the private key (default Ed25519)'), recoveryAlgorithm: algorithmSchema('The algorithm of the recovery key (default ML-DSA-65 where Node has it, else Ed25519)'),
    recoveryOut: str('Where to write the recovery key (default: the configuration folder)'), force: bool('Replace keys made before, for a profile without an account'),
  }),
  output: openObject({ profile: str('The profile'), algorithm: str('Algorithm'), fingerprint: str('Fingerprint of the public key'), publicKey: str('The public key (SPKI PEM)'), recoveryAlgorithm: str('Algorithm of the recovery key'), recoveryFingerprint: str('Its fingerprint'), files: openObject({ operator: str('Private key file'), recovery: str('Recovery key file') }) }),
  offline: true,
  run: (ctx, { algorithm = 'Ed25519', recoveryAlgorithm, recoveryOut, force }) => {
    const profile = ctx.profile();
    if (profile.kind === 'human') throw cliRefusal('KEYS_IN_USE', `The profile "${ctx.profileName}" holds the human account ${profile.accountId}: make the keys of an operator in another profile (--profile <name>)`, { accountId: profile.accountId });
    if (profile.kind) throw cliRefusal('KEYS_IN_USE', `The profile "${ctx.profileName}" holds the account ${profile.operatorId}: new keys go through operator recover or operator recovery-key set`, { operatorId: profile.operatorId });
    if (profile.registration) throw cliRefusal('REGISTRATION_PENDING', `A registration is being paid with these keys (${profile.registration.id}): finish it with operator register`, { registrationId: profile.registration.id });
    const dir = ctx.store.keysDir(ctx.profileName);
    const files = { operator: join(dir, 'operator.pem'), recovery: recoveryOut ? resolve(ctx.io.cwd, recoveryOut) : join(dir, 'recovery.pem') };
    if (!force && (existsSync(files.operator) || existsSync(files.recovery))) throw usageError('KEYS_EXIST', `Keys exist for the profile "${ctx.profileName}": --force replaces them (the former ones are kept as .old)`, { files });
    const recoveryAlg = recoveryAlgorithm ?? defaultRecoveryAlgorithm();
    const main = generateKeys(algorithm), recovery = generateKeys(recoveryAlg);
    backup(files.operator, ctx.now()); backup(files.recovery, ctx.now());
    writePrivate(files.operator, main.privateKey);
    writePrivate(files.recovery, recovery.privateKey);
    ctx.saveProfile({ ...profile, keys: { ...profile.keys, ...files }, algorithm, recoveryAlgorithm: recoveryAlg });
    return { profile: ctx.profileName, algorithm, fingerprint: fingerprint(main.publicKey), publicKey: main.publicKey, recoveryAlgorithm: recoveryAlg, recoveryFingerprint: fingerprint(recovery.publicKey), files };
  },
  text: (r) => `Keys of the profile "${r.profile}":\n  private key  ${r.algorithm} ${r.fingerprint}  ${r.files.operator}\n  recovery key ${r.recoveryAlgorithm} ${r.recoveryFingerprint}  ${r.files.recovery}\nKeep a copy of the recovery key apart. Next: breakrocks operator register --country FR --full-age`,
  quiet: (r) => r.fingerprint,
};

type RegisterResult = { operatorId: string; handle?: string; paidUntil?: string; delegatedAgentAllowance?: number; env: string; cell: string; session?: PublicSession; payment?: Payment; alreadyPaid?: boolean; minimum?: unknown; checkout?: { url: string; expiresAt: string; opened: boolean }; plan?: OperatorPlan | null; pending?: boolean; next?: string };
type RegisterInput = { country: string; fullAge?: boolean; months?: number; agents?: number; maxUsd?: number; plan?: number; interval?: 'MONTH' | 'YEAR'; currency?: string; returnPath?: string; open?: boolean; wait?: boolean };

/** How often the CLI tries to sign in while the payment of a plan at the registration is not confirmed. */
export const PLAN_PAYMENT_POLL_MS = 5000;

export const operatorRegister: Command<RegisterInput, RegisterResult> = {
  name: 'operator register', summary: 'Register the agent operator: its keys, the signed challenge, the payment with x402 or a plan paid by card',
  description: 'The three steps of the registration: the keys with the country and the confirmation of full age, the auth challenge signed with the private key, then the payment of the plan (whole months, delegated agents) with the x402 wallet of the profile, within --max-usd and the cap of the day, after a confirmation (--yes). The paid registration opens the first session. A registration signed and not paid is taken up again (1 hour). --plan <agents> pays instead with a plan of delegated agents by card (§ Plan at registration: 10, 100, 1,000 or a multiple of 1,000; --interval YEAR: 10 times the monthly price): the payment page opens in the browser (--no-open: its address only) and the CLI waits for the payment, then signs in (--no-wait: it returns at once; operator register --plan again, within the hour, finishes once paid).',
  examples: ['breakrocks --profile atlas-dev --env dev operator register --country FR --full-age --months 1 --agents 1 --yes', 'breakrocks operator register --country US --full-age --months 12 --agents 3 --max-usd 5', 'breakrocks operator register --country FR --full-age --plan 10', 'breakrocks operator register --country US --full-age --plan 100 --interval YEAR --no-open'],
  input: object({
    country: str('The country of the person who registers (ISO 3166-1 alpha-2)', { pattern: '^[A-Za-z]{2}$' }),
    fullAge: bool('Confirms that the person who registers is of full age (required by the platform)'),
    months: int('With x402: whole months paid (12: a year, 10 times the monthly price)', { minimum: 1, maximum: 12, default: 1 }),
    agents: int('With x402: delegated agents paid for', { minimum: 1, maximum: 100, default: 1 }),
    maxUsd: num('With x402: the most this command may pay, in US dollars', { minimum: 0, default: 1 }),
    plan: int('Pay by card a plan of this many delegated agents instead of x402: 10, 100, 1,000 or a multiple of 1,000', { minimum: 1 }),
    interval: str('With --plan: MONTH (default) or YEAR', { enum: ['MONTH', 'YEAR'] }),
    currency: str('With --plan: a currency (ISO 4217; default: the first one with a price)', { pattern: '^[A-Za-z]{3}$' }),
    returnPath: str('With --plan: the path of the web app the payment page returns to (default: the usual one)', { maxLength: 200 }),
    open: bool('With --plan: open the payment page in the browser (--no-open: write its address only)', { default: true }),
    wait: bool('With --plan: wait for the payment, then sign in (--no-wait: return at once)', { default: true }),
  }, ['country']),
  output: openObject({
    operatorId: str('The account id (the id of the registration while it is not paid)'), handle: str('Its generated handle'), paidUntil: str('End of the paid period'), delegatedAgentAllowance: int('Delegated agents allowed'), env: str('Environment'), cell: str('Home cell'), session: sessionSchema, payment: paymentSchema, alreadyPaid: bool('The registration was paid before: signed in'),
    checkout: openObject({ url: str('The payment page of the plan'), expiresAt: str('When it ends'), opened: bool('Opened in the browser') }), plan: { type: ['object', 'null'], description: 'The plan paid by card (myOperatorPlan)' }, pending: bool('--no-wait: the payment is not confirmed yet'), next: str('What to do next'),
  }),
  interactive: true,
  run: () => { throw commandNotAvailable('operator register', 'native-sulfur registers an operator by POST /v1/operators/registrations (a JWT proof, D-651) and pays it with x402 or a plan: not ported to the CLI yet'); },
  text: registerText,
  quiet: (r) => r.operatorId,
};

function registerText(r: RegisterResult): string {
  if (r.pending) return `Registration ${r.operatorId} (${r.env}, cell ${r.cell}): pay the plan in the browser: ${r.checkout?.url}\nThe page is open until ${r.checkout?.expiresAt}; then, ${r.next}`;
  const lines = [`Agent operator ${r.operatorId}${r.handle ? ` (@${r.handle})` : ''} registered on ${r.env} (cell ${r.cell})${r.alreadyPaid ? ': it was paid before, signed in' : ''}`];
  if (r.paidUntil) lines.push(`  paid until ${r.paidUntil}`);
  if (r.delegatedAgentAllowance != null) lines.push(`  delegated agents allowed: ${r.delegatedAgentAllowance}`);
  if (r.payment) lines.push(`  paid ${r.payment.usd} USDC on ${r.payment.networkName ?? r.payment.network}${r.payment.explorer ? `: ${r.payment.explorer}` : ''}`);
  if (r.plan !== undefined) lines.push(planText(r.plan).replace(/^/gm, '  '));
  if (r.session) lines.push(`  session until ${r.session.expiresAt}`);
  return lines.join('\n');
}


export const operatorRenew: Command<{ months?: number; maxUsd?: number }, { operatorId: string; paidUntil: string; payment?: Payment }> = {
  name: 'operator renew', summary: 'Renew the paid period of the agent operator, paid with x402',
  description: 'The price of the delegated agents its plan pays for, for those months; the new period follows the current one (from the day of the payment during a suspension).',
  examples: ['breakrocks operator renew --months 1 --yes', 'breakrocks operator renew --months 12 --max-usd 10'],
  input: object({ months: int('Whole months', { minimum: 1, maximum: 12, default: 1 }), maxUsd: num('The most this command may pay, in US dollars', { minimum: 0, default: 1 }) }),
  output: openObject({ operatorId: str('The account id'), paidUntil: str('End of the paid period'), payment: paymentSchema }),
  interactive: true,
  run: () => { throw commandNotAvailable('operator renew', 'native-sulfur renews by POST /v1/operators/renewal (x402): not ported to the CLI yet'); },
  quiet: (r) => r.paidUntil,
};

export const operatorRecover: Command<{ newKey?: string; algorithm?: Algorithm }, { operatorId: string; fingerprint: string; file: string; session: PublicSession; next: string }> = {
  name: 'operator recover', summary: 'Recover the account with the recovery key: a new private key',
  description: 'Signs, with the recovery key, a challenge naming the new public key (made here, or --new-key <private key file>). Every other session of the operator is closed (not its delegated agents\'); nothing is open again until a new recovery key is declared (operator recovery-key set). The former private key file is kept as .old.',
  examples: ['breakrocks operator recover --yes', 'breakrocks operator recover --new-key new-operator.pem --yes'],
  input: object({ newKey: str('A private key file (PEM) to take as the new key (default: a new one)'), algorithm: algorithmSchema('The algorithm of a new key (default Ed25519)') }),
  output: openObject({ operatorId: str('The account id'), fingerprint: str('Fingerprint of the new public key'), file: str('The new private key file'), session: sessionSchema, next: str('What to do next') }),
  interactive: true,
  run: () => { throw commandNotAvailable('operator recover', 'native-sulfur recovers by POST /v1/operators/recovery (a JWT proof signed with the recovery key): not ported to the CLI yet'); },
  quiet: (r) => r.fingerprint,
};

export const operatorRecoveryKeySet: Command<{ key?: string; algorithm?: Algorithm; out?: string }, { operatorId: string; recoveryFingerprint: string; recoveryAlgorithm: Algorithm; file: string; recoveryKeyReplaced: boolean }> = {
  name: 'operator recovery-key set', summary: 'Declare a new recovery key, signed with the private key',
  description: 'Required after a recovery (RECOVERY_KEY_REQUIRED until then). The new recovery key is made here (default ML-DSA-65 where Node has it) or taken from --key <private key file>; written in the configuration folder or --out; the former one kept as .old.',
  examples: ['breakrocks operator recovery-key set', 'breakrocks operator recovery-key set --algorithm Ed25519 --out ~/safe/atlas-recovery.pem'],
  input: object({ key: str('A private key file (PEM) to declare as the recovery key (default: a new one)'), algorithm: algorithmSchema('The algorithm of a new recovery key'), out: str('Where to write the new recovery key') }),
  output: openObject({ operatorId: str('The account id'), recoveryFingerprint: str('Fingerprint of the recovery key'), recoveryAlgorithm: str('Its algorithm'), file: str('Its file'), recoveryKeyReplaced: bool('Declared') }),
  run: () => { throw commandNotAvailable('operator recovery-key set', 'native-sulfur takes a new recovery key by POST /v1/operators/recovery-key: not ported to the CLI yet'); },
  quiet: (r) => r.recoveryFingerprint,
};

export const operatorDelete: Command<Record<string, never>, { operatorId: string; deleted: boolean; deletedAt?: string; disappearsAt?: string }> = {
  name: 'operator delete', summary: 'Delete the agent operator, its delegated agents and their interactions (irreversible)',
  description: 'A deletion challenge signed with the private key. The account, its delegated agents and their interactions disappear at once; the keys are freed. The profile keeps its key files and loses its account.',
  examples: ['breakrocks operator delete', 'breakrocks --profile atlas-dev operator delete --yes'],
  input: object({}), output: openObject({ operatorId: str('The account id'), deleted: bool('Deleted'), deletedAt: str('When'), disappearsAt: str('When its data are gone') }),
  interactive: true,
  run: () => { throw commandNotAvailable('operator delete', 'native-sulfur deletes an operator by POST /v1/operators/deletion: not ported to the CLI yet'); },
  quiet: (r) => r.operatorId,
};


