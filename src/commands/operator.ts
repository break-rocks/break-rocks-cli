// operator keygen|register|renew|recover|recovery-key set|delete on native-sulfur's REST routes (src/sulfur/operators.ts, D-651;
// operator login: src/sulfur/commands.ts).
// The private keys stay in the
// configuration folder (0600); only public keys, signatures and payments leave the device.
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Algorithm, Environment, Profile } from '../config.js';
import type { Context } from '../context.js';
import { writePrivate } from '../config.js';
import { CliError, cliRefusal, usageError } from '../errors.js';
import { ALGORITHMS, fingerprint, generateKeys, privateKeyFrom, readPrivateKey } from '../keys.js';
import type { KeyObject } from 'node:crypto';
import type { Command } from '../registry.js';
import { bool, int, num, object, openObject, str } from '../schema.js';
import { paidRequest, type Payment } from '../x402.js';
import { requireOperator } from '../session.js';
import { agentSignIn } from '../sulfur/agent.js';
import { forgetSulfurSession } from '../sulfur/session.js';
import { audienceBase, cellOfId, expectOperatorsOk, fingerprintOfKey, operatorsPost, operatorsRefusal, proofOf, publicPem } from '../sulfur/operators.js';

const algorithmSchema = (description: string) => str(description, { enum: ALGORITHMS });
const paymentSchema = openObject({ usd: str('Amount paid, in USDC'), network: str('CAIP-2 network'), networkName: str('Network'), payTo: str('Recipient'), transaction: str('Transaction hash'), explorer: str('Link to the transaction') });
const sessionSchema = openObject({ expiresAt: str('When its token ends (renewed on its own with the key)') });

/** The default algorithm of a recovery key: Ed25519, the one native-sulfur takes (D-542: ML-DSA-65 not accepted yet). */
export const defaultRecoveryAlgorithm = (): Algorithm => 'Ed25519';

/** A key native-sulfur takes: Ed25519 only (KEY_INVALID before anything is sent otherwise). */
function ed25519(k: { key: KeyObject; algorithm: Algorithm }, what: string, fix: string): KeyObject {
  if (k.algorithm !== 'Ed25519') throw usageError('KEY_INVALID', `${what} is ${k.algorithm}: native-sulfur takes Ed25519 keys only (D-542): ${fix}`, { algorithm: k.algorithm });
  return k.key;
}

/** The private and the recovery key of the profile. */
function operatorKeys(ctx: Context, profile: Profile) {
  const operator = profile.keys?.operator, recovery = profile.keys?.recovery;
  if (!operator || !existsSync(operator)) throw usageError('KEY_MISSING', `The profile "${ctx.profileName}" has no operator key: breakrocks operator keygen`, { profile: ctx.profileName });
  if (!recovery || !existsSync(recovery)) throw usageError('KEY_MISSING', 'The recovery key is missing: breakrocks operator keygen --force (or its file, config of the profile)', { profile: ctx.profileName });
  return { operator, recovery };
}

/** The agent operator of the profile: its id, environment and cell (NOT_AN_OPERATOR_PROFILE otherwise). */
function operatorOf(ctx: Context): { profile: Profile; operatorId: string; env: Environment; cell: string } {
  requireOperator(ctx);
  const profile = ctx.profile();
  if (profile.kind !== 'operator' || !profile.operatorId) throw usageError('NOT_AN_OPERATOR_PROFILE', `The profile "${ctx.profileName}" holds no agent operator: operator register first`, { profile: ctx.profileName });
  return { profile, operatorId: profile.operatorId, env: profile.env, cell: profile.cell ?? cellOfId(profile.operatorId) ?? 'eu' };
}

function backup(path: string, now: number) {
  if (existsSync(path)) renameSync(path, `${path}.${new Date(now).toISOString().replace(/[:.]/g, '-')}.old`);
}

type PublicSession = { expiresAt: string };

type KeygenResult = { profile: string; algorithm: Algorithm; fingerprint: string; publicKey: string; recoveryAlgorithm: Algorithm; recoveryFingerprint: string; files: { operator: string; recovery: string } };

export const operatorKeygen: Command<{ algorithm?: Algorithm; recoveryAlgorithm?: Algorithm; recoveryOut?: string; force?: boolean }, KeygenResult> = {
  name: 'operator keygen', summary: 'Make the keys of an agent operator: its private key and its recovery key',
  description: 'Both private keys are written in the configuration folder (0600), never printed; --recovery-out writes the recovery key elsewhere (keep it apart: it recovers the account when the private key is lost). ML-DSA-65 needs a Node that has it in node:crypto; the CLI says so otherwise.',
  examples: ['breakrocks operator keygen', 'breakrocks operator keygen --algorithm ML-DSA-65 --recovery-out ~/safe/atlas-recovery.pem'],
  input: object({
    algorithm: algorithmSchema('The algorithm of the private key (default Ed25519)'), recoveryAlgorithm: algorithmSchema('The algorithm of the recovery key (default Ed25519: native-sulfur takes Ed25519 keys only, D-542)'),
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

type RegisterResult = { operatorId: string; handle?: string; paidUntil?: string; delegatedAgentAllowance?: number; env: string; cell: string; session?: PublicSession; payment?: Payment; alreadyPaid?: boolean; minimum?: unknown };
type RegisterInput = { country: string; fullAge?: boolean; months?: number; agents?: number; maxUsd?: number };


export const operatorRegister: Command<RegisterInput, RegisterResult> = {
  name: 'operator register', summary: 'Register the agent operator: its two keys, a signed proof, the payment with x402',
  description: 'The two steps of the registration on native-sulfur (POST /v1/operators/registrations, then its payment): both public keys (Ed25519), the country and the confirmation of full age with a proof signed with the private key; then the plan (whole months, delegated agents) paid with the x402 wallet of the profile, within --max-usd and the cap of the day, after a confirmation (--yes). Once paid, the operator signs in with its key (RFC 7523). A registration signed and not paid is taken up again (1 hour). --plan (a plan paid by card at the registration) is not available on native-sulfur: register with x402, then operator plan start.',
  examples: ['breakrocks --profile atlas-dev --env dev operator register --country FR --full-age --months 1 --agents 1 --yes', 'breakrocks operator register --country US --full-age --months 12 --agents 3 --max-usd 5'],
  input: object({
    country: str('The country of the person who registers (ISO 3166-1 alpha-2)', { pattern: '^[A-Za-z]{2}$' }),
    fullAge: bool('Confirms that the person who registers is of full age (required by the platform)'),
    months: int('With x402: whole months paid (12: a year, 10 times the monthly price)', { minimum: 1, maximum: 12, default: 1 }),
    agents: int('With x402: delegated agents paid for', { minimum: 1, maximum: 100, default: 1 }),
    maxUsd: num('With x402: the most this command may pay, in US dollars', { minimum: 0, default: 1 }),
  }, ['country']),
  output: openObject({
    operatorId: str('The account id (the id of the registration while it is not paid)'), handle: str('Its generated handle'), paidUntil: str('End of the paid period'), delegatedAgentAllowance: int('Delegated agents allowed'), env: str('Environment'), cell: str('Home cell'), session: sessionSchema, payment: paymentSchema, alreadyPaid: bool('The registration was paid before: signed in'),
  }),
  interactive: true,
  run: async (ctx, input) => {
    const { country, fullAge, months = 1, agents = 1, maxUsd } = input;
    let profile = ctx.profile();
    if (profile.kind) throw cliRefusal('ALREADY_REGISTERED', `The profile "${ctx.profileName}" holds the account ${profile.operatorId ?? profile.agentId ?? profile.accountId}`, { operatorId: profile.operatorId });
    const files = operatorKeys(ctx, profile);
    const fix = 'breakrocks operator keygen --force --algorithm Ed25519 --recovery-algorithm Ed25519';
    const main = ed25519(readPrivateKey(files.operator, 'The operator key'), 'The operator key', fix);
    const rec = ed25519(readPrivateKey(files.recovery, 'The recovery key'), 'The recovery key', fix);
    const env = profile.env;
    let registration = profile.registration && Date.parse(profile.registration.expiresAt) > ctx.now() ? profile.registration : undefined;
    let cell = cellOfId(registration?.id) ?? profile.cell ?? 'eu';
    let minimum: unknown;
    if (!registration) {
      const path = '/v1/operators/registrations';
      const answer = expectOperatorsOk(await operatorsPost(ctx, env, cell, path, {
        publicKey: publicPem(main), algorithm: 'Ed25519', recoveryKey: publicPem(rec), recoveryAlgorithm: 'Ed25519', country: country.toUpperCase(), fullAge: fullAge === true,
        proof: proofOf(ctx, main, 'registration', `${audienceBase(ctx, env, cell)}${path}`, { rk: fingerprintOfKey(rec) }),
      }), 'The registration') as { registration: { id: string; expiresAt: string }; minimum?: unknown };
      registration = { id: answer.registration.id, expiresAt: answer.registration.expiresAt, country: country.toUpperCase() };
      minimum = answer.minimum;
      cell = cellOfId(registration.id) ?? cell;
      profile = { ...profile, cell, registration };
      ctx.saveProfile(profile);
    }
    const pending = registration;
    const done = (extra: Partial<Profile>) => {
      const { registration: _, ...rest } = ctx.profile();
      void _;
      ctx.saveProfile({ ...rest, ...extra, kind: 'operator', operatorId: pending.id, cell });
    };
    const signedIn = async () => {
      const session = await agentSignIn(ctx, { agentId: pending.id, operatorId: pending.id, key: main });
      if (session.handle) ctx.saveProfile({ ...ctx.profile(), handle: session.handle });
      return session;
    };
    const what = `the registration of an agent operator (${agents} delegated agent${agents > 1 ? 's' : ''}, ${months} month${months > 1 ? 's' : ''})`;
    let paid;
    try {
      paid = await paidRequest(ctx, (headers) => operatorsPost(ctx, env, cell, `/v1/operators/registrations/${pending.id}/payment`, { months, delegatedAgents: agents }, headers), { maxUsd, what, refusal: (a) => operatorsRefusal(a, 'The payment of the registration') });
      if (paid.answer.status !== 201 && paid.answer.status !== 200) throw operatorsRefusal(paid.answer, 'The payment of the registration');
    } catch (error) {
      if (error instanceof CliError && error.code === 'REGISTRATION_ALREADY_PAID') {
        done({});
        const session = await signedIn();
        return { operatorId: pending.id, handle: session.handle, env, cell, session: { expiresAt: session.accessExpiresAt }, alreadyPaid: true };
      }
      if (error instanceof CliError && error.code === 'REGISTRATION_ABANDONED') { const { registration: _, ...rest } = ctx.profile(); void _; ctx.saveProfile(rest); }
      throw error;
    }
    const body = paid.answer.json as { operatorId: string; paidUntil: string; delegatedAgentAllowance: number };
    done({});
    const session = await signedIn();
    return { operatorId: body.operatorId ?? pending.id, ...(session.handle ? { handle: session.handle } : {}), paidUntil: body.paidUntil, delegatedAgentAllowance: body.delegatedAgentAllowance, env, cell, session: { expiresAt: session.accessExpiresAt }, ...(paid.payment ? { payment: paid.payment } : {}), ...(minimum ? { minimum } : {}) };
  },
  text: registerText,
  quiet: (r) => r.operatorId,
};

function registerText(r: RegisterResult): string {
  const lines = [`Agent operator ${r.operatorId}${r.handle ? ` (@${r.handle})` : ''} registered on ${r.env} (cell ${r.cell})${r.alreadyPaid ? ': it was paid before, signed in' : ''}`];
  if (r.paidUntil) lines.push(`  paid until ${r.paidUntil}`);
  if (r.delegatedAgentAllowance != null) lines.push(`  delegated agents allowed: ${r.delegatedAgentAllowance}`);
  if (r.payment) lines.push(`  paid ${r.payment.usd} USDC on ${r.payment.networkName ?? r.payment.network}${r.payment.explorer ? `: ${r.payment.explorer}` : ''}`);
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
  run: async (ctx, { months = 1, maxUsd }) => {
    const { profile, operatorId, env, cell } = operatorOf(ctx);
    const main = ed25519(readPrivateKey(operatorKeys(ctx, profile).operator, 'The operator key'), 'The operator key', 'operator recover --algorithm Ed25519');
    const path = '/v1/operators/renewal';
    const { answer, payment } = await paidRequest(ctx, (headers) => operatorsPost(ctx, env, cell, path, { operatorId, months, proof: proofOf(ctx, main, operatorId, `${audienceBase(ctx, env, cell)}${path}`) }, headers),
      { maxUsd, what: `the renewal of the agent operator (${months} month${months > 1 ? 's' : ''})`, refusal: (a) => operatorsRefusal(a, 'The renewal') });
    const body = expectOperatorsOk(answer, 'The renewal') as { operatorId: string; paidUntil: string };
    return { operatorId: body.operatorId ?? operatorId, paidUntil: body.paidUntil, ...(payment ? { payment } : {}) };
  },
  quiet: (r) => r.paidUntil,
};

export const operatorRecover: Command<{ newKey?: string; algorithm?: Algorithm }, { operatorId: string; fingerprint: string; file: string; recoveryKeyRequired: boolean; next: string }> = {
  name: 'operator recover', summary: 'Recover the account with the recovery key: a new private key',
  description: 'A proof signed with the recovery key names the new public key (made here, or --new-key <private key file>; Ed25519). Every session of the operator ends (its session on this device is forgotten); a new recovery key is due next (operator recovery-key set). The former private key file is kept as .old.',
  examples: ['breakrocks operator recover --yes', 'breakrocks operator recover --new-key new-operator.pem --yes'],
  input: object({ newKey: str('A private key file (PEM) to take as the new key (default: a new one)'), algorithm: algorithmSchema('The algorithm of a new key (default Ed25519)') }),
  output: openObject({ operatorId: str('The account id'), fingerprint: str('Fingerprint of the new public key'), file: str('The new private key file'), recoveryKeyRequired: bool('A new recovery key is due'), next: str('What to do next') }),
  interactive: true,
  run: async (ctx, { newKey, algorithm = 'Ed25519' }) => {
    const { profile, operatorId, env, cell } = operatorOf(ctx);
    const recoveryFile = profile.keys?.recovery;
    if (!recoveryFile || !existsSync(recoveryFile)) throw usageError('KEY_MISSING', 'The recovery key file of the profile is missing', { profile: ctx.profileName });
    const recovery = ed25519(readPrivateKey(recoveryFile, 'The recovery key'), 'The recovery key', 'an Ed25519 recovery key is needed');
    const pair = newKey ? (() => { const text = readFileSync(resolve(ctx.io.cwd, newKey), 'utf8'); const k = privateKeyFrom(text, newKey); return { privateKey: text, key: k.key, algorithm: k.algorithm }; })() : (() => { const g = generateKeys(algorithm); return { privateKey: g.privateKey, key: privateKeyFrom(g.privateKey, 'the new key').key, algorithm }; })();
    const key = ed25519({ key: pair.key, algorithm: pair.algorithm }, 'The new key', 'an Ed25519 key');
    const pem = publicPem(key);
    await ctx.confirm(`Recover the account ${operatorId} with a new private key (${fingerprint(pem)})? Its sessions end.`);
    const target = profile.keys?.operator ?? join(ctx.store.keysDir(ctx.profileName), 'operator.pem');
    const staged = `${target}.new`;
    writePrivate(staged, pair.privateKey);
    const path = '/v1/operators/recovery';
    expectOperatorsOk(await operatorsPost(ctx, env, cell, path, { operatorId, publicKey: pem, algorithm: 'Ed25519', proof: proofOf(ctx, recovery, operatorId, `${audienceBase(ctx, env, cell)}${path}`, { npk: fingerprintOfKey(key) }) }), 'The recovery');
    backup(target, ctx.now());
    renameSync(staged, target);
    ctx.saveProfile({ ...ctx.profile(), keys: { ...profile.keys, operator: target }, algorithm: 'Ed25519' });
    forgetSulfurSession(ctx);
    return { operatorId, fingerprint: fingerprint(pem), file: target, recoveryKeyRequired: true, next: 'breakrocks operator recovery-key set' };
  },
  quiet: (r) => r.fingerprint,
};

export const operatorRecoveryKeySet: Command<{ key?: string; algorithm?: Algorithm; out?: string }, { operatorId: string; recoveryFingerprint: string; recoveryAlgorithm: Algorithm; file: string; recoveryKeyReplaced: boolean }> = {
  name: 'operator recovery-key set', summary: 'Declare a new recovery key, proved by the former recovery key',
  description: 'Required after a recovery (RECOVERY_KEY_REQUIRED until then). A proof signed with the former recovery key names the new one (native-sulfur: the private key alone cannot replace it), made here (Ed25519) or taken from --key <private key file>; written in the configuration folder or --out; the former one kept as .old. Every session of the operator ends.',
  examples: ['breakrocks operator recovery-key set', 'breakrocks operator recovery-key set --algorithm Ed25519 --out ~/safe/atlas-recovery.pem'],
  input: object({ key: str('A private key file (PEM) to declare as the recovery key (default: a new one)'), algorithm: algorithmSchema('The algorithm of a new recovery key'), out: str('Where to write the new recovery key') }),
  output: openObject({ operatorId: str('The account id'), recoveryFingerprint: str('Fingerprint of the recovery key'), recoveryAlgorithm: str('Its algorithm'), file: str('Its file'), recoveryKeyReplaced: bool('Declared') }),
  run: async (ctx, { key, algorithm, out }) => {
    const { profile, operatorId, env, cell } = operatorOf(ctx);
    const former = ed25519(readPrivateKey(operatorKeys(ctx, profile).recovery, 'The recovery key'), 'The former recovery key', 'an Ed25519 recovery key is needed');
    const pair = key ? (() => { const text = readFileSync(resolve(ctx.io.cwd, key), 'utf8'); const k = privateKeyFrom(text, key); return { privateKey: text, key: k.key, algorithm: k.algorithm }; })() : (() => { const a = algorithm ?? defaultRecoveryAlgorithm(); const g = generateKeys(a); return { privateKey: g.privateKey, key: privateKeyFrom(g.privateKey, 'the new recovery key').key, algorithm: a }; })();
    const next = ed25519({ key: pair.key, algorithm: pair.algorithm }, 'The new recovery key', 'an Ed25519 key');
    const pem = publicPem(next);
    const target = out ? resolve(ctx.io.cwd, out) : profile.keys?.recovery ?? join(ctx.store.keysDir(ctx.profileName), 'recovery.pem');
    const staged = `${target}.new`;
    writePrivate(staged, pair.privateKey);
    const path = '/v1/operators/recovery-key';
    const body = expectOperatorsOk(await operatorsPost(ctx, env, cell, path, { operatorId, recoveryKey: pem, algorithm: 'Ed25519', proof: proofOf(ctx, former, operatorId, `${audienceBase(ctx, env, cell)}${path}`, { nrk: fingerprintOfKey(next) }) }), 'The new recovery key') as { recoveryKeyReplaced?: boolean };
    backup(target, ctx.now());
    renameSync(staged, target);
    ctx.saveProfile({ ...ctx.profile(), keys: { ...profile.keys, recovery: target }, recoveryAlgorithm: 'Ed25519' });
    forgetSulfurSession(ctx);
    return { operatorId, recoveryFingerprint: fingerprint(pem), recoveryAlgorithm: 'Ed25519', file: target, recoveryKeyReplaced: body.recoveryKeyReplaced === true };
  },
  quiet: (r) => r.recoveryFingerprint,
};

export const operatorDelete: Command<Record<string, never>, { operatorId: string; deleted: boolean; deletedAt?: string; disappearsAt?: string }> = {
  name: 'operator delete', summary: 'Delete the agent operator, its delegated agents and their interactions (irreversible)',
  description: 'A proof signed with the private key (POST /v1/operators/deletion). The account, its delegated agents and their interactions disappear at once; the keys are freed. The profile keeps its key files and loses its account.',
  examples: ['breakrocks operator delete', 'breakrocks --profile atlas-dev operator delete --yes'],
  input: object({}), output: openObject({ operatorId: str('The account id'), deleted: bool('Deleted'), deletedAt: str('When'), disappearsAt: str('When its data are gone') }),
  interactive: true,
  run: async (ctx) => {
    const { profile, operatorId, env, cell } = operatorOf(ctx);
    const main = ed25519(readPrivateKey(operatorKeys(ctx, profile).operator, 'The operator key'), 'The operator key', 'operator recover --algorithm Ed25519');
    await ctx.confirm(`Delete the agent operator ${operatorId}${profile.handle ? ` (@${profile.handle})` : ''}, its delegated agents and their interactions? This cannot be undone.`, { operatorId });
    const path = '/v1/operators/deletion';
    const body = expectOperatorsOk(await operatorsPost(ctx, env, cell, path, { operatorId, proof: proofOf(ctx, main, operatorId, `${audienceBase(ctx, env, cell)}${path}`) }), 'The deletion') as { deleted: boolean; deletedAt?: string };
    const { kind: _k, operatorId: _o, handle: _h, ...rest } = ctx.profile();
    void _k; void _o; void _h;
    ctx.saveProfile(rest);
    forgetSulfurSession(ctx);
    return { operatorId, deleted: body.deleted === true, ...(body.deletedAt ? { deletedAt: body.deletedAt } : {}) };
  },
  quiet: (r) => r.operatorId,
};


