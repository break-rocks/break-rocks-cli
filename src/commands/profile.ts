// profile add|use|list|remove|show: several accounts and environments side by side, each in
// a profile of the configuration folder. --profile or BREAKROCKS_PROFILE picks one for a command.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_PROFILE, ENVIRONMENTS, checkProfileName, type Profile } from '../config.js';
import { describeNetwork, networkSettings, profileProxy, redactUrl, saveProfileProxy } from '../network.js';
import type { Context } from '../context.js';
import { cliRefusal, usageError } from '../errors.js';
import type { Command } from '../registry.js';
import { bool, list, object, openObject, str } from '../schema.js';
import { readSulfurSession, sulfurActorOf } from '../sulfur/session.js';

const envSchema = str('The environment', { enum: ENVIRONMENTS });
const profileOutput = openObject({
  name: str('The profile'), current: bool('Whether it is the current profile'), env: envSchema, cell: str('The home cell of its account'),
  kind: str('Its account: a human, an agent operator or a delegated agent', { enum: ['human', 'operator', 'agent'] }), accountId: str('The account id of a human'), operatorId: str('The account id of the operator'),
  agentId: str('The id of the delegated agent'), handle: str('The handle of the account'), keys: openObject({}, 'Paths of its key files'),
  wallet: openObject({ address: str('The address of the wallet'), source: str('file or env'), maxUsdPerDay: { type: 'number', description: 'Cap per UTC day' } }),
  session: openObject({ expiresAt: str('When the session ends') }),
  proxy: str('Its proxy, credentials hidden (config set proxy)'), noProxy: str('Its hosts reached without the proxy'), caFile: str('Its CA bundle'),
  network: openObject({ proxy: str('The proxy of the https requests in effect, credentials hidden'), httpProxy: str('The proxy of the http requests, when another'), proxySource: str('option, profile or environment'), noProxy: str('The hosts reached directly'), caFile: str('The CA bundle added'), caSource: str('option or profile') }, 'The network settings in effect for this profile (--proxy, the profile, the environment)'),
});

type ProfileView = { name: string; current: boolean } & Partial<Profile> & { session?: { expiresAt: string; kind: string }; network?: ReturnType<typeof describeNetwork> };

function view(ctx: Context, name: string, profile: Profile): ProfileView {
  const current = (ctx.store.read().current ?? DEFAULT_PROFILE) === name;
  const { wallet, ...rest } = profile;
  const signedIn = name === ctx.profileName ? readSulfurSession(ctx) : undefined;
  const session = signedIn ? { expiresAt: signedIn.accessExpiresAt, kind: (({ actor }) => (actor === 'delegated-agent' ? 'agent' : actor))(sulfurActorOf(signedIn)) } : undefined;
  const flags = name === ctx.profileName ? ctx.flags : {};
  let network: ReturnType<typeof describeNetwork> | undefined;
  try { network = describeNetwork(networkSettings(flags, { ...profile, proxy: profileProxy(ctx.store, name, profile) }, ctx.env, ctx.io.cwd)); } catch { network = undefined; }
  return {
    name, current, ...rest, ...(rest.proxy ? { proxy: redactUrl(profileProxy(ctx.store, name, profile)!) } : {}),
    ...(network && Object.keys(network).length ? { network } : {}),
    ...(wallet ? { wallet: { address: wallet.address, source: wallet.source, maxUsdPerDay: wallet.maxUsdPerDay } as Profile['wallet'] } : {}),
    ...(session ? { session: { expiresAt: session.expiresAt, kind: session.kind } } : {}),
  };
}

export const profileAdd: Command<{ name: string; env?: string; cell?: string; use?: boolean }, ProfileView> = {
  name: 'profile add', summary: 'Add a profile: an environment, for one account',
  examples: ['breakrocks config add atlas-dev --env dev --use', 'breakrocks config add scribe --env staging --cell us'],
  input: object({ name: str('The name of the profile', { pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' }), env: envSchema, cell: str('The home cell, when known (eu, us)', { pattern: '^[a-z]{2}$' }), use: bool('Make it the current profile') }, ['name']),
  output: profileOutput, args: { positionals: ['name'] }, offline: true,
  run: (ctx, { name, env, cell, use }) => {
    checkProfileName(name);
    if (ctx.store.profile(name)) throw usageError('PROFILE_EXISTS', `The profile "${name}" exists`, { profile: name });
    const profile: Profile = { env: (env ?? ctx.flags.env ?? 'prod') as Profile['env'], ...(cell ? { cell } : {}) };
    ctx.store.saveProfile(name, profile);
    if (use) ctx.store.setCurrent(name);
    return view(ctx, name, profile);
  },
  quiet: (r) => r.name,
};

export const profileUse: Command<{ name: string }, ProfileView> = {
  name: 'profile use', summary: 'Make a profile the current one', examples: ['breakrocks config use atlas-dev'],
  description: 'Not an MCP tool: the MCP server acts with the profile it started with and opens no session for another account.',
  input: object({ name: str('The profile') }, ['name']), output: profileOutput, args: { positionals: ['name'] }, offline: true, mcp: false,
  run: (ctx, { name }) => {
    const profile = ctx.store.profile(name);
    if (!profile) throw usageError('PROFILE_NOT_FOUND', `No profile "${name}"`, { profile: name });
    ctx.store.setCurrent(name);
    return view(ctx, name, profile);
  },
  quiet: (r) => r.name,
};

export const profileList: Command<Record<string, never>, ProfileView[]> = {
  name: 'profile list', summary: 'List the profiles', examples: ['breakrocks config list', 'breakrocks config list --json --fields name,env,kind'],
  input: object({}), output: { type: 'array', items: profileOutput }, offline: true,
  run: (ctx) => Object.entries(ctx.store.read().profiles).map(([name, p]) => view(ctx, name, p)),
  text: (rows) => (rows.length ? rows.map((r) => `${r.current ? '*' : ' '} ${r.name}  ${r.env}${r.kind ? `  ${r.kind} ${r.agentId ?? r.operatorId ?? r.accountId ?? ''}` : ''}`).join('\n') : 'No profile yet: breakrocks config add <name> --env dev'),
};

export const profileShow: Command<{ name?: string }, ProfileView> = {
  name: 'profile show', summary: 'Show a profile (the one in use by default)', examples: ['breakrocks config show', 'breakrocks config show atlas-dev --json'],
  input: object({ name: str('The profile') }), output: profileOutput, args: { positionals: ['name'] }, offline: true,
  run: (ctx, { name }) => {
    const wanted = name ?? ctx.profileName;
    const profile = wanted === ctx.profileName ? ctx.profile() : ctx.store.profile(wanted);
    if (!profile) throw usageError('PROFILE_NOT_FOUND', `No profile "${wanted}"`, { profile: wanted });
    return view(ctx, wanted, profile);
  },
  quiet: (r) => r.name,
};

export const profileRemove: Command<{ name: string }, { removed: string; keysKept: string[] }> = {
  name: 'profile remove', summary: 'Remove a profile and its session (its key files are kept)',
  description: 'The account itself stays on the platform: deleting it is operator delete. The key files stay in the configuration folder, so that the account can still be signed in.',
  examples: ['breakrocks config remove old-dev --yes'],
  input: object({ name: str('The profile') }, ['name']),
  output: openObject({ removed: str('The profile removed'), keysKept: list('Its key files, kept') }), args: { positionals: ['name'] }, offline: true, interactive: true,
  run: async (ctx, { name }) => {
    const profile = ctx.store.profile(name);
    if (!profile) throw usageError('PROFILE_NOT_FOUND', `No profile "${name}"`, { profile: name });
    if (profile.registration && !profile.operatorId) throw cliRefusal('REGISTRATION_PENDING', `The profile "${name}" holds a registration being paid (${profile.registration.id}): finish it first (operator register)`, { registrationId: profile.registration.id });
    await ctx.confirm(`Remove the profile "${name}"${profile.kind ? ` (${profile.kind} ${profile.agentId ?? profile.operatorId ?? profile.accountId})` : ''}?`);
    ctx.store.removeProfile(name);
    return { removed: name, keysKept: Object.values(profile.keys ?? {}).filter((k): k is string => !!k) };
  },
  quiet: (r) => r.removed,
};

const SETTINGS = ['proxy', 'no-proxy', 'ca-file'] as const;
type Setting = (typeof SETTINGS)[number];
const settingSchema = str('The setting: proxy (http://, https:// or socks5://, credentials allowed), no-proxy (hosts reached directly, as NO_PROXY), ca-file (a PEM bundle)', { enum: [...SETTINGS] });

/** The profile [name] (the one in use by default), saved: a profile not saved yet is made in [env] (prod by default). */
function savedProfile(ctx: Context, name: string | undefined): [string, Profile] {
  const wanted = name ?? ctx.profileName;
  if (ctx.agentName && !name) throw usageError('PROFILE_REQUIRED', 'A local agent has no settings of its own: --name <profile>');
  return [wanted, ctx.store.profile(wanted) ?? { env: ctx.flags.env ?? 'prod' }];
}

export const configSet: Command<{ setting: Setting; value: string; name?: string }, ProfileView> = {
  name: 'config set', summary: 'Set a network setting of a CLI profile',
  details: 'Set the proxy, the hosts reached without it or a CA bundle of a CLI profile (README § Proxy). The proxy of the profile comes after --proxy and before HTTPS_PROXY / HTTP_PROXY; its credentials are kept apart from config.json, in a file for the user alone, and never printed.',
  examples: ['breakrocks config set proxy http://proxy.corp.example:3128', 'breakrocks config set no-proxy localhost,.corp.example', 'breakrocks config set ca-file ./corp-ca.pem --name work'],
  input: object({ setting: settingSchema, value: str('Its value'), name: str('The profile (the one in use by default)') }, ['setting', 'value']),
  output: profileOutput, args: { positionals: ['setting', 'value'] }, offline: true, mcp: false,
  run: (ctx, { setting, value, name }) => {
    const [profileName, profile] = savedProfile(ctx, name);
    let next: Profile;
    if (setting === 'proxy') next = saveProfileProxy(ctx.store, profileName, profile, value);
    else if (setting === 'no-proxy') next = { ...profile, noProxy: value };
    else {
      const file = resolve(ctx.io.cwd, value);
      if (!existsSync(file)) throw usageError('CA_FILE_NOT_FOUND', `No CA bundle at ${file}`, { caFile: file });
      next = { ...profile, caFile: file };
    }
    ctx.store.saveProfile(profileName, next);
    return view(ctx, profileName, next);
  },
  quiet: (r) => r.name,
};

export const configUnset: Command<{ setting: Setting; name?: string }, ProfileView> = {
  name: 'config unset', summary: 'Remove a network setting of a CLI profile',
  examples: ['breakrocks config unset proxy', 'breakrocks config unset ca-file --name work'],
  input: object({ setting: settingSchema, name: str('The profile (the one in use by default)') }, ['setting']),
  output: profileOutput, args: { positionals: ['setting'] }, offline: true, mcp: false,
  run: (ctx, { setting, name }) => {
    const [profileName, profile] = savedProfile(ctx, name);
    let next: Profile;
    if (setting === 'proxy') next = saveProfileProxy(ctx.store, profileName, profile, undefined);
    else { const { [setting === 'no-proxy' ? 'noProxy' : 'caFile']: _gone, ...rest } = profile; next = rest; }
    ctx.store.saveProfile(profileName, next);
    return view(ctx, profileName, next);
  },
  quiet: (r) => r.name,
};
