// `theme prompt`: the theme prompt of the platform on the model of specs v99.0.0 (D-293, contracts/themes.md
// § Since v99.0.0, § Format 2; design/schemas/theme-v2.schema.json, design/examples/themes): the four families
// of theme surfaces (page, sky, block, control), no radius, no stroke, no border, no opacity, one title
// typeface, the image slots page and pageHeader, the readability mask computed by the platform. Filled with the
// field, the mood, the name, the universe and the typeface, to give to an AI that writes the theme.json and its
// images; --template keeps the fields to fill as <…>. --universal: the prompt of a universal theme (no field,
// the palette and the title typeface of Socle, its own rules). Offline: the approved typefaces and the image
// sizes are shipped with the CLI. In French or English.
import { usageError } from '../errors.js';
import { FIELDS, validThemeName } from './check.js';
import { approvedTypeface, typefaceNames } from './typefaces.js';

export type Field = (typeof FIELDS)[number];
export const LANGUAGES = ['en', 'fr'] as const;
export type Language = (typeof LANGUAGES)[number];

const FIELD_WORDS: Record<Field, { en: string; fr: string; aliases: string[] }> = {
  SPORT: { en: 'sport', fr: 'sport', aliases: ['sports'] },
  CULTURE: { en: 'culture', fr: 'culture', aliases: [] },
  POLITICS: { en: 'politics', fr: 'politique', aliases: [] },
  ENTERTAINMENT: { en: 'entertainment', fr: 'divertissement', aliases: [] },
  SCIENCE: { en: 'science', fr: 'sciences', aliases: [] },
  GAMES: { en: 'games', fr: 'jeux', aliases: ['gaming', 'game'] },
  PLACES: { en: 'places', fr: 'lieux', aliases: [] },
  WORK: { en: 'work', fr: 'travail', aliases: [] },
  EVERYDAY_LIFE: { en: 'everyday life', fr: 'vie quotidienne', aliases: ['everyday-life', 'everyday_life', 'vie-quotidienne'] },
  TECH: { en: 'tech', fr: 'tech', aliases: ['technology'] },
};

/** The palette of Socle, the palette of every universal theme. */
export const SOCLE_PALETTE = {
  night: { background: '#0E1116', surface: '#161B22', text: '#F2F4F7', primary: '#4C8DFF', accent: '#4CC2FF', link: '#7CC4FF' },
  day: { background: '#FFFFFF', surface: '#F4F5F7', text: '#14171C', primary: '#1F5FD6', accent: '#0067B8', link: '#0057A0' },
};
/** The title typeface of Socle, the typeface of the universal themes. */
export const SOCLE_TYPEFACE = 'Montserrat';

/** The field named in any of its forms (SPORT, sport, "vie quotidienne"…), THEME_FIELD_INVALID otherwise. */
export function fieldOf(value: string): Field {
  const v = value.trim().toLowerCase();
  for (const field of FIELDS) {
    const words = FIELD_WORDS[field];
    if ([field.toLowerCase(), words.en, words.fr, ...words.aliases].includes(v)) return field;
  }
  throw usageError('THEME_FIELD_INVALID', `"${value}" is not a field: ${FIELDS.map((f) => FIELD_WORDS[f].en).join(', ')}`);
}

export type PromptInput = { field?: string; mood?: string; name?: string; universe?: string; description?: string; fonts?: string[]; language?: Language; universal?: boolean; template?: boolean };
export type PromptResult = { prompt: string; language: Language; field: Field | null; name: string; universe: string; fonts: string[]; universal: boolean; template: boolean };

/** The prompt filled (or, with [template], its fields left as <…>); the field, the name, the universe and the typeface checked first (exit 2). */
export function themePrompt(input: PromptInput): PromptResult {
  const language = input.language ?? 'en';
  const universal = !!input.universal;
  const template = !!input.template;
  const fr = language === 'fr';
  if (universal && input.field) throw usageError('INVALID_INPUT', 'A universal theme has no field: --universal without --field');
  if (!template && !universal && !input.field) throw usageError('INVALID_INPUT', 'The field is required (--field), or --universal for a universal theme, or --template');
  if (!template && !input.mood?.trim()) throw usageError('INVALID_INPUT', 'The mood is required (--mood), or --template');
  if (!template && !input.name) throw usageError('INVALID_INPUT', 'The name is required (--name), or --template');
  const field = universal || (template && !input.field) ? null : fieldOf(input.field!);
  const name = (input.name ?? '').trim();
  if (name && !validThemeName(name)) throw usageError('THEME_NAME_INVALID', 'A theme name has 2 to 64 letters, digits, "-", "_" or ".", beginning with a letter, without ".." nor a final "."');
  const universe = (input.universe ?? (universal ? '%root' : '')).trim();
  if (!universe && !template) throw usageError('INVALID_INPUT', 'The universe is required (--universe %name)');
  if (universe && !/^%\S+$/.test(universe)) throw usageError('THEME_UNIVERSE_INVALID', 'The universe is an address beginning with "%" (%name)');
  if ((input.fonts ?? []).length > 1) throw usageError('INVALID_INPUT', 'One typeface: the title typeface (since specs v99.0.0 the accent typeface is merged with it)');
  let fonts = (input.fonts ?? []).map((f) => {
    const face = approvedTypeface(f);
    if (!face) throw usageError('THEME_TYPEFACE_NOT_APPROVED', `"${f}" is not an approved typeface (breakrocks theme typefaces)`, { typeface: f });
    return face.name;
  });
  if (universal) {
    if (fonts.some((f) => f !== SOCLE_TYPEFACE)) throw usageError('INVALID_INPUT', `A universal theme has the typeface of Socle, ${SOCLE_TYPEFACE}`);
    fonts = [SOCLE_TYPEFACE];
  }
  const hole = (en: string, frText: string) => `<${fr ? frText : en}>`;
  const filled: Filled = {
    named: !!name, fr, field, universal, template, fonts,
    fieldText: field ? `${FIELD_WORDS[field][language]} (\`${field}\`)` : hole(Object.values(FIELD_WORDS).map((w) => w.en).join(' | '), Object.values(FIELD_WORDS).map((w) => w.fr).join(' | ')),
    collection: field ?? (universal ? undefined : hole(FIELDS.join(' | '), FIELDS.join(' | '))),
    mood: input.mood?.trim() || hole('e.g. a stadium at night under the floodlights; or a museum with white walls, calm', 'ex. : stade la nuit sous les projecteurs ; ou : musée aux murs blancs, calme'),
    name: name || hole('2 to 64 characters: letters, digits, "-", "_" or "."; a letter first; lowercase', '2 à 64 caractères : lettres, chiffres, "-", "_" ou "." ; commence par une lettre ; minuscules'),
    universe: universe || hole('%universe-name', '%nom-de-l-univers'),
    description: input.description?.trim(),
  };
  const prompt = (fr ? french : english)(filled);
  return { prompt, language, field, name: filled.name, universe: filled.universe, fonts, universal, template };
}

type Filled = { named: boolean; fr: boolean; field: Field | null; fieldText: string; collection?: string; mood: string; name: string; universe: string; description?: string; fonts: string[]; universal: boolean; template: boolean };

/** The JSON of the prompt: the model of specs v99 (design/examples/themes/faille.json), its colors to write. */
function skeleton(f: Filled, sameKeys: string, descriptionPlaceholder: string, typefacePlaceholder: string): string {
  const color = (k: string, variant: 'night' | 'day') => (f.universal ? SOCLE_PALETTE[variant][k as keyof typeof SOCLE_PALETTE.night] : '#…');
  const palette = (variant: 'night' | 'day') => Object.fromEntries(['background', 'surface', 'text', 'primary', 'accent', 'link'].map((k) => [k, color(k, variant)]));
  const three = { background: '#…', text: '#…', secondaryText: '#…' };
  const surfaces = { page: three, sky: three, block: three, control: three };
  return JSON.stringify({
    format: 'break-rocks-theme/2', universe: f.universe, name: f.template && !f.named ? (f.fr ? '<nom>' : '<name>') : f.name, description: f.description ?? descriptionPlaceholder, ...(f.collection ? { collection: f.collection } : {}),
    variants: { night: { palette: palette('night'), surfaces }, day: { palette: palette('day'), surfaces: { '...': sameKeys } } },
    typography: { title: f.fonts[0] ?? typefacePlaceholder },
    gradient: ['#…', '#…'], motionAccents: true,
    imageSlots: { page: { day: 'page-day.jpg', night: 'page-night.jpg' }, pageHeader: { day: 'page-header-day.jpg', night: 'page-header-night.jpg' } },
    images: { wordmark: null, pattern: null }, stickers: [],
  }, null, 2);
}

const socle = (variant: 'night' | 'day') => Object.entries(SOCLE_PALETTE[variant]).map(([k, v]) => `${k} ${v}`).join(', ');

function french(f: Filled): string {
  const fonts = f.fonts.length ? `\`${f.fonts[0]}\`` : f.template ? '`<police de titre>` parmi la liste approuvée ci-dessous (facultatif)' : 'à ton choix, parmi la liste approuvée ci-dessous';
  const universal = f.universal ? `
## Règles propres au thème universel (elles passent avant le reste)

Un thème **universel** est un thème par défaut des univers qui n'ont ni thème à eux ni domaine, dans
tous les pays et les 20 langues : calme, accueillant, sans sujet imposé, reconnaissable comme
break.rocks ; il laisse toute la place aux posts de la communauté.

- **Neutre et universel** : aucune scène liée à un pays, une culture, une religion, une saison
  marquée, un sport, une marque ou un métier ; aucun monument, aucun bâtiment reconnaissable, aucune
  personne, aucun animal au premier plan, aucun drapeau, aucun texte.
- **La palette de Socle**, pas une palette inventée : nuit ${socle('night')} ; jour ${socle('day')}.
  Tu peux teinter très légèrement les familles \`page\`, \`sky\` et \`block\` (2 à 4 % vers la couleur
  dominante des images), jamais \`control\` ni les couleurs d'accent.
- **Police** : \`${SOCLE_TYPEFACE}\` (les écritures qu'elle n'a pas prennent la police de l'appareil).
- **Aucun domaine** : pas de clé \`collection\`.
- **Images encore plus calmes** : saturation faible, contrastes doux, grandes zones unies, aucune ligne
  forte qui traverse l'image, rien qui attire l'œil au centre ; nuit et jour également lisibles.
- **Poids** : ce thème sera servi à des milliers d'univers ; 400 Ko au plus par image de page (JPEG
  qualité 80), sans perte visible.
` : '';
  return `Tu es directeur artistique et développeur front. Tu crées un **thème** pour break.rocks, un réseau
social organisé en univers (communautés gouvernées par leurs résidents), utilisé en nuit, nuit
atténuée et jour, sur ordinateur, tablette et téléphone. Deux livrables :

1. un fichier \`theme.json\` au format \`break-rocks-theme/2\` ;
2. les **4 images** du thème (la page et le ciel, de jour et de nuit), nommées exactement comme le JSON les référence.

## Ce que je veux

- ${f.universal ? 'Thème **universel** (aucun domaine)' : `Domaine : ${f.fieldText}`}
- ${f.universal ? 'Scène et identité' : 'Ambiance'} : ${f.mood}
- Nom du thème : \`${f.name}\`
- Description (160 caractères au plus) : ${f.description ?? (f.template ? '`<une phrase>`' : 'une phrase, à écrire par toi')}
- Univers où il sera publié : \`${f.universe}\`
- Police de titre : ${fonts}
${universal}
## Où le thème se voit

Sur **toutes les pages d'un univers**, en **quatre familles de surfaces** et **deux images** :

- \`page\` : la page, autour et entre les blocs, sous les posts (un post n'a pas de carte : il est posé sur la page) ;
- \`sky\` : le ciel de l'univers (la barre d'identité, la colonne du ciel, la bannière de l'univers) ;
- \`block\` : chaque bloc de la page (un widget, une carte de la colonne du temps, une tuile de la bande du
  temps, la citation dans un post, l'en-tête et les bulles d'un channel, un bloc libre, un rail) ;
- \`control\` : les boutons, les badges, les puces (la barre des focus, le sélecteur de disposition) et
  les liens ; un lien et un bouton secondaire prennent son \`background\` comme couleur de texte.

L'image \`page\` est derrière la page ; l'image \`pageHeader\` derrière le ciel. **La plateforme fixe la
forme** : les rayons (un post 0, un bloc 20 px, un contrôle 12 px), aucun trait ni bordure autour d'une
surface, l'opacité des blocs ; le thème ne donne que des couleurs. **Comment l'image de la page se voit**
se choisit dans l'apparence de l'univers, pas dans le JSON : \`none\` (aucune image), \`subtle\` (par
défaut : la page couvre l'image à l'opacité du lecteur, 64 % par défaut, sur tablette et ordinateur) ou
\`through\` (l'image se voit derrière les blocs, à toutes les tailles). Dans les deux derniers cas, chaque
texte et chaque contrôle posés sur l'image ont sous eux le **masque de lisibilité** : la couleur de \`page\`
à une opacité que la plateforme calcule à la publication pour cette image (jamais sous 60 %). Choisis
donc des images qui restent belles sous un voile de la couleur de \`page\`.

## Le JSON (\`theme.json\`)

Produis exactement cette structure, sans autre clé. Les couleurs sont des \`#RRGGBB\`.

\`\`\`json
${skeleton(f, 'mêmes clés que la nuit, couleurs du jour', '<une phrase>', f.template ? '<police approuvée>' : '<police approuvée>')}
\`\`\`

Règles du JSON :

- **Palette** : les six couleurs \`background\`, \`surface\`, \`text\`, \`primary\`, \`accent\`, \`link\`, par variante.
- **Surfaces de thème** : les quatre familles \`page\`, \`sky\`, \`block\`, \`control\`, chacune avec
  \`background\`, \`text\` et \`secondaryText\` (tous facultatifs ; une couleur absente prend la palette :
  \`page\` le \`background\`, \`sky\` et \`block\` la \`surface\`, \`control\` le \`primary\`). **Aucune autre surface**
  (les anciennes, \`postCard\`, \`widget\`, \`primaryButton\`…, sont dépréciées), **aucune** \`border\`, **aucune**
  \`opacity\`.
- **Contraste** (WCAG 2, vérifié à la publication, en nuit, nuit atténuée et jour) : **4,5:1 au moins**
  entre \`text\` et \`background\` et entre \`text\` et \`surface\` de la palette, et entre \`text\` et
  \`background\`, \`secondaryText\` et \`background\` de chaque famille (donne toujours \`secondaryText\`) ;
  **3:1 au moins** entre \`primary\`, \`accent\`, \`link\` et \`background\`, et entre le \`background\` de
  \`control\` et celui de \`page\`, \`sky\` et \`block\`. Une couleur trop faible est relevée à la
  publication : choisis-les justes.
- **Police** : \`typography.title\` obligatoire (titres, chiffres et libellés courts des widgets),
  **uniquement** parmi : ${typefaceNames().join(', ')}. Aucune police pour le texte courant, aucune
  police d'accent.
- **Dégradé** : 2 ou 3 couleurs **prises dans la palette**.
- **Images** : les emplacements \`page\` et \`pageHeader\` seulement ; au plus **8** références en tout
  (variantes nuit, \`wordmark\` et \`pattern\` compris) ; sans variante nuit, l'image du jour sert la nuit.
  Référence les fichiers par leur **nom** : \`breakrocks theme publish\` les remplace par les identifiants d'envoi.
- **Interdit** : les clés \`scrims\` (le masque de lisibilité compris), \`textScrims\`, \`screenshots\`,
  \`creator\`, \`version\`, \`copiedFrom\` (calculées par la plateforme) ; \`surfaceRadius\`, \`shape\`,
  \`surfaceOpacity\`, \`textBackdrop\` (ignorées) ; toute URL, police ou feuille de style externe.

## Les images

**Photographies réalistes** (lumière naturelle crédible), cohérentes entre elles et avec la palette,
**sans texte, sans logo, sans marque, sans drapeau, sans personne reconnaissable**. **Recadrage sûr** :
l'image \`page\` est recadrée en 21:9 sur ordinateur et en 9:19,5 sur téléphone : l'intérêt dans le
tiers central, des zones calmes et peu contrastées sur au moins 60 % de l'image (le masque de
lisibilité y sera plus léger). **Nuit** : sombre, contrastes doux, quelques points lumineux qui
rappellent \`accent\`. **Jour** : clair, doux, légèrement désaturé, sans surexposition.

| Fichier | Emplacement | Taille | Contenu |
|---|---|---|---|
| \`page-night.jpg\`, \`page-day.jpg\` | derrière toutes les pages de l'univers | 2 400 × 1 800 px (4:3) | la scène principale |
| \`page-header-night.jpg\`, \`page-header-day.jpg\` | le ciel de l'univers (sa bannière) | 2 400 × 800 px (3:1, au moins 1 500 × 500) | un panorama de la scène |

JPEG (qualité 85) ou WebP, sRGB, **5 Mo au plus** chacune, sans métadonnées de localisation. Si tu ne
peux pas produire une image, mets l'emplacement à \`null\` plutôt que de référencer un fichier absent.

## Rendu attendu

1. \`theme.json\` complet.
2. La liste des fichiers avec, pour chacun, le prompt d'image en anglais ; les images si tu sais en produire.
3. Trois lignes qui expliquent les choix (palette, police, scènes).
4. Le tableau des contrastes calculés (paire, ratio).

Ensuite : \`breakrocks theme check theme.json\` montre les couleurs que la plateforme relèverait et le
masque de lisibilité qu'elle calculerait ; \`breakrocks theme publish theme.json --in <univers>\` le publie.
`;
}

function english(f: Filled): string {
  const fonts = f.fonts.length ? `\`${f.fonts[0]}\`` : f.template ? '`<title typeface>` from the approved list below (optional)' : 'your choice, from the approved list below';
  const universal = f.universal ? `
## Rules of the universal theme (they go before the rest)

A **universal** theme is a default theme of the universes that have neither a theme of their own nor
a field, in every country and the 20 languages: calm, welcoming, without an imposed subject,
recognizable as break.rocks; it leaves all the room to the posts of the community.

- **Neutral and universal**: no scene tied to a country, a culture, a religion, a marked season, a
  sport, a brand or a trade; no monument, no recognizable building, no person, no animal in the
  foreground, no flag, no text.
- **The palette of Socle**, not an invented one: night ${socle('night')}; day ${socle('day')}. You may
  tint the families \`page\`, \`sky\` and \`block\` very slightly (2 to 4 % toward the dominant color of the
  images), never \`control\` nor the accent colors.
- **Typeface**: \`${SOCLE_TYPEFACE}\` (the scripts it lacks take the typeface of the device).
- **No field**: no key \`collection\`.
- **Even calmer images**: low saturation, soft contrasts, wide plain areas, no strong line across
  the image, nothing that draws the eye to the center; night and day equally readable.
- **Weight**: this theme is served to thousands of universes; at most 400 KB per page image (JPEG
  quality 80), without visible loss.
` : '';
  return `You are an art director and a front-end developer. You make a **theme** for break.rocks, a social
network organized in universes (communities governed by their residents), used by night, dim night
and day, on desktop, tablet and phone. Two deliverables:

1. a file \`theme.json\` in the format \`break-rocks-theme/2\`;
2. the **4 images** of the theme (the page and the sky, by day and by night), named exactly as the JSON references them.

## What I want

- ${f.universal ? 'A **universal** theme (no field)' : `Field: ${f.fieldText}`}
- ${f.universal ? 'Scene and identity' : 'Mood'}: ${f.mood}
- Name of the theme: \`${f.name}\`
- Description (at most 160 characters): ${f.description ?? (f.template ? '`<one sentence>`' : 'one sentence, yours to write')}
- Universe it will be published in: \`${f.universe}\`
- Title typeface: ${fonts}
${universal}
## Where the theme shows

On **every page of a universe**, in **four families of surfaces** and **two images**:

- \`page\`: the page, around and between the blocks, under the posts (a post has no card: it lies on the page);
- \`sky\`: the sky of the universe (the identity bar, the sky column, the universe banner);
- \`block\`: every block of the page (a widget, a card of the time column, a tile of the time strip, the
  quote inside a post, the header and the bubbles of a channel, a free block, a rail);
- \`control\`: the buttons, the badges, the chips (the focus bar, the layout switcher) and the links; a
  link and a secondary button take its \`background\` as their text color.

The image \`page\` lies behind the page; the image \`pageHeader\` behind the sky. **The platform sets the
shape**: the radii (a post 0, a block 20 px, a control 12 px), no stroke nor border around a surface, the
opacity of the blocks; the theme gives colors only. **How the image of the page shows** is chosen in the
appearance of the universe, not in the JSON: \`none\` (no image), \`subtle\` (the default: the page covers
the image at the opacity of the reader, 64 % by default, on tablets and desktops) or \`through\` (the image
shows behind the blocks, at every size). With the last two, every text and control over the image lies on
the **readability mask**: the color of \`page\` at an opacity the platform computes at publication for that
image (never under 60 %). So choose images that stay beautiful under a veil of the color of \`page\`.

## The JSON (\`theme.json\`)

Write exactly this structure, without any other key. Colors are \`#RRGGBB\`.

\`\`\`json
${skeleton(f, 'the same keys as the night, with the colors of the day', '<one sentence>', '<an approved typeface>')}
\`\`\`

Rules of the JSON:

- **Palette**: the six colors \`background\`, \`surface\`, \`text\`, \`primary\`, \`accent\`, \`link\`, per variant.
- **Theme surfaces**: the four families \`page\`, \`sky\`, \`block\`, \`control\`, each with \`background\`,
  \`text\` and \`secondaryText\` (all optional; a color left out takes the palette: \`page\` the \`background\`,
  \`sky\` and \`block\` the \`surface\`, \`control\` the \`primary\`). **No other surface** (the former ones,
  \`postCard\`, \`widget\`, \`primaryButton\`…, are deprecated), **no** \`border\`, **no** \`opacity\`.
- **Contrast** (WCAG 2, checked at publication, by night, dim night and day): **at least 4.5:1** between
  \`text\` and \`background\` and between \`text\` and \`surface\` of the palette, and between \`text\` and
  \`background\`, \`secondaryText\` and \`background\` of each family (always give \`secondaryText\`); **at
  least 3:1** between \`primary\`, \`accent\`, \`link\` and \`background\`, and between the \`background\` of
  \`control\` and those of \`page\`, \`sky\` and \`block\`. A color too weak is raised at publication: choose
  them right.
- **Typeface**: \`typography.title\` required (titles, figures and short labels of the widgets), **only**
  among: ${typefaceNames().join(', ')}. No typeface for the body text, no accent typeface.
- **Gradient**: 2 or 3 colors **taken from the palette**.
- **Images**: the slots \`page\` and \`pageHeader\` only; at most **8** references in all (night variants,
  \`wordmark\` and \`pattern\` counted); without a night variant, the day image serves by night. Reference
  the files by their **name**: \`breakrocks theme publish\` replaces them with the upload ids.
- **Forbidden**: the keys \`scrims\` (the readability mask included), \`textScrims\`, \`screenshots\`,
  \`creator\`, \`version\`, \`copiedFrom\` (computed by the platform); \`surfaceRadius\`, \`shape\`,
  \`surfaceOpacity\`, \`textBackdrop\` (ignored); any external URL, typeface or stylesheet.

## The images

**Realistic photographs** (credible natural light), consistent with each other and with the palette,
**without text, logo, brand, flag or recognizable person**. **Safe crop**: the image \`page\` is cropped
to 21:9 on desktop and to 9:19.5 on phones: the interest in the central third, calm low-contrast
areas over at least 60 % of the image (the readability mask is lighter there). **Night**: dark, soft
contrasts, a few light points that recall \`accent\`. **Day**: light, soft, slightly desaturated, no
blown highlights.

| File | Slot | Size | Content |
|---|---|---|---|
| \`page-night.jpg\`, \`page-day.jpg\` | behind every page of the universe | 2,400 × 1,800 px (4:3) | the main scene |
| \`page-header-night.jpg\`, \`page-header-day.jpg\` | the sky of the universe (its banner) | 2,400 × 800 px (3:1, at least 1,500 × 500) | a panorama of the scene |

JPEG (quality 85) or WebP, sRGB, **5 MB at most** each, without location metadata. If you cannot make
an image, set its slot to \`null\` rather than reference a missing file.

## Expected output

1. \`theme.json\`, complete.
2. The list of the files with, for each, its image prompt in English; the images if you can make them.
3. Three lines that explain the choices (palette, typeface, scenes).
4. The table of the contrasts computed (pair, ratio).

Then: \`breakrocks theme check theme.json\` shows the colors the platform would raise and the readability
mask it would compute; \`breakrocks theme publish theme.json --in <universe>\` publishes it.
`;
}
