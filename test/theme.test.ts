import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { imageInfo } from '../src/theme/images.js';
import { checkTheme } from '../src/theme/check.js';
import { themePrompt, fieldOf } from '../src/theme/prompt.js';
import { APPROVED_TYPEFACES } from '../src/theme/typefaces.js';
import { readZip, writeZip, zipEntryBytes } from '../src/theme/zip.js';
import { harness, last } from './helpers.js';

/** The first bytes of a PNG of [w] × [h] (what the check reads), padded to [size] bytes. */
function png(w: number, h: number, size = 64): Buffer {
  const b = Buffer.alloc(Math.max(size, 33));
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13]).copy(b, 0);
  b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
function jpeg(w: number, h: number): Buffer {
  return Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 4, 0, 0, 0xFF, 0xC0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 0, 0, 0, 0xFF, 0xD9]);
}

const theme = () => ({
  format: 'break-rocks-theme/2', universe: '%football', name: 'stade-nuit', description: 'Floodlights', collection: 'SPORT',
  variants: {
    night: { palette: { background: '#0E1116', surface: '#161B22', text: '#F2F4F7', primary: '#E5484D', accent: '#4CC2FF', link: '#7CC4FF' }, surfaces: { postCard: { background: '#1A0F2E', text: '#F2F4F7' } } },
    day: { palette: { background: '#FFFFFF', surface: '#F4F5F7', text: '#14171C', primary: '#C8102E', accent: '#0067B8', link: '#0057A0' } },
  },
  surfaceRadius: { postCard: 'sharp' }, typography: { title: 'Bebas Neue', accent: 'Orbitron' }, gradient: ['#0E1116', '#4CC2FF'], motionAccents: true,
  shape: { radius: 'soft', stroke: 'regular' },
  imageSlots: { page: { day: 'page-day.jpg', night: 'page-night.png' }, pageHeader: { day: 'page-header-day.png' }, timeColumn: null, channelHeader: null, cardTexture: { day: 'card-texture-day.png' } },
  images: { wordmark: null, pattern: null }, stickers: [],
});

function folder(doc: unknown = theme()) {
  const h = harness();
  const dir = join(h.dir, 'theme');
  mkdirSync(dir);
  writeFileSync(join(dir, 'theme.json'), JSON.stringify(doc, null, 2));
  writeFileSync(join(dir, 'page-day.jpg'), jpeg(2160, 1620));
  writeFileSync(join(dir, 'page-night.png'), png(2160, 1620));
  writeFileSync(join(dir, 'page-header-day.png'), png(2160, 720));
  writeFileSync(join(dir, 'card-texture-day.png'), png(1024, 1024));
  return { h, dir, file: join(dir, 'theme.json') };
}

type Report = { ok: boolean; errors: number; warnings: number; problems: { code: string; path: string; severity: string; suggested?: string }[]; images: { place: string; width?: number }[] };
const codes = (r: Report) => r.problems.map((p) => p.code);

describe('theme check', () => {
  it('passes a good theme with its images beside it, exit 0', async () => {
    const { h, file } = folder();
    expect(await h.run('theme', 'check', file, '--json')).toBe(0);
    const r = last<Report>(h);
    expect(r).toMatchObject({ ok: true, errors: 0, format: 'break-rocks-theme/2', name: 'stade-nuit' });
    expect(r.images.map((i) => [i.place, i.width])).toEqual([['page', 2160], ['page', 2160], ['pageHeader', 2160], ['cardTexture', 1024]]);
  });
  it('does not warn of a theme without cardTexture (the cards are transparent by default)', async () => {
    const doc = theme() as { imageSlots: Record<string, unknown> };
    delete doc.imageSlots.cardTexture;
    const { h, file } = folder(doc);
    expect(await h.run('theme', 'check', file, '--json')).toBe(0);
    const r = last<Report>(h);
    expect(r.warnings).toBe(0);
    expect(r.problems.filter((p) => /cardTexture|texture/i.test(p.path))).toEqual([]);
  });
  it('refuses, exit 1, with the codes of the platform', async () => {
    const doc = theme() as Record<string, any>;
    doc.variants.night.surfaces.nope = { text: '#FFFFFF' };
    doc.typography.title = 'Comic Sans';
    doc.scrims = { page: { day: 0.5 } };
    doc.gradient = ['#123456', '#654321'];
    doc.shape.stroke = 'huge';
    doc.imageSlots.timeColumn = { day: 'https://example.com/a.jpg' };
    doc.extra = 1;
    const { h, file } = folder(doc);
    expect(await h.run('theme', 'check', file, '--json')).toBe(1);
    const r = last<Report>(h);
    expect(r.ok).toBe(false);
    expect(codes(r)).toEqual(expect.arrayContaining(['THEME_SURFACE_UNKNOWN', 'THEME_TYPEFACE_NOT_APPROVED', 'THEME_SCRIMS_COMPUTED', 'THEME_GRADIENT_INVALID', 'THEME_STROKE_INVALID', 'THEME_EXTERNAL_RESOURCE', 'THEME_FORMAT_INVALID']));
  });
  it('refuses a missing file, more than 8 images, an image that is no JPEG/PNG/WebP; warns of a banner that is not 3:1', async () => {
    const doc = theme() as Record<string, any>;
    doc.imageSlots.timeColumn = { day: 'time-column-day.jpg', night: 'tc-night.jpg' };
    doc.imageSlots.channelHeader = { day: 'ch.jpg', night: 'ch-night.jpg' };
    doc.images.wordmark = 'wordmark.png';
    const { h, dir, file } = folder(doc);
    writeFileSync(join(dir, 'page-header-day.png'), png(1200, 400));
    writeFileSync(join(dir, 'card-texture-day.png'), Buffer.from('GIF89a\x10\x00\x10\x00'));
    expect(await h.run('theme', 'check', file, '--json')).toBe(1);
    const r = last<Report>(h);
    expect(codes(r)).toEqual(expect.arrayContaining(['THEME_IMAGES_LIMIT', 'IMAGE_FILE_MISSING', 'THEME_BANNER_SIZE', 'THEME_IMAGE_TYPE']));
    expect(r.problems.find((p) => p.code === 'THEME_BANNER_SIZE')!.severity).toBe('warning');
  });
  it('tells the colors the platform would raise: a warning with the color kept, an error with --strict', async () => {
    const doc = theme() as Record<string, any>;
    doc.variants.night.palette.text = '#30343A';
    doc.variants.night.surfaces.postCard.text = '#222222';
    const { h, file } = folder(doc);
    expect(await h.run('theme', 'check', file, '--json')).toBe(0);
    const r = last<Report>(h);
    const contrast = r.problems.filter((p) => p.code === 'THEME_CONTRAST');
    expect(contrast.map((p) => p.path)).toEqual(expect.arrayContaining(['variants.night.palette.text', 'variants.night.surfaces.postCard.text']));
    expect(contrast.every((p) => p.severity === 'warning' && /^#[0-9A-F]{6}$/.test(p.suggested!))).toBe(true);
    expect(await h.run('theme', 'check', file, '--strict', '--json')).toBe(1);
  });
  it('reads the given image files and folders, and tells those that no reference names', async () => {
    const { h, dir, file } = folder();
    writeFileSync(join(dir, 'other.png'), png(10, 10));
    expect(await h.run('theme', 'check', file, dir, '--json')).toBe(0);
    expect(last<Report>(h).problems.filter((p) => p.code === 'IMAGE_FILE_UNUSED').length).toBe(1);
  });
  it('writes a text report without --json', async () => {
    const { h, file } = folder();
    expect(await h.run('theme', 'check', file)).toBe(0);
    expect(h.lines[0]).toMatch(/stade-nuit.*OK/);
  });
});

describe('theme check: opacities and text backdrops', () => {
  const transparent = () => {
    const doc = theme() as Record<string, any>;
    doc.surfaceOpacity = 85;
    doc.textBackdrop = 'block';
    doc.variants.night.surfaces = { page: { opacity: 10 }, focusBar: { opacity: 20 }, postCard: { background: '#1A0F2E', text: '#F2F4F7', opacity: 45 }, quoteCard: { opacity: 80 }, block: { opacity: 60 } };
    doc.variants.day.surfaces = { page: { opacity: 5 }, postCard: { opacity: 50 } };
    return doc;
  };
  it('accepts the surface opacities, the default one, the text backdrop, and shows the text scrims', async () => {
    const { h, file } = folder(transparent());
    expect(await h.run('theme', 'check', file, '--json')).toBe(0);
    const r = last<Report & { opacity: { textBackdrop: string; opacities: Record<string, Record<string, number>>; textScrims: Record<string, Record<string, Record<string, number>>> } }>(h);
    expect(r.ok).toBe(true);
    expect(r.opacity.textBackdrop).toBe('block');
    expect(r.opacity.opacities.night).toMatchObject({ page: 10, focusBar: 20, postCard: 45, quoteCard: 80, widget: 85, primaryButton: 100, badge: 100 });
    expect(r.opacity.opacities.day).toMatchObject({ page: 5, postCard: 50, focusBar: 85 });
    expect(Object.keys(r.opacity.textScrims.postCard)).toEqual(['body', 'secondary', 'large', 'control']);
    expect(Object.keys(r.opacity.textScrims.postCard.body)).toEqual(['night', 'dim', 'day']);
    expect(r.opacity.textScrims.primaryButton).toBeUndefined();
    expect(await h.run('theme', 'check', file)).toBe(0);
    expect(h.all()).toMatch(/opacity text backdrops; night: page 10, .*focusBar 20/);
    expect(h.all()).toMatch(/scrim {3}postCard: body \d+\/\d+\/\d+/);
  });
  it('refuses text scrims, an opacity outside 0 to 100 or not an integer, a text backdrop other than block or surface', async () => {
    const doc = transparent();
    doc.textScrims = { postCard: {} };
    doc.variants.night.surfaces.postCard.opacity = 120;
    doc.variants.day.surfaces.page.opacity = 12.5;
    doc.surfaceOpacity = -1;
    doc.textBackdrop = 'blur';
    const { h, file } = folder(doc);
    expect(await h.run('theme', 'check', file, '--json')).toBe(1);
    const r = last<Report>(h);
    const at = (code: string) => r.problems.filter((p) => p.code === code).map((p) => p.path);
    expect(at('THEME_SCRIMS_COMPUTED')).toEqual(['textScrims']);
    expect(r.problems.find((p) => p.code === 'THEME_SCRIMS_COMPUTED')!.path).toBe('textScrims');
    expect(JSON.stringify(r.problems)).toContain('The scrims and the text scrims of a theme are computed by the social platform');
    expect(at('THEME_OPACITY_INVALID')).toEqual(['surfaceOpacity', 'variants.night.surfaces.postCard.opacity', 'variants.day.surfaces.page.opacity']);
    expect(at('THEME_TEXT_BACKDROP_INVALID')).toEqual(['textBackdrop']);
  });
  it('warns of a button or a badge below 100 (raised to 100) and of an opacity raised with a whole-surface backdrop', async () => {
    const doc = transparent();
    doc.variants.night.surfaces.badge = { opacity: 50 };
    doc.variants.day.surfaces.primaryButton = { opacity: 0 };
    doc.textBackdrop = 'surface';
    const { h, file } = folder(doc);
    expect(await h.run('theme', 'check', file, '--json')).toBe(0);
    const r = last<Report & { opacity: { textScrims: object; raised: { variant: string; surface: string; from: number; to: number }[]; floors: unknown[] } }>(h);
    const raised = r.problems.filter((p) => p.code === 'THEME_OPACITY_RAISED');
    expect(raised.map((p) => p.path)).toEqual(expect.arrayContaining(['variants.night.surfaces.badge.opacity', 'variants.day.surfaces.primaryButton.opacity', 'variants.night.surfaces.page.opacity']));
    expect(raised.every((p) => p.severity === 'warning')).toBe(true);
    expect(r.opacity.textScrims).toEqual({});
    expect(r.opacity.raised.find((x) => x.variant === 'night' && x.surface === 'page')!.to).toBeGreaterThan(10);
    expect(r.opacity.floors).toEqual([{ variant: 'night', surface: 'badge', from: 50 }, { variant: 'day', surface: 'primaryButton', from: 0 }]);
    expect(await h.run('theme', 'check', file, '--strict', '--json')).toBe(1);
  });
  it('refuses the opacities in the format 1', async () => {
    const doc = theme() as Record<string, any>;
    delete doc.format; delete doc.imageSlots; delete doc.surfaceRadius; delete doc.typography.accent; delete doc.variants.night.surfaces;
    doc.surfaceOpacity = 80;
    const { h, file } = folder(doc);
    expect(await h.run('theme', 'check', file, '--json')).toBe(1);
    expect(last<Report>(h).problems.filter((p) => p.code === 'THEME_FORMAT_INVALID').map((p) => p.path)).toContain('surfaceOpacity');
  });
});

describe('theme pack and unpack', () => {
  it('pack the JSON and its images, read back byte for byte; refuse what is missing', async () => {
    const { h, dir, file } = folder();
    const zip = join(h.dir, 'out.zip');
    expect(await h.run('theme', 'pack', file, '--out', zip, '--json')).toBe(0);
    expect(last<{ entries: { path: string }[] }>(h).entries.map((e) => e.path)).toEqual(['theme.json', 'page-day.jpg', 'page-night.png', 'page-header-day.png', 'card-texture-day.png']);
    expect(await h.run('theme', 'pack', file, '--out', zip, '--json')).toBe(2);
    const target = join(h.dir, 'back');
    expect(await h.run('theme', 'unpack', zip, '--out', target, '--json')).toBe(0);
    for (const name of ['theme.json', 'page-day.jpg', 'page-header-day.png']) expect(readFileSync(join(target, name))).toEqual(readFileSync(join(dir, name)));
    const doc = theme() as Record<string, any>;
    doc.images.pattern = 'pattern.png';
    writeFileSync(file, JSON.stringify(doc));
    expect(await h.run('theme', 'pack', file, '--out', join(h.dir, 'x.zip'), '--json')).toBe(1);
    expect(last<{ error: { code: string; missing: string[] } }>(h).error).toMatchObject({ code: 'IMAGE_FILE_MISSING', missing: ['pattern.png'] });
  });
  it('writes ZIP archives the studio reads: entries stored or deflated, CRC checked', () => {
    const files = [{ path: 'theme.json', bytes: new TextEncoder().encode('{"a":1}'.repeat(100)), deflate: true }, { path: 'é.png', bytes: png(3, 1) }];
    const zip = writeZip(files);
    const entries = readZip(zip);
    expect(entries.map((e) => [e.path, e.method])).toEqual([['theme.json', 8], ['é.png', 0]]);
    expect(new TextDecoder().decode(zipEntryBytes(zip, entries[0]))).toBe('{"a":1}'.repeat(100));
    const broken = zip.slice(); broken[40] ^= 0xFF;
    expect(() => zipEntryBytes(broken, entries[0])).toThrow(/damaged/);
  });
  it('refuses an archive that writes outside its folder', async () => {
    const h = harness();
    const zip = join(h.dir, 'evil.zip');
    writeFileSync(zip, writeZip([{ path: '../evil.txt', bytes: new Uint8Array([1]) }]));
    expect(await h.run('theme', 'unpack', zip, '--out', join(h.dir, 'x'), '--json')).toBe(2);
    expect(last<{ error: { code: string } }>(h).error.code).toBe('ZIP_PATH_UNSAFE');
    expect(existsSync(join(h.dir, 'evil.txt'))).toBe(false);
  });
});

describe('images', () => {
  it('reads the type and size of PNG, JPEG and WebP', () => {
    expect(imageInfo(png(300, 100))).toEqual({ type: 'image/png', width: 300, height: 100 });
    expect(imageInfo(jpeg(640, 480))).toEqual({ type: 'image/jpeg', width: 640, height: 480 });
    const webp = Buffer.alloc(30); webp.write('RIFF', 0); webp.write('WEBP', 8); webp.write('VP8X', 12); webp.writeUIntLE(1999, 24, 3); webp.writeUIntLE(999, 27, 3);
    expect(imageInfo(webp)).toEqual({ type: 'image/webp', width: 2000, height: 1000 });
    expect(imageInfo(Buffer.from('hello'))).toBeUndefined();
  });
});

describe('theme prompt', () => {
  it('fills the prompt with the field, the mood, the name, the universe and the typefaces', () => {
    const r = themePrompt({ field: 'politique', mood: 'hémicycle', name: 'agora', universe: '%paris', fonts: ['playfair display'], language: 'fr' });
    expect(r).toMatchObject({ field: 'POLITICS', fonts: ['Playfair Display'], language: 'fr' });
    expect(r.prompt).toContain('"universe": "%paris"');
    expect(r.prompt).toContain('Ambiance : hémicycle');
    expect(r.prompt).toContain('Zen Maru Gothic');
    expect(themePrompt({ field: 'GAMES', mood: 'neon', name: 'faille', universe: '%gaming' }).prompt).toContain('Mood: neon');
  });
  it('refuses a field, a name, a universe or a typeface that is none', async () => {
    expect(() => fieldOf('cooking')).toThrow(/not a field/);
    const h = harness();
    expect(await h.run('theme', 'prompt', '--field', 'sport', '--mood', 'x', '--name', '1abc', '--universe', '%x', '--json')).toBe(2);
    expect(last<{ error: { code: string } }>(h).error.code).toBe('THEME_NAME_INVALID');
    expect(await h.run('theme', 'prompt', '--field', 'sport', '--mood', 'x', '--name', 'abc', '--universe', '%x', '--fonts', 'Arial', '--json')).toBe(2);
    expect(last<{ error: { code: string } }>(h).error.code).toBe('THEME_TYPEFACE_NOT_APPROVED');
    expect(await h.run('theme', 'prompt', '--field', 'tech', '--mood', 'terminal', '--name', 'term', '--universe', '%dev')).toBe(0);
    expect(await h.run('theme', 'prompt', '--mood', 'x', '--name', 'abc', '--universe', '%x', '--json')).toBe(2);
    expect(await h.run('theme', 'prompt', '--field', 'tech', '--mood', 'x', '--name', 'abc', '--json')).toBe(2);
  });
  it('asks for the opacities, the text backdrop and the secondary text of the buttons and the badge', () => {
    const { prompt } = themePrompt({ field: 'sport', mood: 'stadium', name: 'stade', universe: '%football' });
    for (const text of ['"surfaceOpacity": 85', '"textBackdrop": "block"', '"focusBar"', '"rail"', '**30 to 60**', '`quoteCard` **80**', '`textScrims`', '"secondaryText"']) expect(prompt).toContain(text);
    const json = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(prompt)![1]);
    expect(json.collection).toBe('SPORT');
    expect(json.variants.night.surfaces.quoteCard.opacity).toBe(80);
    expect(json.variants.night.surfaces.badge).toMatchObject({ secondaryText: '#…', opacity: 100 });
    expect(Object.keys(json.imageSlots)).toEqual(['page', 'pageHeader', 'timeColumn', 'channelHeader']);
    expect(prompt).not.toContain('card-texture');
    expect(prompt).toContain('the **7 images** of the theme');
    expect(prompt).toContain('Do not provide a card texture');
    expect(themePrompt({ mood: 'ciel', name: 'abc', universal: true, language: 'fr' }).prompt).toContain('les **7 images** du thème');
  });
  it('writes the prompt of a universal theme: no field, the palette and the typeface of Socle, %root', async () => {
    const r = themePrompt({ mood: 'an open sky', name: 'universel-ciel', universal: true, language: 'fr' });
    expect(r).toMatchObject({ field: null, universe: '%root', fonts: ['Montserrat', 'Montserrat'], universal: true });
    const json = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(r.prompt)![1]);
    expect(json.collection).toBeUndefined();
    expect(json.variants.night.palette).toEqual({ background: '#0E1116', surface: '#161B22', text: '#F2F4F7', primary: '#4C8DFF', accent: '#4CC2FF', link: '#7CC4FF' });
    expect(r.prompt).toContain('Règles propres au thème universel');
    expect(() => themePrompt({ mood: 'x', name: 'abc', universal: true, field: 'sport' })).toThrow(/no field/);
    expect(() => themePrompt({ mood: 'x', name: 'abc', universal: true, fonts: ['Orbitron'] })).toThrow(/Montserrat/);
    const h = harness();
    expect(await h.run('theme', 'prompt', '--universal', '--mood', 'sky', '--name', 'universel-ciel', '--json')).toBe(0);
    expect(last<{ universal: boolean; field: null }>(h)).toMatchObject({ universal: true, field: null });
  });
});

describe('the approved typefaces', () => {
  it('are at least 30, each once', () => {
    expect(APPROVED_TYPEFACES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(APPROVED_TYPEFACES.map((f) => f.name.toLowerCase())).size).toBe(APPROVED_TYPEFACES.length);
  });
});
