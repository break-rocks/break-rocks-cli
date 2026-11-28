// Specs v87.4.0 to v101.1.0: the appearance editor (looks, palette, build, apply; an image sent then waited for) and
// the tags of a universe (conventions, suggestions, the view of a universe and a tag). Against a scripted API.
import { describe, expect, it } from 'vitest';
import { last } from './helpers.js';
import { scripted } from './scripted.js';


describe('the appearance editor', () => {
  it('reads the looks of quick start', async () => {
    const { h, calls } = scripted({ appearanceLooks: [{ theme: { universe: '%root', name: 'stade' }, name: 'Stadium', collection: 'SPORT', character: 'STAGE', layout: 'hud', accent: '#A8432C' }] });
    expect(await h.run('appearance', 'looks', '--collection', 'SPORT')).toBe(0);
    expect(calls[0].variables).toEqual({ collection: 'SPORT' });
    expect(h.lines.at(-1)).toBe('%root/stade  Stadium  SPORT  STAGE  hud  #A8432C');
  });

  it('builds an appearance from its gestures (imageShows, focal point, character), nothing stored', async () => {
    const { h, calls } = scripted({ buildUniverseAppearance: { document: '{"format":"break-rocks-theme/2"}', imageShows: 'THROUGH', nameSide: 'START', contrast: { accentAsked: '#11707A', accentDay: '#11707A', accentNight: '#5FB7C0', adjustments: [] } } });
    expect(await h.run('appearance', 'build', '%paris', '--image-id', 'img1', '--focal', '0.3,0.6', '--image-shows', 'THROUGH', '--character', 'AGORA', '--accent', '#11707A')).toBe(0);
    expect(calls[0].variables).toEqual({ universe: '%paris', input: { imageId: 'img1', focalPoint: { x: 0.3, y: 0.6 }, imageShows: 'THROUGH', character: 'AGORA', accent: '#11707A' } });
    expect(calls[0].query).not.toContain('ground');
    expect(h.lines.at(-1)).toContain('image shows: THROUGH\nname side: START');
    expect(await h.run('appearance', 'build', '%paris', '--focal', '2,0', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'APPEARANCE_FOCAL_POINT_INVALID' } });
  });
  it('applies it at once, or files a proposal; --dry-run sends nothing', async () => {
    const { h, calls } = scripted({ applyUniverseAppearance: (v: Record<string, unknown>) => (v.propose ? { theme: null, proposal: { id: 'pr1', status: 'OPEN' }, contrast: {} } : { theme: { universe: '%team.', name: 'appearance', version: 4 }, proposal: null, contrast: {} }) });
    expect(await h.run('appearance', 'apply', '%team.', '--image-id', 'img1', '--character', 'GALLERY')).toBe(0);
    expect(h.lines.at(-1)).toBe('%team./appearance v4 applied');
    expect(await h.run('appearance', 'apply', '%paris', '--image-id', 'img1', '--propose', '--title', 'A new sky')).toBe(0);
    expect(calls[1].variables).toMatchObject({ universe: '%paris', propose: true, title: 'A new sky', input: { imageId: 'img1' } });
    expect(h.lines.at(-1)).toBe('proposal pr1 filed (OPEN)');
    expect(await h.run('appearance', 'apply', '%paris', '--image', 'sky.png', '--dry-run', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ dryRun: true, operation: 'applyUniverseAppearance', variables: { input: { imageId: '(sky.png: sent on the real run)' } } });
    expect(calls).toHaveLength(2);
  });
});

describe('the tags of a universe', () => {
  it('sets and clears the tag conventions, reads the suggestions and the view of a universe and a tag', async () => {
    const { h, calls } = scripted({
      setUniverseTagConventions: (v: Record<string, unknown>) => ({ name: '%paris', tagConventions: v.tags }), universeTagSuggestions: ['marche', 'velo'],
      universeTagView: { items: [{ createdAt: '2026-11-08T10:00:00.000Z', universeEvent: null, proposal: null, mapRoute: { id: 'rt1', name: 'Market loop' } }], next: null },
    });
    expect(await h.run('universes', 'tags', 'conventions', '%paris', '#marche', 'velo')).toBe(0);
    expect(calls[0].variables).toMatchObject({ universe: '%paris', tags: ['marche', 'velo'] });
    expect(h.lines.at(-1)).toBe('%paris: #marche #velo');
    expect(await h.run('universes', 'tags', 'conventions', '%paris', '--none')).toBe(0);
    expect(calls[1].variables).toMatchObject({ tags: [] });
    expect(await h.run('universes', 'tags', 'conventions', '%paris', '--json')).toBe(2);
    expect(await h.run('universes', 'tags', 'suggestions', '%paris')).toBe(0);
    expect(h.lines.at(-1)).toBe('#marche #velo');
    expect(await h.run('universes', 'tags', 'view', '%paris#market')).toBe(0);
    expect(calls.at(-1)!.variables).toEqual({ universe: '%paris', tag: 'market' });
    expect(h.lines.at(-1)).toBe('2026-11-08T10:00:00.000Z  route rt1  Market loop');
    expect(await h.run('universes', 'tags', 'view', '%paris', 'market', '--json')).toBe(0);
    expect(calls.at(-1)!.variables).toEqual({ universe: '%paris', tag: 'market' });
  });
});
