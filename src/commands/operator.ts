// operator keygen|register|login|renew|recover|recovery-key set|delete, and session
// (contracts/agent-sign-in.md § Agent operators; C-04, C-06). The private keys stay in the
// configuration folder (0600); only public keys, signatures and payments leave the device.
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Algorithm, Profile } from '../config.js';
import { writePrivate } from '../config.js';
import type { Context } from '../context.js';
import { endpoints } from '../endpoints.js';
import { CliError, cliRefusal, usageError } from '../errors.js';
import { ALGORITHMS, fingerprint, generateKeys, privateKeyFrom, publicKeyOf, readPrivateKey, signChallenge, supports } from '../keys.js';
import type { Command } from '../registry.js';
import { bool, int, num, object, openObject, str } from '../schema.js';
import { RENEW_BEFORE_MS, credentialsOf, ensureSession, forgetSession, readSession, requireOperator, saveSession, signIn, type Session } from '../session.js';
import { agentsPost, expectOk } from '../transport.js';
import { paidPost, type Payment } from '../x402.js';

const algorithmSchema = (description: string) => str(description, { enum: ALGORITHMS });
const paymentSchema = openObject({ usd: str('Amount paid, in USDC'), network: str('CAIP-2 network'), networkName: str('Network'), payTo: str('Recipient'), transaction: str('Transaction hash'), explorer: str('Link to the transaction') });
const sessionSchema = openObject({ sessionId: str('The session'), expiresAt: str('When it ends (1 hour)'), recoveryKeyRequired: bool('A new recovery key must be declared first') });

/** The default algorithm of a recovery key: ML-DSA-65 where Node has it (it lives long), else Ed25519. */
export const defaultRecoveryAlgorithm = (): Algorithm => (supports('ML-DSA-65') ? 'ML-DSA-65' : 'Ed25519');

function operatorKeys(ctx: Context, profile: Profile) {
  const operator = profile.keys?.operator, recovery = profile.keys?.recovery;
  if (!operator || !existsSync(operator)) throw usageError('KEY_MISSING', `The profile "${ctx.profileName}" has no operator key: breakrocks operator keygen`, { profile: ctx.profileName });
  return { operator, recovery };
}

function backup(path: string, now: number) {
  if (existsSync(path)) renameSync(path, `${path}.${new Date(now).toISOString().replace(/[:.]/g, '-')}.old`);
}

const publicSession = (s: Session) => ({ sessionId: s.sessionId, expiresAt: s.expiresAt, ...(s.recoveryKeyRequired ? { recoveryKeyRequired: true } : {}) });

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

type RegisterResult = { operatorId: string; handle?: string; paidUntil?: string; delegatedAgentAllowance?: number; env: string; cell: string; session?: ReturnType<typeof publicSession>; payment?: Payment; alreadyPaid?: boolean; minimum?: unknown };

export const operatorRegister: Command<{ country: string; fullAge?: boolean; months?: number; agents?: number; maxUsd?: number }, RegisterResult> = {
  name: 'operator register', summary: 'Register the agent operator: its keys, the signed challenge, the payment with x402',
  description: 'The three steps of agent-sign-in.md § Registration: the keys with the country and the confirmation of full age, the auth challenge signed with the private key, then the payment of the plan (whole months, delegated agents) with the x402 wallet of the profile, within --max-usd and the cap of the day, after a confirmation (--yes). The paid registration opens the first session. A registration signed and not paid is taken up again (1 hour).',
  examples: ['breakrocks --profile atlas-dev --env dev operator register --country FR --full-age --months 1 --agents 1 --yes', 'breakrocks operator register --country US --full-age --months 12 --agents 3 --max-usd 5'],
  input: object({
    country: str('The country of the person who registers (ISO 3166-1 alpha-2)', { pattern: '^[A-Za-z]{2}$' }),
    fullAge: bool('Confirms that the person who registers is of full age (required by the platform)'),
    months: int('Whole months paid (12: a year, 10% off)', { minimum: 1, maximum: 12, default: 1 }),
    agents: int('Delegated agents paid for', { minimum: 1, maximum: 100, default: 1 }),
    maxUsd: num('The most this command may pay, in US dollars', { minimum: 0, default: 1 }),
  }, ['country']),
  output: openObject({ operatorId: str('The account id'), handle: str('Its generated handle'), paidUntil: str('End of the paid period'), delegatedAgentAllowance: int('Delegated agents allowed'), env: str('Environment'), cell: str('Home cell'), session: sessionSchema, payment: paymentSchema, alreadyPaid: bool('The registration was paid before: signed in') }),
  interactive: true,
  run: async (ctx, { country, fullAge, months = 1, agents = 1, maxUsd }) => {
    let profile = ctx.profile();
    if (profile.kind) throw cliRefusal('ALREADY_REGISTERED', `The profile "${ctx.profileName}" holds the account ${profile.operatorId ?? profile.agentId ?? profile.accountId}`, { operatorId: profile.operatorId });
    const { operator, recovery } = operatorKeys(ctx, profile);
    if (!recovery || !existsSync(recovery)) throw usageError('KEY_MISSING', 'The recovery key is missing: breakrocks operator keygen --force');
    const main = readPrivateKey(operator, 'The operator key'), rec = readPrivateKey(recovery, 'The recovery key');
    const at = await endpoints(ctx, profile, country);
    let registration = profile.registration && Date.parse(profile.registration.expiresAt) > ctx.now() ? profile.registration : undefined;
    let minimum: unknown;
    if (!registration) {
      const challenge = expectOk(await agentsPost(ctx, at.agents, '/operators/registrations', {
        publicKey: publicKeyOf(main.key), algorithm: main.algorithm, recoveryKey: publicKeyOf(rec.key), recoveryAlgorithm: rec.algorithm, country: country.toUpperCase(), fullAge: fullAge === true,
      })) as { challengeId: string; challenge: string };
      const signed = expectOk(await agentsPost(ctx, at.agents, '/operators/registrations/signature', { challengeId: challenge.challengeId, signature: signChallenge(challenge.challenge, main.key) })) as { registration: { id: string; expiresAt: string }; minimum?: unknown };
      registration = { id: signed.registration.id, expiresAt: signed.registration.expiresAt, country: country.toUpperCase() };
      minimum = signed.minimum;
      profile = { ...profile, cell: at.cell, registration };
      ctx.saveProfile(profile);
    }
    const done = (operatorId: string, extra: Partial<Profile>) => {
      const { registration: _, ...rest } = ctx.profile();
      void _;
      ctx.saveProfile({ ...rest, ...extra, kind: 'operator', operatorId, cell: at.cell });
    };
    let paid;
    try {
      paid = await paidPost(ctx, { base: at.agents, path: `/operators/registrations/${registration.id}/payment`, body: { months, delegatedAgents: agents }, maxUsd, what: `the registration of an agent operator (${agents} delegated agent${agents > 1 ? 's' : ''}, ${months} month${months > 1 ? 's' : ''})` });
    } catch (error) {
      if (error instanceof CliError && error.code === 'REGISTRATION_ALREADY_PAID') {
        done(registration.id, {});
        const session = await signIn(ctx, at, credentialsOf(ctx, ctx.profile())!);
        return { operatorId: registration.id, env: at.env, cell: at.cell, session: publicSession(session), alreadyPaid: true };
      }
      if (error instanceof CliError && error.code === 'REGISTRATION_ABANDONED') { const { registration: _, ...rest } = ctx.profile(); void _; ctx.saveProfile(rest); }
      throw error;
    }
    const body = expectOk(paid.answer, [200, 201]) as { operatorId: string; handle: string; paidUntil: string; delegatedAgentAllowance: number; token: string; sessionId: string; expiresAt: string };
    done(body.operatorId, { handle: body.handle });
    const session: Session = { kind: 'operator', token: body.token, sessionId: body.sessionId, expiresAt: body.expiresAt, operatorId: body.operatorId };
    saveSession(ctx, session);
    return { operatorId: body.operatorId, handle: body.handle, paidUntil: body.paidUntil, delegatedAgentAllowance: body.delegatedAgentAllowance, env: at.env, cell: at.cell, session: publicSession(session), ...(paid.payment ? { payment: paid.payment } : {}), ...(minimum ? { minimum } : {}) };
  },
  quiet: (r) => r.operatorId,
};

export const operatorLogin: Command<Record<string, never>, { operatorId: string; session: ReturnType<typeof publicSession> }> = {
  name: 'operator login', summary: 'Sign in the agent operator: a challenge signed with its private key',
  description: 'Opens a session of 1 hour (renewed on its own 5 minutes before its end by every command). A suspended operator (paid period ended) signs in, reads, and renews.',
  examples: ['breakrocks operator login', 'breakrocks --profile atlas-dev operator login --json'],
  input: object({}), output: openObject({ operatorId: str('The account id'), session: sessionSchema }),
  run: async (ctx) => {
    requireOperator(ctx);
    const profile = ctx.profile();
    if (profile.kind !== 'operator' || !profile.operatorId) throw usageError('NOT_AN_OPERATOR_PROFILE', `The profile "${ctx.profileName}" holds no agent operator: operator register first`);
    const at = await endpoints(ctx, profile);
    const session = await signIn(ctx, at, credentialsOf(ctx, profile)!);
    return { operatorId: session.operatorId!, session: publicSession(session) };
  },
  quiet: (r) => r.session.sessionId,
};

export const operatorRenew: Command<{ months?: number; maxUsd?: number }, { operatorId: string; paidUntil: string; payment?: Payment }> = {
  name: 'operator renew', summary: 'Renew the paid period of the agent operator, paid with x402',
  description: 'The price of the delegated agents its plan pays for, for those months; the new period follows the current one (from the day of the payment during a suspension).',
  examples: ['breakrocks operator renew --months 1 --yes', 'breakrocks operator renew --months 12 --max-usd 10'],
  input: object({ months: int('Whole months', { minimum: 1, maximum: 12, default: 1 }), maxUsd: num('The most this command may pay, in US dollars', { minimum: 0, default: 1 }) }),
  output: openObject({ operatorId: str('The account id'), paidUntil: str('End of the paid period'), payment: paymentSchema }),
  interactive: true,
  run: async (ctx, { months = 1, maxUsd }) => {
    requireOperator(ctx);
    const { session, at } = await ensureSession(ctx);
    const paid = await paidPost(ctx, { base: at.agents, path: '/operators/renewal', body: { months }, headers: { authorization: `Bearer ${session.token}` }, maxUsd, what: `the renewal of the agent operator (${months} month${months > 1 ? 's' : ''})` });
    const body = expectOk(paid.answer) as { operatorId: string; paidUntil: string };
    return { operatorId: body.operatorId, paidUntil: body.paidUntil, ...(paid.payment ? { payment: paid.payment } : {}) };
  },
  quiet: (r) => r.paidUntil,
};

export const operatorRecover: Command<{ newKey?: string; algorithm?: Algorithm }, { operatorId: string; fingerprint: string; file: string; session: ReturnType<typeof publicSession>; next: string }> = {
  name: 'operator recover', summary: 'Recover the account with the recovery key: a new private key',
  description: 'Signs, with the recovery key, a challenge naming the new public key (made here, or --new-key <private key file>). Every other session of the operator is closed (not its delegated agents\'); nothing is open again until a new recovery key is declared (operator recovery-key set). The former private key file is kept as .old.',
  examples: ['breakrocks operator recover --yes', 'breakrocks operator recover --new-key new-operator.pem --yes'],
  input: object({ newKey: str('A private key file (PEM) to take as the new key (default: a new one)'), algorithm: algorithmSchema('The algorithm of a new key (default Ed25519)') }),
  output: openObject({ operatorId: str('The account id'), fingerprint: str('Fingerprint of the new public key'), file: str('The new private key file'), session: sessionSchema, next: str('What to do next') }),
  interactive: true,
  run: async (ctx, { newKey, algorithm = 'Ed25519' }) => {
    requireOperator(ctx);
    const profile = ctx.profile();
    if (profile.kind !== 'operator' || !profile.operatorId) throw usageError('NOT_AN_OPERATOR_PROFILE', `The profile "${ctx.profileName}" holds no agent operator`);
    const recoveryFile = profile.keys?.recovery;
    if (!recoveryFile || !existsSync(recoveryFile)) throw usageError('KEY_MISSING', 'The recovery key file of the profile is missing', { profile: ctx.profileName });
    const recovery = readPrivateKey(recoveryFile, 'The recovery key');
    const pair = newKey ? (() => { const k = privateKeyFrom(readFileSync(resolve(ctx.io.cwd, newKey), 'utf8'), newKey); return { privateKey: readFileSync(resolve(ctx.io.cwd, newKey), 'utf8'), publicKey: publicKeyOf(k.key), algorithm: k.algorithm }; })() : generateKeys(algorithm);
    await ctx.confirm(`Recover the account ${profile.operatorId} with a new private key (${fingerprint(pair.publicKey)})? Its other sessions close.`);
    const target = profile.keys?.operator ?? join(ctx.store.keysDir(ctx.profileName), 'operator.pem');
    const pending = `${target}.new`;
    writePrivate(pending, pair.privateKey);
    const at = await endpoints(ctx, profile);
    const challenge = expectOk(await agentsPost(ctx, at.agents, '/operators/recovery/challenges', { operatorId: profile.operatorId, publicKey: pair.publicKey, algorithm: pair.algorithm })) as { challengeId: string; challenge: string };
    const body = expectOk(await agentsPost(ctx, at.agents, '/operators/recovery', { challengeId: challenge.challengeId, signature: signChallenge(challenge.challenge, recovery.key) })) as { token: string; sessionId: string; expiresAt: string; recoveryKeyRequired?: boolean };
    backup(target, ctx.now());
    renameSync(pending, target);
    ctx.saveProfile({ ...ctx.profile(), keys: { ...profile.keys, operator: target }, algorithm: pair.algorithm });
    const session: Session = { kind: 'operator', token: body.token, sessionId: body.sessionId, expiresAt: body.expiresAt, operatorId: profile.operatorId, recoveryKeyRequired: true };
    saveSession(ctx, session);
    return { operatorId: profile.operatorId, fingerprint: fingerprint(pair.publicKey), file: target, session: publicSession(session), next: 'breakrocks operator recovery-key set' };
  },
  quiet: (r) => r.fingerprint,
};

export const operatorRecoveryKeySet: Command<{ key?: string; algorithm?: Algorithm; out?: string }, { operatorId: string; recoveryFingerprint: string; recoveryAlgorithm: Algorithm; file: string; recoveryKeyReplaced: boolean }> = {
  name: 'operator recovery-key set', summary: 'Declare a new recovery key, signed with the private key',
  description: 'Required after a recovery (RECOVERY_KEY_REQUIRED until then). The new recovery key is made here (default ML-DSA-65 where Node has it) or taken from --key <private key file>; written in the configuration folder or --out; the former one kept as .old.',
  examples: ['breakrocks operator recovery-key set', 'breakrocks operator recovery-key set --algorithm Ed25519 --out ~/safe/atlas-recovery.pem'],
  input: object({ key: str('A private key file (PEM) to declare as the recovery key (default: a new one)'), algorithm: algorithmSchema('The algorithm of a new recovery key'), out: str('Where to write the new recovery key') }),
  output: openObject({ operatorId: str('The account id'), recoveryFingerprint: str('Fingerprint of the recovery key'), recoveryAlgorithm: str('Its algorithm'), file: str('Its file'), recoveryKeyReplaced: bool('Declared') }),
  run: async (ctx, { key, algorithm, out }) => {
    requireOperator(ctx);
    const profile = ctx.profile();
    if (profile.kind !== 'operator' || !profile.operatorId) throw usageError('NOT_AN_OPERATOR_PROFILE', `The profile "${ctx.profileName}" holds no agent operator`);
    const { operator } = operatorKeys(ctx, profile);
    const main = readPrivateKey(operator, 'The operator key');
    const pair = key ? (() => { const text = readFileSync(resolve(ctx.io.cwd, key), 'utf8'); const k = privateKeyFrom(text, key); return { privateKey: text, publicKey: publicKeyOf(k.key), algorithm: k.algorithm }; })() : generateKeys(algorithm ?? defaultRecoveryAlgorithm());
    const target = out ? resolve(ctx.io.cwd, out) : profile.keys?.recovery ?? join(ctx.store.keysDir(ctx.profileName), 'recovery.pem');
    const pending = `${target}.new`;
    writePrivate(pending, pair.privateKey);
    const at = await endpoints(ctx, profile);
    const challenge = expectOk(await agentsPost(ctx, at.agents, '/operators/recovery-key/challenges', { operatorId: profile.operatorId, recoveryKey: pair.publicKey, algorithm: pair.algorithm })) as { challengeId: string; challenge: string };
    const body = expectOk(await agentsPost(ctx, at.agents, '/operators/recovery-key', { challengeId: challenge.challengeId, signature: signChallenge(challenge.challenge, main.key) })) as { recoveryKeyReplaced: boolean };
    backup(target, ctx.now());
    renameSync(pending, target);
    ctx.saveProfile({ ...ctx.profile(), keys: { ...profile.keys, recovery: target }, recoveryAlgorithm: pair.algorithm });
    const session = readSession(ctx);
    if (session?.recoveryKeyRequired) { delete session.recoveryKeyRequired; saveSession(ctx, session); }
    return { operatorId: profile.operatorId, recoveryFingerprint: fingerprint(pair.publicKey), recoveryAlgorithm: pair.algorithm, file: target, recoveryKeyReplaced: body.recoveryKeyReplaced === true };
  },
  quiet: (r) => r.recoveryFingerprint,
};

export const operatorDelete: Command<Record<string, never>, { operatorId: string; deleted: boolean; deletedAt?: string; disappearsAt?: string }> = {
  name: 'operator delete', summary: 'Delete the agent operator, its delegated agents and their interactions (irreversible)',
  description: 'A deletion challenge signed with the private key. The account, its delegated agents and their interactions disappear at once; the keys are freed. The profile keeps its key files and loses its account.',
  examples: ['breakrocks operator delete', 'breakrocks --profile atlas-dev operator delete --yes'],
  input: object({}), output: openObject({ operatorId: str('The account id'), deleted: bool('Deleted'), deletedAt: str('When'), disappearsAt: str('When its data are gone') }),
  interactive: true,
  run: async (ctx) => {
    requireOperator(ctx);
    const profile = ctx.profile();
    if (profile.kind !== 'operator' || !profile.operatorId) throw usageError('NOT_AN_OPERATOR_PROFILE', `The profile "${ctx.profileName}" holds no agent operator`);
    const { operator } = operatorKeys(ctx, profile);
    const main = readPrivateKey(operator, 'The operator key');
    await ctx.confirm(`Delete the agent operator ${profile.operatorId}${profile.handle ? ` (@${profile.handle})` : ''}, its delegated agents and their interactions? This cannot be undone.`, { operatorId: profile.operatorId });
    const at = await endpoints(ctx, profile);
    const challenge = expectOk(await agentsPost(ctx, at.agents, '/operators/deletion/challenges', { operatorId: profile.operatorId })) as { challengeId: string; challenge: string };
    const body = expectOk(await agentsPost(ctx, at.agents, '/operators/deletion', { challengeId: challenge.challengeId, signature: signChallenge(challenge.challenge, main.key) })) as { deleted: boolean; deletedAt?: string; disappearsAt?: string };
    const { kind: _k, operatorId: _o, handle: _h, ...rest } = ctx.profile();
    void _k; void _o; void _h;
    ctx.saveProfile(rest);
    forgetSession(ctx);
    return { operatorId: profile.operatorId, ...body };
  },
  quiet: (r) => r.operatorId,
};

type SessionResult = { profile: string; signedIn: boolean; kind?: string; accountId?: string; operatorId?: string; agentId?: string; sessionId?: string; expiresAt?: string; expiresInSeconds?: number; renewsAt?: string; signInAgainBy?: string; recoveryKeyRequired?: boolean; keySource?: string; canRenew: boolean };

export const sessionCommand: Command<{ renew?: boolean }, SessionResult> = {
  name: 'session', summary: 'Show the session of the profile and when it ends (--renew: renew it now)',
  description: 'The token of a session lasts 1 hour; every command renews it 5 minutes before its end, with the key of an operator or an agent (C-06), with the refresh token of a human, whose session lasts 7 days from the sign-in (signInAgainBy). Never shows a token.',
  examples: ['breakrocks session', 'breakrocks session --renew --json'],
  input: object({ renew: bool('Renew the session now') }),
  output: openObject({ profile: str('The profile'), signedIn: bool('A session is open'), kind: str('human, operator or agent'), accountId: str('The account of a human'), operatorId: str('Operator'), agentId: str('Delegated agent'), sessionId: str('The session'), expiresAt: str('When its token ends'), expiresInSeconds: int('Seconds left'), renewsAt: str('When it is renewed'), signInAgainBy: str('A human: when the session ends, 7 days after the sign-in'), canRenew: bool('The key, or the refresh token of a human, is here to renew it') }),
  run: async (ctx, { renew }) => {
    const profile = ctx.profile();
    let canRenew = false;
    try { canRenew = !!credentialsOf(ctx, profile); } catch { canRenew = false; }
    const session = renew ? (await ensureSession(ctx, { renew: true })).session : readSession(ctx);
    const human = session?.kind === 'human';
    if (human) canRenew = !!session.refreshToken && Date.parse(session.signInAgainBy ?? '') > ctx.now();
    if (!session || (human ? !canRenew : Date.parse(session.expiresAt) <= ctx.now())) return { profile: ctx.profileName, signedIn: false, canRenew, ...(session ? { expiresAt: session.expiresAt } : {}) };
    const left = Math.max(0, Date.parse(session.expiresAt) - ctx.now());
    return {
      profile: ctx.profileName, signedIn: true, kind: session.kind, ...(session.accountId ? { accountId: session.accountId } : {}), ...(session.operatorId ? { operatorId: session.operatorId } : {}), ...(session.agentId ? { agentId: session.agentId } : {}),
      sessionId: session.sessionId, expiresAt: session.expiresAt, expiresInSeconds: Math.floor(left / 1000), renewsAt: new Date(Date.parse(session.expiresAt) - RENEW_BEFORE_MS).toISOString(),
      ...(session.signInAgainBy ? { signInAgainBy: session.signInAgainBy } : {}),
      ...(session.recoveryKeyRequired ? { recoveryKeyRequired: true } : {}), ...(session.keySource ? { keySource: session.keySource } : {}), canRenew,
    };
  },
  quiet: (r) => r.sessionId,
};
