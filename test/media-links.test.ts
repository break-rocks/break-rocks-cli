// The links of an image of the media CDN that open (<url>/<width>.webp, the folder alone answers 403), and
// --signed-links on look appearance show and look themes show (scripted API, no network).
import { describe, expect, it } from 'vitest';
import { imageLinks, linkLines, openableLinks, variantUrl } from '../src/theme/media-links.js';
import { plain } from '../src/colour.js';
import { last } from './helpers.js';
import { scripted } from './scripted.js';

const BASE = 'https://media.dev.break.rocks/posts/978d4588-ca3d-5264-bb7c-14be8368cdb7';

describe('the links of an image', () => {
  it('builds the file of a width from the folder', () => {
    expect(variantUrl(BASE, 1080)).toBe(`${BASE}/1080.webp`);
    expect(variantUrl(`${BASE}/`, 160)).toBe(`${BASE}/160.webp`);
  });

  it('the 1080 (or the smallest wider, else the largest) and the largest, public: expiresAt null', () => {
    expect(openableLinks(BASE, [2160, 160, 480, 1080])).toEqual([
      { variant: 'day', width: 1080, url: `${BASE}/1080.webp`, expiresAt: null },
      { variant: 'day', width: 2160, url: `${BASE}/2160.webp`, expiresAt: null },
    ]);
    expect(openableLinks(BASE, [160, 1440, 2160]).map((l) => l.width)).toEqual([1440, 2160]);
    expect(openableLinks(BASE, [160, 480]).map((l) => l.width)).toEqual([480]);
    expect(openableLinks(BASE, [1080, 1080]).map((l) => l.width)).toEqual([1080]);
  });

  it('without widths, the URL is a file already; without a URL, nothing', () => {
    expect(openableLinks('https://m/s.webp', [])).toEqual([{ variant: 'day', width: null, url: 'https://m/s.webp', expiresAt: null }]);
    expect(openableLinks(null, [1080])).toEqual([]);
  });

  it('day then night, the night not repeated when it is the day image; in text', () => {
    const links = imageLinks({ url: 'https://m/d', urlNight: 'https://m/n', widths: [480, 2160], widthsNight: [480] });
    expect(links.map((l) => [l.variant, l.url])).toEqual([['day', 'https://m/d/2160.webp'], ['night', 'https://m/n/480.webp']]);
    expect(imageLinks({ url: 'https://m/d', urlNight: 'https://m/d', widths: [480], widthsNight: [480] })).toHaveLength(1);
    expect(linkLines(imageLinks({ url: 'https://m/d', urlNight: 'https://m/n', widths: [1080, 2160], widthsNight: [1080, 2160] }))).toEqual([
      'https://m/d/1080.webp', 'largest https://m/d/2160.webp', 'night https://m/n/1080.webp', 'night largest https://m/n/2160.webp',
    ]);
  });
});

describe('--signed-links', () => {
  const W = [160, 480, 1080, 2160];
  const slots = { page: { url: BASE, urlNight: null, widths: W, widthsNight: [], removed: false }, pageHeader: null };
  const theme = { universe: '%root', name: 'universel-eau', version: 1, contrastLevel: 'AA', document: '{}', imageSlots: slots };
  const answers = {
    universe: { name: '%lyon', exists: true, private: false, field: null, themeRef: { universe: '%root', name: 'universel-eau', version: 1, deleted: false }, themeOf: '%lyon', themeHeldVersion: null, layoutRef: null, layoutOf: null, image: { url: 'https://m/logo', widths: [480] }, imageOf: null, themeTrial: null, myDraftPreview: null },
    theme, appliedLayout: null, universeAppearanceHistory: null, proposals: { items: [] },
  };

  it('look appearance show: the links that open by default; the option says the API gives none', async () => {
    const { h, calls } = scripted(answers);
    expect(await h.run('look', 'appearance', 'show', '%lyon')).toBe(0);
    let text = plain(h.lines.at(-1)!);
    expect(text).toContain(`  page: ${BASE}/1080.webp\n    largest ${BASE}/2160.webp`);
    expect(text).toContain('logo: https://m/logo/480.webp');
    expect(text).not.toContain('signed links');
    expect(calls.find((c) => c.field === 'theme')!.query).toContain('widths widthsNight');
    expect(await h.run('look', 'appearance', 'show', '%lyon', '--signed-links')).toBe(0);
    text = plain(h.lines.at(-1)!);
    expect(text.split('\n').at(-1)).toBe('signed links: not available. The API has no operation that gives a time-limited link to a media; the links shown are public and do not expire.');
    expect(await h.run('look', 'appearance', 'show', '%lyon', '--signed-links', '--json')).toBe(0);
    expect(last(h)).toMatchObject({
      image: { value: { page: { url: BASE, links: [{ width: 1080, url: `${BASE}/1080.webp`, expiresAt: null }, { width: 2160, expiresAt: null }] } } },
      logo: { value: { links: [{ url: 'https://m/logo/480.webp', expiresAt: null }] } },
      signedLinks: { available: false },
    });
  });

  it('look themes show: the links under each image slot; the option in text and JSON', async () => {
    const { h } = scripted(answers);
    expect(await h.run('look', 'themes', 'show', '%root/universel-eau', '--json')).toBe(0);
    const out = last(h) as { imageSlots: { page: { links: unknown[] } }; signedLinks?: unknown };
    expect(out.imageSlots.page.links).toEqual([
      { variant: 'day', width: 1080, url: `${BASE}/1080.webp`, expiresAt: null }, { variant: 'day', width: 2160, url: `${BASE}/2160.webp`, expiresAt: null },
    ]);
    expect(out.signedLinks).toBeUndefined();
    expect(await h.run('look', 'themes', 'show', '%root/universel-eau', '--signed-links')).toBe(0);
    const text = plain(h.lines.at(-1)!);
    expect(text).toContain(`day ${BASE}/1080.webp (160, 480, 1080, 2160)`);
    expect(text).toContain('  signed links: not available.');
  });
});
