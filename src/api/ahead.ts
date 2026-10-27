// TEMPORARY (technical debt, README § Dette technique): what the API serves ahead of the published
// contract. The contract names them ("Post
// transparency"; § Universe theme trials and draft previews, "names final when the backend publishes
// the schema") but the published schema does not carry them yet; the backend serves
// them in dev (introspected 2026-10-27). Merged with the generated contract (graphql.ts); a test
// fails as soon as the contract carries one of them (test/api.test.ts): remove it from here then.
import type { Sdl } from './sdl.js';

export const AHEAD: Sdl = {
  types: {
    PostTransparency: { k: 'e', v: ['OPAQUE', 'THEME', 'MORE', 'LIQUID'] },
    UniverseThemeTrial: { k: 'o', f: { universe: ['String!'], draftId: ['ID!'], document: ['AWSJSON!'], version: ['Int!'], startedAt: ['AWSDateTime!'], endsAt: ['AWSDateTime!'], startedBy: ['AccountRef!'] } },
    DraftPreview: { k: 'o', f: { universe: ['String!'], draftId: ['ID!'], document: ['AWSJSON!'], version: ['Int!'], endsAt: ['AWSDateTime!'] } },
    StudioDraftServed: { k: 'o', f: { universe: ['String!'], trial: ['Boolean!'], preview: ['Boolean!'], version: ['Int!'], kept: ['Boolean!'], refusal: ['String'] } },
    PersonalTheme: { k: 'o', f: { postTransparency: ['PostTransparency!'] } },
    Universe: { k: 'o', f: { themeTrial: ['UniverseThemeTrial'], myDraftPreview: ['DraftPreview'] } },
    StudioDraft: { k: 'o', f: { served: ['StudioDraftServed'] } },
  },
  query: {},
  mutation: {
    setPersonalTheme: ['PersonalTheme', { postTransparency: 'PostTransparency' }],
    startUniverseThemeTrial: ['UniverseThemeTrial', { draftId: 'ID!' }],
    endUniverseThemeTrial: ['Boolean', { universe: 'String!' }],
    startDraftPreview: ['DraftPreview', { draftId: 'ID!' }],
    endDraftPreview: ['Boolean', { universe: 'String!' }],
  },
};

/** [base] with [ahead]: its new types, the new fields of a type, the new operations and the new arguments of an operation. */
export function withAhead(base: Sdl, ahead: Sdl = AHEAD): Sdl {
  const types = { ...base.types };
  for (const [name, t] of Object.entries(ahead.types)) types[name] = types[name] ? { ...types[name], f: { ...types[name].f, ...t.f } } : t;
  const ops = (kind: 'query' | 'mutation') => {
    const out = { ...base[kind] };
    for (const [name, field] of Object.entries(ahead[kind])) out[name] = out[name] ? [out[name][0], { ...out[name][1], ...field[1] }] : field;
    return out;
  };
  return { types, query: ops('query'), mutation: ops('mutation') };
}
