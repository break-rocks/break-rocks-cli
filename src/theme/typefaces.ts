// The title typefaces approved by the social platform (contracts/themes.md § Typography; the query
// approvedTypefaces), shipped with the CLI so that `theme prompt` and `theme check` work offline: a
// copy of the backend's list (break-rocks-backend amplify/themes/typefaces.ts), kept in step by a
// test when the backend's checkout is beside this one.

export type TypefaceCategory = 'DISPLAY' | 'NEON' | 'PIXEL' | 'SERIF' | 'SCRIPT' | 'MONO' | 'SANS';
export type Typeface = { name: string; category: TypefaceCategory; scripts: string[]; license: 'OFL-1.1' | 'Apache-2.0' };

const t = (name: string, category: TypefaceCategory, scripts: string[], license: Typeface['license'] = 'OFL-1.1'): Typeface => ({ name, category, scripts, license });
const L = ['Latin'];
const LC = ['Latin', 'Cyrillic'];

export const APPROVED_TYPEFACES: readonly Typeface[] = [
  t('Bebas Neue', 'DISPLAY', L), t('Anton', 'DISPLAY', ['Latin', 'Vietnamese']), t('Russo One', 'DISPLAY', LC), t('Bungee', 'DISPLAY', ['Latin', 'Vietnamese']),
  t('Righteous', 'DISPLAY', L), t('Alfa Slab One', 'DISPLAY', ['Latin', 'Vietnamese']), t('Black Ops One', 'DISPLAY', L), t('Archivo Black', 'DISPLAY', L),
  t('Monoton', 'NEON', L), t('Tilt Neon', 'NEON', ['Latin', 'Vietnamese']), t('Neonderthaw', 'NEON', ['Latin', 'Vietnamese']), t('Orbitron', 'NEON', L), t('Audiowide', 'NEON', L),
  t('Press Start 2P', 'PIXEL', ['Latin', 'Cyrillic', 'Greek']), t('VT323', 'PIXEL', ['Latin', 'Vietnamese']), t('Silkscreen', 'PIXEL', L), t('Pixelify Sans', 'PIXEL', LC),
  t('DotGothic16', 'PIXEL', ['Latin', 'Cyrillic', 'Japanese']),
  t('Playfair Display', 'SERIF', ['Latin', 'Cyrillic', 'Vietnamese']), t('Cormorant Garamond', 'SERIF', ['Latin', 'Cyrillic', 'Vietnamese']), t('Abril Fatface', 'SERIF', L),
  t('DM Serif Display', 'SERIF', L), t('Libre Baskerville', 'SERIF', L), t('GFS Didot', 'SERIF', ['Greek']), t('Amiri', 'SERIF', ['Arabic', 'Latin']),
  t('Frank Ruhl Libre', 'SERIF', ['Hebrew', 'Latin']),
  t('Pacifico', 'SCRIPT', ['Latin', 'Cyrillic', 'Vietnamese']), t('Lobster', 'SCRIPT', ['Latin', 'Cyrillic', 'Vietnamese']), t('Dancing Script', 'SCRIPT', ['Latin', 'Vietnamese']),
  t('Caveat', 'SCRIPT', LC), t('Great Vibes', 'SCRIPT', ['Latin', 'Cyrillic', 'Vietnamese']), t('Satisfy', 'SCRIPT', L, 'Apache-2.0'),
  t('Space Mono', 'MONO', ['Latin', 'Vietnamese']), t('JetBrains Mono', 'MONO', ['Latin', 'Cyrillic', 'Greek', 'Vietnamese']), t('IBM Plex Mono', 'MONO', ['Latin', 'Cyrillic', 'Vietnamese']),
  t('Share Tech Mono', 'MONO', L), t('Major Mono Display', 'MONO', L),
  t('Oswald', 'SANS', ['Latin', 'Cyrillic', 'Vietnamese']), t('Montserrat', 'SANS', ['Latin', 'Cyrillic', 'Vietnamese']), t('Exo 2', 'SANS', LC),
  t('Reem Kufi', 'DISPLAY', ['Arabic', 'Latin']), t('Cairo', 'SANS', ['Arabic', 'Latin']), t('Ruslan Display', 'DISPLAY', LC), t('Suez One', 'SERIF', ['Hebrew', 'Latin']),
  t('Rozha One', 'SERIF', ['Devanagari', 'Latin']), t('Mukta', 'SANS', ['Devanagari', 'Latin']), t('Galada', 'SCRIPT', ['Bengali', 'Latin']), t('Hind Siliguri', 'SANS', ['Bengali', 'Latin']),
  t('Kanit', 'SANS', ['Thai', 'Latin', 'Vietnamese']), t('Mitr', 'SANS', ['Thai', 'Latin', 'Vietnamese']), t('ZCOOL KuaiLe', 'DISPLAY', ['Han (Simplified)', 'Latin']),
  t('Zen Maru Gothic', 'SANS', ['Japanese', 'Latin', 'Cyrillic', 'Greek']), t('Black Han Sans', 'DISPLAY', ['Hangul', 'Latin']), t('Do Hyeon', 'SANS', ['Hangul', 'Latin']),
];

const byName = new Map(APPROVED_TYPEFACES.map((f) => [f.name.toLowerCase(), f]));
/** The approved typeface named [name] (case and outer spaces not counted). */
export const approvedTypeface = (name: unknown) => (typeof name === 'string' ? byName.get(name.trim().toLowerCase()) : undefined);
/** The names, sorted as in the prompt of THEME-IA-PROMPT.md. */
export const typefaceNames = () => APPROVED_TYPEFACES.map((f) => f.name).sort((a, b) => a.localeCompare(b, 'en'));
