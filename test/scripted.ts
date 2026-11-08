// A scripted API (no network): each request answered by the field of its operation from [answers]
// ({ id: "x" } by default), every request kept (its operation, its document, its variables), the
// profile signed in as a delegated agent.
import { Context, NO_FLAGS } from '../src/context.js';
import { saveSession } from '../src/session.js';
import { harness } from './helpers.js';

export type Call = { field: string; query: string; variables: Record<string, unknown> };
export function scripted(answers: Record<string, unknown> = {}, options: { cwd?: string } = {}) {
  const calls: Call[] = [];
  const h = harness({
    env: { BREAKROCKS_API_URL: 'https://api.test/graphql', BREAKROCKS_AGENTS_URL: 'https://agents.test/v1' }, ...options,
    fetch: async (url, init) => {
      if (String(url) !== 'https://api.test/graphql') { calls.push({ field: `POST ${String(url)}`, query: '', variables: {} }); return new Response('', { status: 204 }); }
      const { query, variables } = JSON.parse(String(init!.body));
      const field = /\{\s*(\w+)/.exec(query.replace(/^[^{]*/, ''))![1];
      calls.push({ field, query, variables });
      const answer = answers[field];
      return Response.json({ data: { [field]: typeof answer === 'function' ? answer(variables) : field in answers ? answer : { id: 'x' } } });
    },
  });
  saveSession(new Context(h.io, NO_FLAGS), { kind: 'agent', token: 't', sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z', operatorId: 'eu-op', agentId: 'ag' });
  return { h, calls };
}
export const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
