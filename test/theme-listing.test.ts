import { afterEach, describe, expect, it } from 'vitest';
import { plain, setColour, swatch, truecolorEnabled } from '../src/colour.js';
import { catalogText, commandLine, filledSlots, nextLine, shortCursor, themeText, type CatalogItem } from '../src/theme/listing.js';
import { scripted } from './scripted.js';

const ESC = '\x1b[';
afterEach(() => setColour({ out: false, err: false }));

const doc = (title: string, slots: Record<string, unknown> = {}) => JSON.stringify({
  typography: { title, accent: title }, imageSlots: { cardTexture: null, ...slots },
  variants: { night: { palette: { background: '#0E1116', surface: '#161B22', text: '#F2F4F7', primary: '#4C8DFF', accent: '#4CC2FF', link: '#7CC4FF' } }, day: { palette: { background: '#FCFBF8', surface: '#F4F5F7', text: '#14171C', primary: '#1F5FD6', accent: '#0067B8', link: '#0057A0' } } },
});
const item = (name: string, reason: string, extra: Partial<CatalogItem> = {}): CatalogItem => ({
  theme: { universe: '%root', name, version: 1, collection: null, document: doc('Montserrat', { page: { day: 'a', night: 'b' }, pageHeader: { day: 'c' }, timeColumn: null }) },
  reason, variant: 'NIGHT', palette: ['#0E1116', '#F2F4F7'], screenshots: ['s1', 's2', 's3'], universeCount: 2, accountCount: 0, hasImage: true, starred: false, ...extra,
});
const LINE = "breakrocks look themes gallery '%lyon'";

describe('the theme catalog in text', () => {
  it('names the columns, groups the rows by section and tells a theme of an earlier section once', () => {
    const page = { items: [item('universel-ciel', 'UNIVERSAL'), item('universel-eau', 'UNIVERSAL'), item('sport-stade', 'MOST_USED', { theme: { universe: '%root', name: 'sport-stade', version: 3, collection: 'SPORT', document: doc('Bebas Neue') }, hasImage: false }), item('universel-eau', 'MOST_USED')], next: null };
    expect(catalogText(page, LINE).split('\n')).toEqual([
      '  theme                 ver  field  typeface    images    shots  univ  acct  night palette: background surface text primary accent link',
      'UNIVERSAL (2)',
      '  %root/universel-ciel  v1   -      Montserrat  img 2     3      2     0     #0E1116 #F2F4F7',
      '  %root/universel-eau   v1   -      Montserrat  img 2     3      2     0     #0E1116 #F2F4F7  also in MOST_USED',
      'MOST_USED (2, 1 listed above)',
      '  %root/sport-stade     v3   SPORT  Bebas Neue  no image  3      2     0     #0E1116 #F2F4F7',
    ]);
  });
  it('tells the next page as a command line, the cursor shortened', () => {
    const cursor = 'eyIwIjoiMDAwMDAwMDAwMDAxI3Jvb3QjbGlldXgtdmlsbGUiLCIxIjoiMDAwMDAw';
    expect(shortCursor(cursor)).toBe('eyIwIjoiMDAw…');
    expect(shortCursor('short')).toBe('short');
    expect(catalogText({ items: [item('a', 'UNIVERSAL')], next: cursor }, LINE).split('\n').at(-1)).toBe("more: breakrocks look themes gallery '%lyon' --all  (or --after eyIwIjoiMDAw…; --json holds the full cursor)");
    expect(nextLine(cursor, LINE, { all: true, max: 10 })).toBe("more: breakrocks look themes gallery '%lyon' --all --max 20  (or --after eyIwIjoiMDAw…; --json holds the full cursor)");
    expect(catalogText({ items: [], next: null }, LINE)).toBe('(none)');
    expect(commandLine('themes gallery', { universe: '%lyon', highContrast: true, night: true, after: 'x', all: true, max: 3 }, ['universe'])).toBe("breakrocks look themes gallery '%lyon' --high-contrast --night");
    expect(commandLine('themes list', { order: 'QUICK_START', universe: '%paris', query: "l'eau bleue" }, [])).toBe("breakrocks look themes list --order QUICK_START --universe '%paris' --query 'l'\\''eau bleue'");
  });
  it('counts the image slots filled in the document', () => {
    expect(filledSlots({ imageSlots: { page: { day: 'a' }, pageHeader: null, timeColumn: { day: '' }, channelHeader: 'x', cardTexture: { day: 'y' } } })).toEqual(['page', 'channelHeader']);
    expect(filledSlots({})).toEqual([]);
  });
  it('draws the palette as swatches with FORCE_COLOR=3 or COLORTERM truecolor, the plain text the same', () => {
    const page = { items: [item('universel-ciel', 'UNIVERSAL'), item('universel-ciel', 'MOST_USED')], next: null };
    const flat = catalogText(page, LINE);
    expect(flat).not.toContain(ESC);
    setColour({ out: true, err: false, truecolor: false });
    expect(swatch('#0E1116')).toBe('#0E1116');
    setColour({ out: true, err: false, truecolor: true });
    expect(swatch('#0E1116')).toBe(`${ESC}48;2;14;17;22;97m#0E1116${ESC}39;49m`);
    expect(swatch('#FCFBF8')).toBe(`${ESC}48;2;252;251;248;30m#FCFBF8${ESC}39;49m`);
    expect(swatch('teal')).toBe('teal');
    const coloured = catalogText(page, LINE);
    expect(coloured).toContain(`${ESC}48;2;14;17;22;97m#0E1116${ESC}39;49m`);
    expect(plain(coloured)).toBe(flat);
    expect(truecolorEnabled({ FORCE_COLOR: '3' })).toBe(true);
    expect(truecolorEnabled({ COLORTERM: 'truecolor' })).toBe(true);
    expect(truecolorEnabled({ FORCE_COLOR: '1' })).toBe(false);
  });
  it('through the command: the header and the sections, swatches with FORCE_COLOR=3, the JSON as served', async () => {
    const page = { items: [item('universel-ciel', 'UNIVERSAL'), item('universel-ciel', 'MOST_USED')], next: 'eyIwIjoiMDAwMDAwMDAwMDAx' };
    const { h } = scripted({ themeCatalog: page });
    expect(await h.run('themes', 'gallery', '%lyon')).toBe(0);
    expect(h.lines[0]).toContain('night palette: background surface text primary accent link');
    expect(h.lines[0]).toContain("MOST_USED (1, 1 listed above)\nmore: breakrocks look themes gallery '%lyon' --all");
    expect(await h.run('themes', 'gallery', '%lyon', '--json')).toBe(0);
    expect(h.values.at(-1)).toEqual(page);
    const forced = scripted({ themeCatalog: page });
    forced.h.io.env.FORCE_COLOR = '3';
    expect(await forced.h.run('themes', 'gallery', '%lyon')).toBe(0);
    expect(forced.h.lines[0]).toContain(`${ESC}48;2;14;17;22;97m#0E1116`);
    expect(plain(forced.h.lines[0])).toBe(h.lines[0]);
  });
  it('themes list follows the pages with --all', async () => {
    const { h, calls } = scripted({ themeCatalog: (v: Record<string, unknown>) => (v.after ? { items: [item('b', 'NEWEST')], next: null } : { items: [item('a', 'NEWEST')], next: 'c1' }) });
    expect(await h.run('themes', 'list', '--order', 'NEWEST', '--all', '--json')).toBe(0);
    expect(calls.map((c) => c.variables.after)).toEqual([null, 'c1']);
    expect((h.values.at(-1) as { items: CatalogItem[] }).items.map((x) => x.theme.name)).toEqual(['a', 'b']);
  });
});

describe('the page of a theme in text', () => {
  const theme = {
    universe: '%root', name: 'universel-eau', version: 1, description: 'Une eau calme.', collection: null, official: false, contrastLevel: 'AA',
    creator: { handle: 'system' }, typography: { title: 'Montserrat' }, universeCount: 2, accountCount: 0, createdAt: '2026-10-27T05:59:11.976Z', updatedAt: '2026-10-27T05:59:11.976Z',
    document: doc('Montserrat', { page: { day: 'a', night: 'b' }, pageHeader: { day: 'c' }, timeColumn: { day: 'd' } }),
    imageSlots: { page: { url: 'https://m/p', urlNight: 'https://m/pn', widths: [160, 480], widthsNight: [160], removed: false }, pageHeader: { url: null, urlNight: null, widths: [], widthsNight: [], removed: true } },
    screenshots: ['https://m/s1'], screenshotsDay: ['https://m/d1'], pageScreenshots: { phone: { url: 'https://m/ph', urlNight: 'https://m/phn' }, tablet: null },
  };
  it('tells what it is, its palettes, its slots and screenshots, and how to download them', () => {
    expect(themeText(theme).split('\n')).toEqual([
      '%root/universel-eau v1',
      '  Une eau calme.',
      '  universe       %root',
      '  collection     -',
      '  creator        @system',
      '  created        2026-10-27T05:59:11.976Z  updated 2026-10-27T05:59:11.976Z',
      '  contrast       AA',
      '  typefaces      title Montserrat, accent Montserrat',
      '  used by        2 universes, 0 accounts',
      '  night palette  background #0E1116  surface #161B22  text #F2F4F7  primary #4C8DFF  accent #4CC2FF  link #7CC4FF',
      '  day palette    background #FCFBF8  surface #F4F5F7  text #14171C  primary #1F5FD6  accent #0067B8  link #0057A0',
      '  page image     shows subtle',
      '  images',
      '    page                day https://m/p/480.webp (160, 480)',
      '                        night https://m/pn/160.webp (160)',
      '    pageHeader (banner) removed by the platform team',
      '    timeColumn          in the document, ignored by the platform since specs v99',
      '  screenshots night (1)',
      '    https://m/s1',
      '  screenshots day (1)',
      '    https://m/d1',
      '  page of a universe',
      '    phone   day https://m/ph  night https://m/phn',
      "  download them: breakrocks look themes shots '%root/universel-eau' --out <folder>",
    ]);
  });
  it('labels the palettes as swatches in colour, the plain text the same; --fields still picks the JSON', async () => {
    const flat = themeText(theme);
    setColour({ out: true, err: false, truecolor: true });
    const coloured = themeText(theme);
    expect(coloured).toContain(`background ${ESC}48;2;14;17;22;97m#0E1116${ESC}39;49m`);
    expect(plain(coloured)).toBe(flat);
    setColour({ out: false, err: false });
    const { h } = scripted({ theme });
    expect(await h.run('themes', 'show', '%root/universel-eau', '--fields', 'name,version')).toBe(0);
    expect(h.lines[0]).toBe('name: universel-eau\nversion: 1');
  });
});
