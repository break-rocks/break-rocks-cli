// A scripted API (no network): each request to native-sulfur's /graphql answered by the field of its operation from
// [answers] ({ id: "x" } by default), every request kept (its operation, its document as sent, its variables), the profile
// signed in as a delegated agent (a session of native-sulfur whose token acts for its operator).
import { Context, NO_FLAGS } from '../src/context.js';
import { saveSulfurSession } from '../src/sulfur/session.js';
import { harness } from './helpers.js';

export const SULFUR_TEST_BASE = 'https://sulfur.test';
const jwt = (claims: Record<string, unknown>) => `${Buffer.from('{"alg":"EdDSA"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

export type Call = { field: string; query: string; variables: Record<string, unknown> };
export function scripted(answers: Record<string, unknown> = {}, options: { cwd?: string } = {}) {
  const calls: Call[] = [];
  const h = harness({
    env: { BREAKROCKS_SULFUR_URL: SULFUR_TEST_BASE }, ...options,
    fetch: async (url, init) => {
      if (String(url) !== `${SULFUR_TEST_BASE}/graphql`) { calls.push({ field: `POST ${String(url)}`, query: '', variables: {} }); return new Response(null, { status: 204 }); }
      const { query, variables } = JSON.parse(String(init!.body));
      const field = /\{\s*(?:\w+\s*:\s*)?(\w+)/.exec(query.replace(/^[^{]*/, ''))![1];
      calls.push({ field, query, variables });
      const answer = answers[field];
      return Response.json({ data: { [field]: typeof answer === 'function' ? answer(variables) : field in answers ? answer : { id: 'x' } } });
    },
  });
  const ctx = new Context(h.io, NO_FLAGS);
  saveSulfurSession(ctx, { backend: 'sulfur', env: 'prod', cell: 'eu', accountId: 'eu-op', kind: 'agent', method: 'agent', agentId: 'ag', signedInAt: '2026-10-23T09:00:00.000Z', accessExpiresAt: '2099-01-01T00:00:00.000Z', storage: 'file', access: jwt({ sub: 'eu-op', act: { sub: 'ag' } }) });
  return { h, calls };
}
export const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
