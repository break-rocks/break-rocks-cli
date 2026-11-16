// look appearance show: the appearance applied to a universe, resolved as the apps draw it, each value with its origin
// (set, theme, trial, country, default). The resolution alone, then the command against a scripted API (text and JSON),
// the default action of the group and the help of the gallery.
import { describe, expect, it } from 'vitest';
import { appearanceText, defaultColors, resolveAppearance, type AppearanceReads, type ServedTheme } from '../src/theme/appearance.js';
import { plain } from '../src/colour.js';
import { last } from './helpers.js';
import { scripted } from './scripted.js';

const palette = (primary: string, background = '#FFFFFF') => ({ palette: { background, surface: '#F4F5F7', text: '#14171C', primary, accent: '#0067B8', link: '#0057A0' } });
const doc = (o: Record<string, unknown> = {}, title = 'Montserrat', primary = '#1F5FD6') => JSON.stringify({ format: 'break-rocks-theme/2', typography: { title }, variants: { day: palette(primary), night: palette('#4C8DFF', '#0E1116') }, ...o });
const slots = { page: { url: 'https://m.test/p', urlNight: 'https://m.test/pn', removed: false }, pageHeader: { url: 'https://m.test/h', urlNight: 'https://m.test/hn', removed: false } };
const system = { id: '0', handle: 'system', kind: 'system' };
const theme = (t: Partial<ServedTheme> & { name: string }): ServedTheme => ({ universe: '%root', version: 1, contrastLevel: 'AA', creator: system, document: doc(), imageSlots: { page: null, pageHeader: null }, ...t });

describe('the resolution of the appearance', () => {
  it('computes the default colors of a universe as the contract tables them', () => {
    expect(defaultColors('%paris')).toEqual({ primary: '#85700B', accent: '#498325', tintDay: '#F4EFD9', tintNight: '#1F1B09' });
    expect(defaultColors('%lyon/velo')).toEqual({ primary: '#B54C3B', accent: '#996517', tintDay: '#FCEAE6', tintNight: '#271512' });
    expect(defaultColors('%france').primary).toBe('#8F55AA');
  });

  it('nothing set: Socle, the default colors, the default layout, sky and image display', () => {
    const a = resolveAppearance({ universe: { name: '%lyon', private: false, themeRef: null }, socle: theme({ name: 'socle', document: doc({}, 'Montserrat', '#1F5FD6') }) });
    expect(a.source).toMatchObject({ kind: 'socle', origin: 'default', theme: { universe: '%root', name: 'socle' } });
    expect(a.accent).toMatchObject({ value: { day: '#B54C3B' }, origin: 'default' });
    expect(a.universeColors?.value.primary).toBe('#B54C3B');
    expect(a.layout).toEqual({ value: 'hud', origin: 'default' });
    expect(a.sky).toEqual({ value: 'COLUMN', origin: 'default' });
    expect(a.imageShows).toMatchObject({ value: 'SUBTLE', origin: 'default' });
    expect(a.image).toMatchObject({ value: { page: null, pageHeader: null }, origin: 'default', note: 'no image' });
    expect(a.logo.value.monogram).toEqual({ initial: 'L', on: '#B54C3B' });
    expect(a.palettes.origin).toBe('default');
    expect(a.typefaces.title).toEqual({ value: 'Montserrat', origin: 'default' });
    expect(a.proposalsPending).toBeNull();
    // A private universe: feed-first.
    expect(resolveAppearance({ universe: { name: '%team.', private: true, themeRef: null } }).layout.value).toBe('feed-first');
  });

  it('a theme applied: every value from the theme, the date of the history and the proposal adopted then', () => {
    const ref = { universe: '%root', name: 'sport-salle', version: 3 };
    const a = resolveAppearance({
      universe: { name: '%club', private: false, field: null, themeRef: ref, themeOf: '%club', layoutRef: { name: 'village-square' } },
      theme: theme({ name: 'sport-salle', version: 3, collection: 'SPORT', document: doc({}, 'Anton', '#3F637E'), imageSlots: slots }),
      appliedLayout: { source: 'UNIVERSE', ref: { name: 'village-square' } },
      history: [{ id: 'h1', setAt: '2026-11-10T12:00:00.000Z', live: true, theme: ref }],
      proposals: [{ id: 'p1', title: 'A gym look', status: 'ADOPTED', kind: 'THEME', endsAt: '2026-11-10T11:59:00.000Z', author: { handle: 'ana' } }, { id: 'p2', status: 'OPEN', kind: 'APPEARANCE' }],
    });
    expect(a.source).toMatchObject({ kind: 'theme', origin: 'theme', inheritedFrom: null, appliedAt: '2026-11-10T12:00:00.000Z', appliedBy: '@ana', proposal: { id: 'p1' } });
    expect(a.accent).toMatchObject({ value: { day: '#3F637E', night: '#4C8DFF' }, origin: 'theme' });
    expect(a.character).toMatchObject({ value: null, origin: 'theme' });
    expect(a.image.value.pageHeader).toEqual({ url: 'https://m.test/h', urlNight: 'https://m.test/hn' });
    expect(a.layout).toMatchObject({ value: 'village-square', origin: 'set' });
    expect(a.proposalsPending).toBe(1);
    expect(a.universeColors).toBeNull();
  });

  it('a built appearance: set in Customize (image, focal point, accent, character, image display, sky)', () => {
    const block = { image: 'up1', focalPoint: { x: 0.3, y: 0.6 }, imageShows: 'through', accent: '#11707A', accentName: 'Lagoon', character: 'AGORA', layout: 'village-square', sky: 'band', look: null };
    const a = resolveAppearance({
      universe: { name: '%paris', private: false, themeRef: { universe: '%paris', name: 'appearance', version: 4 } },
      theme: theme({ universe: '%paris', name: 'appearance', version: 4, updatedAt: '2026-11-12T09:00:00.000Z', document: doc({ appearance: block }, 'Fraunces', '#11707A'), imageSlots: slots }),
    });
    expect(a.source).toMatchObject({ kind: 'built', origin: 'set', appliedAt: '2026-11-12T09:00:00.000Z', appliedBy: null });
    expect(a.accent).toMatchObject({ value: { day: '#11707A', name: 'Lagoon' }, origin: 'set' });
    expect(a.character).toMatchObject({ value: 'AGORA', origin: 'set' });
    expect(a.image).toMatchObject({ value: { uploadId: 'up1', focalPoint: { x: 0.3, y: 0.6 } }, origin: 'set' });
    expect(a.imageShows).toMatchObject({ value: 'THROUGH', origin: 'set' });
    expect(a.sky).toEqual({ value: 'BAND', origin: 'set' });
    expect(a.typefaces.title).toEqual({ value: 'Fraunces', origin: 'set' });
  });

  it('started from a theme of quick start: what equals the theme is the theme, the accent changed on top of it is set', () => {
    const look = { universe: '%root', name: 'sport-stade' };
    const reads: AppearanceReads = {
      universe: { name: '%paris', private: false, themeRef: { universe: '%paris', name: 'appearance-2', version: 2 } },
      theme: theme({ universe: '%paris', name: 'appearance-2', document: doc({ appearance: { image: null, accent: '#A8432C', character: 'STAGE', look } }, 'Bebas Neue', '#A8432C'), imageSlots: slots }),
      lookTheme: theme({ name: 'sport-stade', document: doc({}, 'Bebas Neue', '#236641') }),
    };
    const a = resolveAppearance(reads);
    expect(a.source).toMatchObject({ kind: 'started-from-theme', look });
    expect(a.accent.origin).toBe('set');
    expect(a.character).toMatchObject({ value: 'STAGE', origin: 'theme' });
    expect(a.image.origin).toBe('theme');
  });

  it('a trial in progress: the draft for every reader, until its end, by whom, its layout', () => {
    const a = resolveAppearance({
      universe: {
        name: '%paris', private: false, themeRef: { universe: '%root', name: 'universel-ciel', version: 1 },
        themeTrial: { draftId: 'd1', version: 2, startedAt: '2026-11-16T08:00:00.000Z', endsAt: '2026-11-17T08:00:00.000Z', startedBy: { handle: 'ana' }, layout: 'feed-first', document: doc({ appearance: { accent: '#5A2E5E', character: 'GALLERY', sky: 'band' }, imageSlots: { page: { day: 'up9' } } }, 'Figtree', '#5A2E5E') },
      },
      theme: theme({ name: 'universel-ciel', imageSlots: slots }),
    });
    expect(a.source).toMatchObject({ kind: 'trial', origin: 'trial' });
    expect(a.trial).toMatchObject({ draftId: 'd1', endsAt: '2026-11-17T08:00:00.000Z', startedBy: 'ana', layout: 'feed-first', base: { name: 'universel-ciel' } });
    expect(a.accent).toMatchObject({ value: { day: '#5A2E5E' }, origin: 'trial' });
    expect(a.character).toMatchObject({ value: 'GALLERY', origin: 'trial' });
    expect(a.layout).toEqual({ value: 'feed-first', origin: 'trial' });
    expect(a.sky).toEqual({ value: 'BAND', origin: 'trial' });
    expect(a.image.value).toMatchObject({ page: { url: null }, pageHeader: null, uploadId: 'up9' });
    expect(a.universeColors).toBeNull();
  });

  it('a country universe: its country theme; the universal and field themes are given by the platform', () => {
    const country = resolveAppearance({ universe: { name: '%france', private: false, themeRef: { universe: '%france', name: 'pays-france', version: 1 }, themeOf: '%france' }, theme: theme({ universe: '%france', name: 'pays-france', document: doc({}, 'Playfair Display', '#5C6094') }) });
    expect(country.source).toMatchObject({ kind: 'country', origin: 'country', inheritedFrom: null });
    expect(country.accent).toMatchObject({ value: { day: '#5C6094' }, origin: 'country' });
    expect(country.palettes.origin).toBe('country');
    const universal = resolveAppearance({ universe: { name: '%lyon', private: false, themeRef: { universe: '%root', name: 'universel-eau', version: 1 } }, theme: theme({ name: 'universel-eau' }) });
    expect(universal.source).toMatchObject({ kind: 'universal', origin: 'default' });
    expect(universal.universeColors?.value.primary).toBe('#B54C3B');
    const field = resolveAppearance({ universe: { name: '%club', private: false, field: 'SPORT', themeRef: { universe: '%root', name: 'sport-stade' } }, theme: theme({ name: 'sport-stade', collection: 'SPORT', document: doc({}, 'Bebas Neue') }), appliedLayout: { source: 'FIELD', of: 'SPORT', ref: { name: 'hud' } } });
    expect(field.source.kind).toBe('field');
    expect(field.character).toMatchObject({ value: 'STAGE', origin: 'default' });
    expect(field.layout).toMatchObject({ value: 'hud', origin: 'default', note: 'the field layout of SPORT' });
  });
});

describe('look appearance show', () => {
  const answers = {
    universe: { name: '%lyon', exists: true, private: false, field: null, themeRef: { universe: '%root', name: 'universel-eau', version: 1, deleted: false }, themeOf: '%lyon', themeHeldVersion: null, layoutRef: null, layoutOf: null, image: null, imageOf: null, themeTrial: null, myDraftPreview: null },
    theme: (v: { n: string }) => theme({ name: v.n, imageSlots: slots }),
    appliedLayout: { source: 'PLATFORM', of: null, ref: { universe: '%root', name: 'hud', version: 1 } },
    universeAppearanceHistory: null,
    proposals: (v: { k: string }) => ({ items: v.k === 'APPEARANCE' ? [{ id: 'p1', status: 'WAITING_SUPPORT', kind: 'APPEARANCE' }] : [] }),
  };

  it('prints the appearance applied, each value with its origin; the group without an action runs it', async () => {
    const { h, calls } = scripted(answers);
    expect(await h.run('look', 'appearance', 'show', '%lyon')).toBe(0);
    const text = plain(h.lines.at(-1)!);
    expect(text.split('\n')).toEqual([
      '%lyon: the appearance applied',
      'source: the universal theme, chosen by the platform  [default]',
      '  theme: %root/universel-eau v1',
      'accent: #1F5FD6 (night #4C8DFF)  [default]',
      'character: none  [default]  no appearance character for Montserrat',
      'image:  [default]',
      '  banner (pageHeader): https://m.test/h  night https://m.test/hn',
      '  page: https://m.test/p  night https://m.test/pn',
      'image display: subtle (default)  [default]',
      'layout: hud (default)  [default]  the platform layout',
      'sky: column (default)  [default]',
      'logo: none, the monogram "L" on #1F5FD6  [default]',
      'day palette: background #FFFFFF  surface #F4F5F7  text #14171C  primary #1F5FD6  accent #0067B8  link #0057A0  [default]',
      'night palette: background #0E1116  surface #F4F5F7  text #14171C  primary #4C8DFF  accent #0067B8  link #0057A0  [default]',
      'universe colors: primary #B54C3B  accent #996517  tint day #FCEAE6  tint night #271512  [default]  from its name; kept with a universal theme (contract), the web draws the palette of the theme',
      'typefaces: title Montserrat [default], body Atkinson Hyperlegible [default]',
      'contrast: AA  [default]',
      'proposals pending: 1',
      "history: breakrocks look appearance history '%lyon'",
    ]);
    expect(calls.find((c) => c.field === 'theme')!.variables).toEqual({ u: '%root', n: 'universel-eau', in: '%lyon' });
    const count = calls.length;
    expect(await h.run('look', 'appearance', '%lyon')).toBe(0);
    expect(calls.length).toBeGreaterThan(count);
    expect(plain(h.lines.at(-1)!)).toContain('source: the universal theme, chosen by the platform');
  });

  it('--json: the resolved object, an origin on each field', async () => {
    const { h } = scripted(answers);
    expect(await h.run('look', 'appearance', '%lyon', '--json')).toBe(0);
    expect(last(h)).toMatchObject({
      universe: '%lyon', source: { kind: 'universal', origin: 'default', theme: { name: 'universel-eau' } },
      accent: { origin: 'default' }, layout: { value: 'hud', origin: 'default' }, sky: { value: 'COLUMN', origin: 'default' }, proposalsPending: 1,
    });
    expect(appearanceText(last(h) as never)).toContain('proposals pending: 1');
  });

  it('a universe that does not exist is refused', async () => {
    const { h } = scripted({ universe: { name: '%nowhere', exists: false } });
    expect(await h.run('look', 'appearance', 'show', '%nowhere', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'UNIVERSE_NOT_FOUND' } });
  });

  it('the help: the default action of the group, the gallery is not what is applied', async () => {
    const { h } = scripted();
    expect(await h.run('look', 'appearance')).toBe(0);
    expect(plain(h.lines.at(-1)!)).toContain('Without an action: breakrocks look appearance <universe> runs look appearance show');
    expect(await h.run('look', 'appearance', 'history', '--help')).toBe(0);
    expect(await h.run('look', 'themes', 'gallery', '--help')).toBe(0);
    expect(plain(h.lines.at(-1)!)).toContain('The themes offered in a universe (the gallery), not what is applied: see look appearance show');
  });
});
