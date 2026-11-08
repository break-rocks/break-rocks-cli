import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { imageInfo } from '../src/theme/images.js';
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
    night: { palette: { background: '#0E1116', surface: '#161B22', text: '#F2F4F7', primary: '#E5484D', accent: '#4CC2FF', link: '#7CC4FF' }, surfaces: { block: { background: '#1A0F2E', text: '#F2F4F7' }, control: { background: '#FF2BD6', text: '#0E1116' } } },
    day: { palette: { background: '#FFFFFF', surface: '#F4F5F7', text: '#14171C', primary: '#C8102E', accent: '#0067B8', link: '#0057A0' } },
  },
  typography: { title: 'Bebas Neue' }, gradient: ['#0E1116', '#4CC2FF'], motionAccents: true,
  imageSlots: { page: { day: 'page-day.jpg', night: 'page-night.png' }, pageHeader: { day: 'page-header-day.png' } },
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
  return { h, dir, file: join(dir, 'theme.json') };
}

type Report = { ok: boolean; errors: number; warnings: number; problems: { code: string; path: string; severity: string; suggested?: string }[]; images: { place: string; width?: number; read?: boolean }[]; families?: Record<string, Record<string, { background: string }>>; mask?: { imageShows: string; night: number; dim: number; day: number } };
const codes = (r: Report) => r.problems.map((p) => p.code);
const design = join(import.meta.dirname, '..', 'design-lib');

describe('theme check (the model of specs v99, design-lib/lib/theme)', () => {
  it('passes a good theme with its images beside it, exit 0: the four families and the readability mask', async () => {
    const { h, file } = folder();
    expect(await h.run('theme', 'check', file, '--json')).toBe(0);
    const r = last<Report>(h);
    expect(r).toMatchObject({ ok: true, errors: 0, warnings: 0, format: 'break-rocks-theme/2', name: 'stade-nuit' });
    expect(r.images.map((i) => [i.place, i.width])).toEqual([['page', 2160], ['page', 2160], ['pageHeader', 2160]]);
    expect(r.families!.night.block.background).toBe('#1A0F2E');
    expect(r.mask).toMatchObject({ imageShows: 'subtle' });
    for (const mode of ['night', 'dim', 'day'] as const) expect(r.mask![mode]).toBeGreaterThanOrEqual(0.6);
  });
  it('passes the examples of the design system', async () => {
    for (const name of ['faille.json', 'faille-v48.json', 'vestiaire.json']) {
      const h = harness();
      expect(await h.run('theme', 'check', join(design, 'examples', 'themes', name), '--json'), name).toBe(0);
    }
  });
  it('refuses the invalid examples of the design system with the codes of the publication', async () => {
    const expected: Record<string, string> = {
      'schema.surface-unknown.json': 'THEME_SURFACE_UNKNOWN', 'schema.image-slot-unknown.json': 'THEME_IMAGE_SLOT_UNKNOWN', 'schema.body-typeface.json': 'THEME_BODY_TYPEFACE',
      'schema.color-not-rrggbb.json': 'THEME_PALETTE_INVALID', 'schema.name-starts-with-digit.json': 'THEME_NAME_INVALID', 'schema.external-image.json': 'THEME_EXTERNAL_RESOURCE',
      'schema.format-3.json': 'THEME_FORMAT_INVALID', 'schema.variant-missing.json': 'THEME_VARIANT_MISSING', 'schema.scrim-above-1.json': 'THEME_SCRIMS_COMPUTED',
    };
    for (const [name, code] of Object.entries(expected)) {
      const h = harness();
      expect(await h.run('theme', 'check', join(design, 'examples', 'themes', 'invalid', name), '--json'), name).toBe(1);
      expect(codes(last<Report>(h)), name).toContain(code);
    }
  });
  it('reads the former theme surfaces into their family, deprecated; ignores radii, borders, opacities and the accent typeface, never refuses them', async () => {
    const doc = theme() as Record<string, any>;
    doc.variants.night.surfaces = { widget: { background: '#20123A', border: '#FF2BD6', opacity: 45 }, postCard: { background: '#1A0F2E' } };
    doc.surfaceRadius = { widget: 'sharp' }; doc.shape = { radius: 'huge', stroke: 'bold' }; doc.typography.accent = 'Orbitron';
    doc.surfaceOpacity = 85; doc.textBackdrop = 'block';
    doc.imageSlots.cardTexture = { day: 'card-texture-day.png' };
    const { h, file } = folder(doc);
    expect(await h.run('theme', 'check', file, '--json')).toBe(0);
    const r = last<Report>(h);
    expect(codes(r)).not.toContain('THEME_RADIUS_INVALID');
    expect(codes(r)).not.toContain('THEME_STROKE_INVALID');
    expect(r.problems.filter((p) => p.code === 'THEME_SURFACE_DEPRECATED').map((p) => p.path)).toEqual(['variants.night.surfaces.widget']);
    expect(r.problems.filter((p) => p.code === 'THEME_KEY_IGNORED').map((p) => p.path)).toEqual(expect.arrayContaining(['surfaceOpacity', 'textBackdrop', 'variants.night.surfaces.widget.opacity', 'variants.night.surfaces.widget.border', 'variants.night.surfaces.postCard', 'surfaceRadius', 'shape', 'typography.accent', 'imageSlots.cardTexture']));
    expect(r.families!.night.block.background).toBe('#20123A');
    expect(r.images.find((i) => i.place === 'cardTexture')).toMatchObject({ read: false });
    expect(await h.run('theme', 'check', file, '--strict', '--json')).toBe(1);
  });
  it('refuses, exit 1, with the codes of the platform', async () => {
    const doc = theme() as Record<string, any>;
    doc.variants.night.surfaces.navigation = { text: '#FFFFFF' };
    doc.typography.title = 'Comic Sans';
    doc.scrims = { mask: { day: 0.7 } };
    doc.textScrims = {};
    doc.gradient = ['#123456', '#654321'];
    doc.imageSlots.page = { day: 'https://example.com/a.jpg' };
    doc.imageSlots.sidebar = null;
    doc.extra = 1;
    const { h, file } = folder(doc);
    expect(await h.run('theme', 'check', file, '--json')).toBe(1);
    const r = last<Report>(h);
    expect(r.ok).toBe(false);
    expect(codes(r)).toEqual(expect.arrayContaining(['THEME_SURFACE_UNKNOWN', 'THEME_TYPEFACE_NOT_APPROVED', 'THEME_SCRIMS_COMPUTED', 'THEME_GRADIENT_INVALID', 'THEME_EXTERNAL_RESOURCE', 'THEME_IMAGE_SLOT_UNKNOWN', 'THEME_FORMAT_INVALID']));
  });
  it('refuses a missing file, more than 8 images, an image that is no JPEG/PNG/WebP; warns of a banner that is not 3:1', async () => {
    const doc = theme() as Record<string, any>;
    doc.imageSlots.pageHeader = { day: 'page-header-day.png', night: 'ph-night.jpg' };
    doc.images = { wordmark: 'wordmark.png', pattern: 'p.png' };
    doc.variants.night.surfaces.sky = { background: '#2A1846' };
    const { h, dir, file } = folder(doc);
    writeFileSync(join(dir, 'page-header-day.png'), png(1200, 400));
    writeFileSync(join(dir, 'wordmark.png'), Buffer.from('GIF89a\x10\x00\x10\x00'));
    expect(await h.run('theme', 'check', file, '--json')).toBe(1);
    const r = last<Report>(h);
    expect(codes(r)).toEqual(expect.arrayContaining(['IMAGE_FILE_MISSING', 'THEME_BANNER_SIZE', 'THEME_IMAGE_TYPE']));
    expect(r.problems.find((p) => p.code === 'THEME_BANNER_SIZE')!.severity).toBe('warning');
    const many = theme() as Record<string, any>;
    many.imageSlots = { page: { day: 'a', night: 'b' }, pageHeader: { day: 'c', night: 'd' } };
    many.images = { wordmark: 'e', pattern: 'f' };
    many.variants.night.surfaces.page = { background: '#0E1116' };
    expect(await h.run('theme', 'check', file, '--json')).toBe(1);
    void many;
  });
  it('tells the colors the platform would raise on the families: a warning with the color kept, an error with --strict', async () => {
    const doc = theme() as Record<string, any>;
    doc.variants.night.palette.text = '#30343A';
    doc.variants.night.surfaces.block.text = '#222222';
    const { h, file } = folder(doc);
    expect(await h.run('theme', 'check', file, '--json')).toBe(0);
    const r = last<Report>(h);
    const contrast = r.problems.filter((p) => p.code === 'THEME_CONTRAST');
    expect(contrast.map((p) => p.path)).toEqual(expect.arrayContaining(['variants.night.palette.text', 'variants.night.surfaces.block.text']));
    expect(contrast.every((p) => p.severity === 'warning' && /^#[0-9A-F]{6}$/.test(p.suggested!))).toBe(true);
    expect(await h.run('theme', 'check', file, '--strict', '--json')).toBe(1);
  });
  it('reads how the image of the page shows from the block appearance; none: no mask', async () => {
    const doc = theme() as Record<string, any>;
    doc.appearance = { imageShows: 'through' };
    const { h, file } = folder(doc);
    expect(await h.run('theme', 'check', file, '--json')).toBe(0);
    expect(last<Report>(h).mask).toMatchObject({ imageShows: 'through' });
    writeFileSync(file, JSON.stringify({ ...doc, appearance: { imageShows: 'none' } }));
    expect(await h.run('theme', 'check', file, '--json')).toBe(0);
    expect(last<Report>(h).mask).toBeUndefined();
    writeFileSync(file, JSON.stringify({ ...doc, appearance: { imageShows: 'half' } }));
    expect(await h.run('theme', 'check', file, '--json')).toBe(1);
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
    expect(h.all()).toMatch(/mask {4}subtle: night/);
  });
});

describe('layouts check (design-lib/lib/layout, offline)', () => {
  it('passes the platform layouts of the design system, refuses with the codes of the publication, never calls the API', async () => {
    const h = harness();
    expect(await h.run('layouts', 'check', `@${join(design, 'layouts', 'platform', 'agora.json')}`, '--json')).toBe(0);
    expect(last<{ ok: boolean; source: string; kind: string }>(h)).toMatchObject({ ok: true, source: 'offline', kind: 'public' });
    expect(await h.run('layouts', 'check', '{"format":"break-rocks-layout/1","name":"1x","canvases":{}}', '--in', '%team.', '--json')).toBe(1);
    expect(last<{ kind: string; refusals: { code: string }[] }>(h)).toMatchObject({ kind: 'private', refusals: expect.arrayContaining([expect.objectContaining({ code: 'LAYOUT_NAME_INVALID' })]) });
    expect(await h.run('layouts', 'check', '{}', '--online', '--json')).toBe(2);
  });
});

describe('theme pack and unpack', () => {
  it('pack the JSON and its images, read back byte for byte; refuse what is missing', async () => {
    const { h, dir, file } = folder();
    const zip = join(h.dir, 'out.zip');
    expect(await h.run('theme', 'pack', file, '--out', zip, '--json')).toBe(0);
    expect(last<{ entries: { path: string }[] }>(h).entries.map((e) => e.path)).toEqual(['theme.json', 'page-day.jpg', 'page-night.png', 'page-header-day.png']);
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
  it('writes the model of specs v99: the four families, one title typeface, the slots page and pageHeader; no radius, border, opacity nor backdrop', () => {
    for (const language of ['en', 'fr'] as const) {
      const { prompt } = themePrompt({ field: 'sport', mood: 'stadium', name: 'stade', universe: '%football', language });
      const json = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(prompt)![1]);
      expect(json.collection).toBe('SPORT');
      expect(Object.keys(json.variants.night.surfaces)).toEqual(['page', 'sky', 'block', 'control']);
      expect(json.variants.night.surfaces.control).toEqual({ background: '#…', text: '#…', secondaryText: '#…' });
      expect(Object.keys(json.imageSlots)).toEqual(['page', 'pageHeader']);
      expect(Object.keys(json.typography)).toEqual(['title']);
      for (const gone of ['surfaceRadius', 'shape', 'surfaceOpacity', 'textBackdrop']) expect(json, gone).not.toHaveProperty(gone);
      expect(JSON.stringify(json)).not.toMatch(/opacity|border|postCard|primaryButton/);
      for (const text of ['`through`', '`subtle`', '`none`', '`scrims`']) expect(prompt).toContain(text);
    }
    expect(themePrompt({ field: 'sport', mood: 'x', name: 'stade', universe: '%f' }).prompt).toContain('the **4 images** of the theme');
    expect(themePrompt({ mood: 'ciel', name: 'abc', universal: true, language: 'fr' }).prompt).toContain('les **4 images** du thème');
    expect(themePrompt({ mood: 'ciel', name: 'abc', universal: true, language: 'fr' }).prompt).toContain('masque de lisibilité');
    expect(() => themePrompt({ field: 'sport', mood: 'x', name: 'abc', universe: '%x', fonts: ['Orbitron', 'Anton'] })).toThrow(/One typeface/);
  });
  it('keeps the fields to fill as <…> with --template; the JSON of the prompt passes theme check once filled', async () => {
    const r = themePrompt({ template: true, language: 'fr' });
    expect(r.prompt).toContain('`<%nom-de-l-univers>`');
    expect(r.prompt).toContain('"name": "<nom>"');
    expect(r.prompt).toContain('<CULTURE | ENTERTAINMENT');
    const filled = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(themePrompt({ field: 'sport', mood: 'x', name: 'stade', universe: '%f', fonts: ['Anton'] }).prompt)![1].replaceAll('#…', '#808080'));
    filled.variants.night.palette = theme().variants.night.palette; filled.variants.day = theme().variants.day; filled.gradient = ['#0E1116', '#4CC2FF'];
    filled.imageSlots = { page: null, pageHeader: null };
    const h = harness();
    writeFileSync(join(h.dir, 'p.json'), JSON.stringify(filled));
    expect(await h.run('theme', 'check', join(h.dir, 'p.json'), '--json')).toBe(0);
  });
  it('writes the prompt of a universal theme: no field, the palette and the typeface of Socle, %root', async () => {
    const r = themePrompt({ mood: 'an open sky', name: 'universel-ciel', universal: true, language: 'fr' });
    expect(r).toMatchObject({ field: null, universe: '%root', fonts: ['Montserrat'], universal: true });
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
