// agent login (C-07) and agent attest: a delegated agent signs in with its key file, or with
// BREAKROCKS_OPERATOR_ID, BREAKROCKS_AGENT_ID and BREAKROCKS_AGENT_KEY (never printed nor stored).
import { domainToASCII, domainToUnicode } from 'node:url';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { endpoints } from '../endpoints.js';
import { cliRefusal, usageError } from '../errors.js';
import { readPrivateKey } from '../keys.js';
import type { Command } from '../registry.js';
import { object, openObject, str } from '../schema.js';
import { agentFromEnv, signIn, type Credentials } from '../session.js';

type LoginResult = { operatorId: string; agentId: string; keySource: 'file' | 'env'; session: { sessionId: string; expiresAt: string } };

export const agentLogin: Command<{ operator?: string; agent?: string; key?: string }, LoginResult> = {
  name: 'agent login', summary: 'Sign in a delegated agent: its auth challenge signed with its private key',
  description: 'With --operator, --agent and --key (a PEM file), the profile becomes the delegated agent\'s (the path of the key kept, never its content). Without them, BREAKROCKS_OPERATOR_ID, BREAKROCKS_AGENT_ID and BREAKROCKS_AGENT_KEY (the PEM itself): nothing is written but the session (1 hour, renewed on its own while the variables are set). The first command an AI agent runs.',
  examples: ['breakrocks --profile herald --env dev agent login --operator <operator id> --agent <agent id> --key herald.pem', 'BREAKROCKS_OPERATOR_ID=… BREAKROCKS_AGENT_ID=… BREAKROCKS_AGENT_KEY="$(cat herald.pem)" breakrocks agent login --env dev'],
  input: object({ operator: str('The account id of the operator'), agent: str('The id of the delegated agent'), key: str('Its private key file (PEM)') }),
  output: openObject({ operatorId: str('The operator'), agentId: str('The delegated agent'), keySource: str('file or env'), session: openObject({ sessionId: str('The session'), expiresAt: str('When it ends') }) }),
  run: async (ctx, { operator, agent, key }) => {
    const given = [operator, agent, key].filter((v) => v !== undefined).length;
    let profile = ctx.profile();
    let credentials: Credentials;
    if (given) {
      if (given !== 3) throw usageError('INVALID_INPUT', '--operator, --agent and --key go together (or none: the variables BREAKROCKS_OPERATOR_ID, BREAKROCKS_AGENT_ID, BREAKROCKS_AGENT_KEY)');
      if (profile.kind === 'operator') throw usageError('PROFILE_HOLDS_OPERATOR', `The profile "${ctx.profileName}" holds an agent operator: sign the agent in another profile (--profile <name>)`, { profile: ctx.profileName });
      const file = resolve(ctx.io.cwd, key!);
      credentials = { kind: 'agent', operatorId: operator!, agentId: agent!, key: readPrivateKey(file, 'The agent key').key, source: 'file' };
      profile = { env: profile.env, ...(profile.cell ? { cell: profile.cell } : {}), kind: 'agent', operatorId: operator, agentId: agent, keys: { agent: file } };
    } else {
      const fromEnv = agentFromEnv(ctx.env);
      if (!fromEnv) throw usageError('INVALID_INPUT', 'Give --operator, --agent and --key, or set BREAKROCKS_OPERATOR_ID, BREAKROCKS_AGENT_ID and BREAKROCKS_AGENT_KEY');
      if (profile.kind === 'operator') throw usageError('PROFILE_HOLDS_OPERATOR', `The profile "${ctx.profileName}" holds an agent operator: use another profile (--profile <name>)`, { profile: ctx.profileName });
      credentials = fromEnv;
    }
    const at = await endpoints(ctx, { ...profile, operatorId: credentials.operatorId });
    const session = await signIn(ctx, at, credentials);
    if (given) ctx.saveProfile({ ...profile, cell: at.cell });
    return { operatorId: credentials.operatorId, agentId: (credentials as { agentId: string }).agentId, keySource: (credentials as { source: 'file' | 'env' }).source, session: { sessionId: session.sessionId, expiresAt: session.expiresAt } };
  },
  quiet: (r) => r.session.sessionId,
};

/**
 * The domain of an external service as agent-attestations.feature names it: exact, with at least one
 * dot, regardless of case and of a final dot, an international domain and its ASCII form the same;
 * IP addresses, "localhost", ports, schemes and paths refused (DOMAIN_INVALID).
 */
export function serviceDomain(input: string): { domain: string; ascii: string } {
  const value = input.trim();
  const refuse = () => usageError('DOMAIN_INVALID', `"${input}" is not the domain of an external service`, { domain: input });
  if (!value || /[/:@?#\s]/.test(value) || isIP(value) || isIP(value.replace(/^\[|\]$/g, ''))) throw refuse();
  const name = value.replace(/\.$/, '');
  const ascii = domainToASCII(name);
  if (!ascii || !ascii.includes('.') || ascii === 'localhost' || ascii.endsWith('.localhost') || ascii.split('.').some((l) => !l || l.length > 63) || /^[\d.]+$/.test(ascii)) throw refuse();
  return { domain: domainToUnicode(ascii), ascii };
}

export const agentAttest: Command<{ domain: string }, { domain: string; ascii: string }> = {
  name: 'agent attest', summary: 'Obtain an agent attestation for an external service (not served by the platform yet)',
  description: 'agent-attestations.feature is @later: the platform has no operation for it yet. The CLI checks the domain as the feature names it, then says ATTESTATION_NOT_AVAILABLE (exit 1); the command will ask the platform once its contract is published.',
  examples: ['breakrocks agent attest tools.example.com'],
  input: object({ domain: str('The exact domain of the external service (tools.example.com)') }, ['domain']),
  output: openObject({ domain: str('The domain'), ascii: str('Its ASCII form') }), args: { positionals: ['domain'] },
  // TEMPORARY (technical debt, README § Dette technique): no operation of the platform yet; replaced by the
  // request of the attestation once agent-attestations.feature leaves @later with its contract.
  run: (_ctx, { domain }) => {
    const named = serviceDomain(domain);
    throw cliRefusal('ATTESTATION_NOT_AVAILABLE', `The platform does not serve agent attestations yet (agent-attestations.feature, @later): nothing asked for ${named.domain}`, named);
  },
};
