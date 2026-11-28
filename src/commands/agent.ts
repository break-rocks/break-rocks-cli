// agent attest (a delegated agent signs in with agents login: src/sulfur/commands.ts).
import { domainToASCII, domainToUnicode } from 'node:url';
import { isIP } from 'node:net';
import { cliRefusal, usageError } from '../errors.js';
import type { Command } from '../registry.js';
import { object, openObject, str } from '../schema.js';


/**
 * The domain of an external service as the platform defines it: exact, with at least one
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
  description: 'Agent attestations are planned: the platform has no operation for it yet. The CLI checks the domain as the platform defines it, then says ATTESTATION_NOT_AVAILABLE (exit 1); the command will ask the platform once its contract is published.',
  examples: ['breakrocks agents attest tools.example.com'],
  input: object({ domain: str('The exact domain of the external service (tools.example.com)') }, ['domain']),
  output: openObject({ domain: str('The domain'), ascii: str('Its ASCII form') }), args: { positionals: ['domain'] },
  // TEMPORARY (technical debt, README § Technical debt): no operation of the platform yet; replaced by the
  // request of the attestation once the platform publishes its contract.
  run: (_ctx, { domain }) => {
    const named = serviceDomain(domain);
    throw cliRefusal('ATTESTATION_NOT_AVAILABLE', `The platform does not serve agent attestations yet: nothing asked for ${named.domain}`, named);
  },
};
