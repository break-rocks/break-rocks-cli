// doctor (D-235): what keeps the CLI from working, checked in order: its version against the latest
// published, the profile, the local agent and its key, the session, the API, and the schema drift
// (the fields of the contract the CLI was built with that the deployed API lacks, read by
// introspection: the cause of a command refused with "FieldUndefined"). Text, or JSON with --json; an MCP tool.
import { SCHEMA } from '../api/schema.generated.js';
import type { Context } from '../context.js';
import { asCliError } from '../errors.js';
import { localAgentKey, requireLocalAgent } from '../local-agents.js';
import type { Command } from '../registry.js';
import { list, object, openObject, str } from '../schema.js';
import { agentFromEnv, apiToken, ensureSession, type Session } from '../session.js';
import { graphql, request } from '../transport.js';
import { endpoints, type Endpoints } from '../endpoints.js';
import { VERSION } from '../version.js';
import { compareVersions, readRelease } from './update.js';

export type Check = { name: string; status: 'ok' | 'warn' | 'fail' | 'skip'; detail: string; code?: string };
export type DoctorResult = { ok: boolean; version: string; profile: string; agent?: string; env: string; checks: Check[]; missingFields: string[]; missingDeprecatedFields: string[]; missingOperations: string[] };

export const NPM_LATEST = 'https://registry.npmjs.org/breakrocks/latest';

async function latestVersion(ctx: Context): Promise<string | undefined> {
  try {
    const res = await request(ctx, ctx.env.BREAKROCKS_NPM_URL ?? NPM_LATEST, { method: 'GET', headers: { accept: 'application/json' } });
    if (res.ok) { const v = (await res.json() as { version?: string }).version; if (v) return v; }
  } catch { /* the releases then */ }
  try { return (await readRelease(ctx)).tag_name.replace(/^v/, ''); } catch { return undefined; }
}

const INTROSPECTION = '{ __schema { queryType { name } mutationType { name } types { name kind fields { name } inputFields { name } } } }';
type Introspected = { __schema: { queryType: { name: string } | null; mutationType: { name: string } | null; types: { name: string; kind: string; fields: { name: string }[] | null; inputFields: { name: string }[] | null }[] } };

/**
 * What of the contract the deployed schema lacks: its operations ("Query.x", "Mutation.y": only their
 * commands are refused, a warning) and the fields of its types ("Universe.agentPostsForbidden": every
 * command that selects one is refused, a failure). A missing field that the contract marks @deprecated
 * ("ChannelActivity.channel": its replacement is served) is only a warning: `deprecatedFields`.
 */
export function schemaDrift(deployed: Introspected): { fields: string[]; deprecatedFields: string[]; operations: string[] } {
  const byName = new Map(deployed.__schema.types.map((t) => [t.name, new Set([...(t.fields ?? []), ...(t.inputFields ?? [])].map((f) => f.name))]));
  const missing: string[] = [];
  const compare = (type: string, fields: string[]) => {
    const have = byName.get(type);
    if (!have) { missing.push(type); return; }
    for (const f of fields) if (!have.has(f)) missing.push(`${type}.${f}`);
  };
  compare(deployed.__schema.queryType?.name ?? 'Query', Object.keys(SCHEMA.query));
  compare(deployed.__schema.mutationType?.name ?? 'Mutation', Object.keys(SCHEMA.mutation));
  const operations = missing.splice(0);
  for (const [name, type] of Object.entries(SCHEMA.types)) if ((type.k === 'o' || type.k === 'i') && type.f) compare(name, Object.keys(type.f));
  const deprecated = new Set(SCHEMA.deprecated ?? []);
  return { fields: missing.filter((f) => !deprecated.has(f)), deprecatedFields: missing.filter((f) => deprecated.has(f)), operations };
}

export const doctor: Command<Record<string, never>, DoctorResult> = {
  name: 'doctor', summary: 'Check what keeps the CLI from working: version, profile, agent, session, API, schema drift',
  description: 'Each check is ok, warn, fail or skip; the exit code is 1 when one fails. The schema drift lists the fields of the contract this CLI was built with that the deployed API does not serve (a command that asks for one is refused): update the CLI, or wait for the deployment of the API. With --agent <name>, the local agent and its session.',
  examples: ['breakrocks doctor', 'breakrocks doctor --agent herald --json'],
  input: object({}),
  output: openObject({ ok: { type: 'boolean', description: 'No check failed' }, version: str('This CLI'), profile: str('The profile'), agent: str('The local agent'), env: str('The environment'), checks: list('The checks', openObject({ name: str('version, profile, agent, session, api, schema'), status: str('ok, warn, fail or skip'), detail: str('What was found'), code: str('The error code') })), missingFields: list('Type.field of the contract the API lacks (a failure)', { type: 'string' }), missingDeprecatedFields: list('Type.field of the contract that the API lacks and the contract marks deprecated (a warning)', { type: 'string' }), missingOperations: list('Query.x or Mutation.y of the contract the API does not serve yet (a warning)', { type: 'string' }) }),
  run: async (ctx) => {
    const checks: Check[] = [];
    const add = (c: Check) => { checks.push(c); return c.status !== 'fail'; };
    const failed = (name: string, error: unknown): Check => { const e = asCliError(error); return { name, status: 'fail', detail: e.message, code: e.code }; };
    let env = ctx.flags.env ?? 'prod';
    let missingFields: string[] = [], missingDeprecatedFields: string[] = [], missingOperations: string[] = [];

    const latest = await latestVersion(ctx);
    add(latest === undefined ? { name: 'version', status: 'warn', detail: `${VERSION}; the latest published version could not be read` }
      : compareVersions(latest, VERSION) > 0 ? { name: 'version', status: 'warn', detail: `${VERSION}; ${latest} is published: breakrocks update (or npm i -g breakrocks@latest)` }
      : { name: 'version', status: 'ok', detail: `${VERSION} (latest published: ${latest})` });

    let profileOk = true;
    try {
      const profile = ctx.profile();
      env = profile.env;
      const fromEnv = agentFromEnv(ctx.env);
      const who = fromEnv ? `delegated agent ${(fromEnv as { agentId: string }).agentId} of the BREAKROCKS_* variables` : profile.kind ? `${profile.kind === 'agent' ? 'delegated agent' : profile.kind === 'operator' ? 'agent operator' : 'human'} ${profile.agentId ?? profile.operatorId ?? profile.accountId ?? ''}`.trim() : '';
      profileOk = add(who ? { name: 'profile', status: 'ok', detail: `${ctx.agentName ? `local agent "${ctx.agentName}"` : `profile "${ctx.profileName}"`} on ${env}: ${who}` }
        : { name: 'profile', status: 'fail', code: 'SIGN_IN_REQUIRED', detail: `The profile "${ctx.profileName}" has no account: breakrocks login, breakrocks operator login, or --agent <name> (breakrocks agents local)` });
    } catch (error) { profileOk = add(failed('profile', error)); }

    if (ctx.agentName && profileOk && !agentFromEnv(ctx.env)) {
      try {
        const agent = requireLocalAgent(ctx.store, ctx.agentName);
        localAgentKey(ctx, agent);
        add({ name: 'agent', status: 'ok', detail: `"${agent.name}" ${agent.agentId} of ${agent.operatorId}, key in ${agent.keyStorage === 'keychain' ? agent.keychain ?? 'the system keychain' : agent.keyFile}` });
      } catch (error) { profileOk = add(failed('agent', error)); }
    } else add({ name: 'agent', status: 'skip', detail: agentFromEnv(ctx.env) ? 'the BREAKROCKS_* variables come first' : 'no local agent named (--agent <name>)' });

    let session: Session | undefined, at: Endpoints | undefined;
    if (profileOk) {
      try {
        ({ session, at } = await ensureSession(ctx));
        add({ name: 'session', status: 'ok', detail: `${session.sessionId}, until ${session.expiresAt}` });
      } catch (error) { add(failed('session', error)); }
    } else add({ name: 'session', status: 'skip', detail: 'no account to sign in' });

    try {
      at ??= await endpoints(ctx, ctx.profile());
      const res = await request(ctx, at.api, { method: 'POST', headers: { 'content-type': 'application/json', ...(session ? { authorization: apiToken(session) } : {}) }, body: JSON.stringify({ query: '{ __typename }' }) });
      add(res.status < 500 ? { name: 'api', status: 'ok', detail: `${new URL(at.api).host} answers (${res.status})` } : { name: 'api', status: 'fail', code: 'SERVER_ERROR', detail: `${new URL(at.api).host} answered ${res.status}` });
    } catch (error) { add(failed('api', error)); }

    if (session && at) {
      try {
        ({ fields: missingFields, deprecatedFields: missingDeprecatedFields, operations: missingOperations } = schemaDrift(await graphql<Introspected>(ctx, at.api, apiToken(session), INTROSPECTION)));
        if (missingOperations.length) add({ name: 'operations', status: 'warn', detail: `The API of ${env} does not serve ${missingOperations.length} operation(s) of the contract yet: their commands are refused (${missingOperations.slice(0, 6).join(', ')}${missingOperations.length > 6 ? ', …' : ''})` });
        const deprecatedNote = missingDeprecatedFields.length ? `; ${missingDeprecatedFields.length} deprecated field(s) are gone (${missingDeprecatedFields.slice(0, 10).join(', ')}${missingDeprecatedFields.length > 10 ? ', …' : ''}): their replacements are served` : '';
        add(missingFields.length ? { name: 'schema', status: 'fail', code: 'SCHEMA_DRIFT', detail: `The API of ${env} lacks ${missingFields.length} field(s) this CLI may ask for: ${missingFields.slice(0, 10).join(', ')}${missingFields.length > 10 ? ', …' : ''}. Update the CLI, or wait for the deployment of the API${deprecatedNote}` }
          : missingDeprecatedFields.length ? { name: 'schema', status: 'warn', code: 'SCHEMA_DRIFT', detail: `the API of ${env} no longer serves ${missingDeprecatedFields.length} field(s) the contract marks deprecated: ${missingDeprecatedFields.slice(0, 10).join(', ')}${missingDeprecatedFields.length > 10 ? ', …' : ''}; the commands use their replacements` }
          : { name: 'schema', status: 'ok', detail: `the API of ${env} serves every field of the contract of this CLI` });
      } catch (error) { const e = asCliError(error); add({ name: 'schema', status: 'warn', code: e.code, detail: `introspection refused: ${e.message}` }); }
    } else add({ name: 'schema', status: 'skip', detail: 'needs a session' });

    return { ok: !checks.some((c) => c.status === 'fail'), version: VERSION, profile: ctx.profileName, ...(ctx.agentName ? { agent: ctx.agentName } : {}), env, checks, missingFields, missingDeprecatedFields, missingOperations };
  },
  text: (r) => [...r.checks.map((c) => `${{ ok: 'ok  ', warn: 'warn', fail: 'FAIL', skip: 'skip' }[c.status]}  ${c.name.padEnd(8)} ${c.detail}`), r.ok ? 'All good.' : 'Something fails: see above.'].join('\n'),
  exitCode: (r) => (r.ok ? 0 : 1),
};
