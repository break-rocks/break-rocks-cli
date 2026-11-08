// Specs v87.4.0 to v101.1.0: the appearance editor (looks, palette, build, apply; an image sent then waited for) and
// the tags of a universe (conventions, suggestions, the view of a universe and a tag). Against a scripted API.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { last } from './helpers.js';
import { scripted } from './scripted.js';

const png = (w: number, h: number) => { const b = Buffer.alloc(64); Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13]).copy(b); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const palette = { colors: ['#11707A', '#F2E8D5'], proposedAccent: '#11707A', names: ['Lagoon', 'Sand'] };

describe('the appearance editor', () => {
  it('reads the looks of quick start', async () => {
    const { h, calls } = scripted({ appearanceLooks: [{ theme: { universe: '%root', name: 'stade' }, name: 'Stadium', collection: 'SPORT', character: 'STAGE', layout: 'hud', accent: '#A8432C' }] });
    expect(await h.run('appearance', 'looks', '--collection', 'SPORT')).toBe(0);
    expect(calls[0].variables).toEqual({ collection: 'SPORT' });
    expect(h.lines.at(-1)).toBe('%root/stade  Stadium  SPORT  STAGE  hud  #A8432C');
  });
  it('sends an image (destination THEME), waits for its processing, and reads its palette', async () => {
    let tries = 0;
    const { h, calls } = scripted({ requestMediaUpload: { id: 'img1', url: 'https://s3.test/i', fields: {} } });
    h.io.fetch = (async (url: string, init: { body: unknown }) => {
      if (url !== 'https://api.test/graphql') { calls.push({ field: `POST ${url}`, query: '', variables: {} }); return new Response(null, { status: 204 }); }
      const { query, variables } = JSON.parse(String(init.body));
      const field = /\{\s*(\w+)/.exec(query.replace(/^[^{]*/, ''))![1];
      calls.push({ field, query, variables });
      if (field === 'requestMediaUpload') return Response.json({ data: { requestMediaUpload: { id: 'img1', url: 'https://s3.test/i', fields: {} } } });
      if (field === 'imagePalette' && tries++ === 0) return Response.json({ data: { imagePalette: null }, errors: [{ errorType: 'IMAGE_NOT_READY', message: 'not ready' }] });
      return Response.json({ data: { [field]: palette } });
    }) as typeof fetch;
    writeFileSync(join(h.io.cwd, 'sky.png'), png(1600, 600));
    expect(await h.run('appearance', 'palette', '--image', 'sky.png')).toBe(0);
    expect(calls.map((c) => c.field)).toEqual(['requestMediaUpload', 'POST https://s3.test/i', 'imagePalette', 'imagePalette', 'imagePalette']);
    expect(calls[0].variables.i).toMatchObject({ kind: 'IMAGE', destination: 'THEME' });
    expect(h.lines.at(-1)).toBe('proposed accent: #11707A\n#11707A  Lagoon\n#F2E8D5  Sand');
    expect(await h.run('appearance', 'palette', 'img1', '--image', 'sky.png', '--json')).toBe(2);
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
