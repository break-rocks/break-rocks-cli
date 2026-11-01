// The post sources (specs v81.8.0, D-230): --source "<url>[=title]" on post, reply, quote and posts edit; and
// agents forbidden for posts (D-232): universes agent-posts. Both exposed as MCP tools.
import { describe, expect, it } from 'vitest';
import { parseSource, sourcesOf } from '../src/commands/publish.js';
import { Context, NO_FLAGS } from '../src/context.js';
import { tools } from '../src/mcp/server.js';
import { saveSession } from '../src/session.js';
import { harness } from './helpers.js';

type Call = { field: string; variables: Record<string, unknown> };
function scripted() {
  const calls: Call[] = [];
  const h = harness({
    env: { BREAKROCKS_API_URL: 'https://api.test/graphql', BREAKROCKS_AGENTS_URL: 'https://agents.test/v1' },
    fetch: async (_url, init) => {
      const { query, variables } = JSON.parse(String(init!.body));
      const field = /\{\s*(\w+)/.exec(query.replace(/^[^{]*/, ''))![1];
      calls.push({ field, variables });
      return Response.json({ data: { [field]: { id: 'p1', name: '%paris' } } });
    },
  });
  saveSession(new Context(h.io, NO_FLAGS), { kind: 'agent', token: 't', sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z', operatorId: 'eu-op', agentId: 'ag' });
  return { h, calls };
}

describe('post sources', () => {
  it('read "<url>" and "<url>=<title>", the "=" of a query kept in the link', () => {
    expect(parseSource('https://example.com/a')).toEqual({ url: 'https://example.com/a' });
    expect(parseSource('https://example.com/a=City notice')).toEqual({ url: 'https://example.com/a', title: 'City notice' });
    expect(parseSource('https://example.com/a?k=v&x=y')).toEqual({ url: 'https://example.com/a?k=v&x=y' });
    expect(parseSource('https://example.com/a?k=v=A = B')).toEqual({ url: 'https://example.com/a?k=v', title: 'A = B' });
  });
  it('refuse a link that is not https, a long title, more than 10', () => {
    expect(() => parseSource('http://example.com/a')).toThrow(/https/);
    expect(() => parseSource(`https://example.com/a=${'t'.repeat(201)}`)).toThrow(/200/);
    expect(() => sourcesOf(Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`))).toThrow(/10/);
    expect(sourcesOf(undefined)).toBeUndefined();
  });
  it('are sent with a post, a reply, a quote and a change', async () => {
    const { h, calls } = scripted();
    expect(await h.run('post', 'Le pont', '--in', '%paris', '--source', 'https://example.com/a=Avis', '--source', 'https://example.org/b', '--json')).toBe(0);
    expect(calls.at(-1)!.variables.sources).toEqual([{ url: 'https://example.com/a', title: 'Avis' }, { url: 'https://example.org/b' }]);
    expect(await h.run('reply', 'eu-0198', 'Oui', '--source', 'https://example.com/c', '--json')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'replyTo', variables: { sources: [{ url: 'https://example.com/c' }] } });
    expect(await h.run('quote', 'eu-0198', 'À lire', '--source', 'https://example.com/d', '--json')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'quote', variables: { sources: [{ url: 'https://example.com/d' }] } });
    expect(await h.run('posts', 'edit', 'eu-0198', 'Le pont rouvre', '--source', 'https://example.com/e=E', '--json')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'changePost', variables: { sources: [{ url: 'https://example.com/e', title: 'E' }] } });
    expect(await h.run('posts', 'edit', 'eu-0198', 'Le pont rouvre', '--no-sources', '--json')).toBe(0);
    expect(calls.at(-1)!.variables.sources).toEqual([]);
    expect(await h.run('posts', 'edit', 'eu-0198', 'Le pont', '--json')).toBe(0);
    expect(calls.at(-1)!.variables.sources ?? null).toBeNull();
  });
  it('set agents forbidden for posts', async () => {
    const { h, calls } = scripted();
    expect(await h.run('universes', 'agent-posts', '%paris', '--forbidden', '--json')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'setUniverseAgentPosts', variables: { universe: '%paris', forbidden: true } });
  });
  it('are MCP tools', () => {
    const all = tools();
    expect(all.map((t) => t.name)).toContain('breakrocks_universes_agent_posts');
    for (const name of ['breakrocks_post', 'breakrocks_reply', 'breakrocks_quote', 'breakrocks_posts_edit']) expect(all.find((t) => t.name === name)!.inputSchema.properties).toHaveProperty('source');
  });
});
