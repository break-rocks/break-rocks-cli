// `theme prompt`: the theme prompt of the platform (the common specifications of the theme
// prompts, 2026-10-27, the opacities and the text backdrops), filled with
// the field, the mood, the name, the universe and the typefaces, to give to an AI that writes the
// theme.json and its images. --universal: the prompt of a universal theme (no
// field, the palette and the title typeface of Socle, its own rules). Offline: the approved
// typefaces and the image sizes are shipped with the CLI. In French or English.
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

export type PromptInput = { field?: string; mood: string; name: string; universe?: string; description?: string; fonts?: string[]; language?: Language; universal?: boolean };
export type PromptResult = { prompt: string; language: Language; field: Field | null; name: string; universe: string; fonts: string[]; universal: boolean };

/** The prompt filled; the field, the name, the universe and the typefaces checked first (exit 2). */
export function themePrompt(input: PromptInput): PromptResult {
  const language = input.language ?? 'en';
  const universal = !!input.universal;
  if (universal && input.field) throw usageError('INVALID_INPUT', 'A universal theme has no field: --universal without --field');
  if (!universal && !input.field) throw usageError('INVALID_INPUT', 'The field is required (--field), or --universal for a universal theme');
  const field = universal ? null : fieldOf(input.field!);
  const name = input.name.trim();
  if (!validThemeName(name)) throw usageError('THEME_NAME_INVALID', 'A theme name has 2 to 64 letters, digits, "-", "_" or ".", beginning with a letter, without ".." nor a final "."');
  const universe = (input.universe ?? (universal ? '%root' : '')).trim();
  if (!universe) throw usageError('INVALID_INPUT', 'The universe is required (--universe %name)');
  if (!/^%\S+$/.test(universe)) throw usageError('THEME_UNIVERSE_INVALID', 'The universe is an address beginning with "%" (%name)');
  let fonts = (input.fonts ?? []).map((f) => {
    const face = approvedTypeface(f);
    if (!face) throw usageError('THEME_TYPEFACE_NOT_APPROVED', `"${f}" is not an approved typeface (breakrocks theme typefaces)`, { typeface: f });
    return face.name;
  });
  if (fonts.length > 2) throw usageError('INVALID_INPUT', 'At most two typefaces: the title one, then the accent one');
  if (universal) {
    if (fonts.some((f) => f !== SOCLE_TYPEFACE)) throw usageError('INVALID_INPUT', `A universal theme has the typeface of Socle, ${SOCLE_TYPEFACE}`);
    fonts = [SOCLE_TYPEFACE, SOCLE_TYPEFACE];
  }
  const mood = input.mood.trim();
  const description = input.description?.trim();
  const filled: Filled = { field, mood, name, universe, description, fonts, universal };
  const prompt = (language === 'fr' ? french : english)(filled);
  return { prompt, language, field, name, universe, fonts, universal };
}

type Filled = { field: Field | null; mood: string; name: string; universe: string; description?: string; fonts: string[]; universal: boolean };

/** The opacities of the skeleton: examples within the guides of the common specifications (a universal theme: its own). */
const OPACITY = {
  field: { page: 15, pageHeader: 25, focusBar: 25, rail: 25, postCard: 45, quoteCard: 80, timeColumnCard: 55, widget: 60, liveLine: 55, channelHeader: 50, channelBubble: 85 },
  universal: { page: 8, pageHeader: 20, focusBar: 20, rail: 20, postCard: 48, quoteCard: 80, timeColumnCard: 55, widget: 60, liveLine: 55, channelHeader: 50, channelBubble: 85 },
};

function skeleton(f: Filled, sameKeys: string, descriptionPlaceholder: string, accentPlaceholder: string): string {
  const color = (k: string, variant: 'night' | 'day') => (f.universal ? SOCLE_PALETTE[variant][k as keyof typeof SOCLE_PALETTE.night] : '#…');
  const palette = (variant: 'night' | 'day') => Object.fromEntries(['background', 'surface', 'text', 'primary', 'accent', 'link'].map((k) => [k, color(k, variant)]));
  const four = { background: '#…', text: '#…', secondaryText: '#…', border: '#…' };
  const ops = f.universal ? OPACITY.universal : OPACITY.field;
  const surfaces = {
    ...Object.fromEntries(Object.entries(ops).map(([k, opacity]) => [k, { ...four, opacity }])),
    badge: { background: '#…', text: '#…', secondaryText: '#…', opacity: 100 },
    primaryButton: { background: '#…', text: '#…', secondaryText: '#…', opacity: 100 },
    secondaryButton: { ...four, opacity: 100 },
  };
  return JSON.stringify({
    format: 'break-rocks-theme/2', universe: f.universe, name: f.name, description: f.description ?? descriptionPlaceholder, ...(f.field ? { collection: f.field } : {}),
    variants: { night: { palette: palette('night'), surfaces }, day: { palette: palette('day'), surfaces: { '...': sameKeys } } },
    surfaceRadius: { postCard: 'soft', primaryButton: 'round' },
    surfaceOpacity: 85, textBackdrop: 'block',
    typography: { title: f.fonts[0] ?? '<…>', accent: f.fonts[1] ?? accentPlaceholder },
    gradient: ['#…', '#…'], motionAccents: true, shape: { radius: 'soft', stroke: 'regular' },
    imageSlots: {
      page: { day: 'page-day.jpg', night: 'page-night.jpg' }, pageHeader: { day: 'page-header-day.jpg', night: 'page-header-night.jpg' },
      timeColumn: { day: 'time-column-day.jpg', night: 'time-column-night.jpg' }, channelHeader: { day: 'channel-header-day.jpg' }, cardTexture: { day: 'card-texture-day.jpg' },
    },
    images: { wordmark: null, pattern: null }, stickers: [],
  }, null, 2);
}

const SURFACES = 'page, pageHeader, focusBar, rail, widget, postCard, repostCard, quoteCard, replyCard, headRow, timeColumnCard, liveLine, channelHeader, channelBubble, block, badge, divider, link, primaryButton, secondaryButton';
const socle = (variant: 'night' | 'day') => Object.entries(SOCLE_PALETTE[variant]).map(([k, v]) => `${k} ${v}`).join(', ');

function french(f: Filled): string {
  const fonts = f.fonts.length ? `\`${f.fonts[0]}\`${f.fonts[1] ? ` et \`${f.fonts[1]}\`` : ''}` : 'à ton choix, parmi la liste approuvée ci-dessous';
  const universal = f.universal ? `
## Règles propres au thème universel (elles passent avant le reste)

Un thème **universel** est un thème par défaut des univers qui n'ont ni thème à eux ni domaine, dans
tous les pays et les 20 langues : calme, accueillant, sans sujet imposé, reconnaissable comme
break.rocks ; il laisse toute la place aux posts de la communauté.

- **Neutre et universel** : aucune scène liée à un pays, une culture, une religion, une saison
  marquée, un sport, une marque ou un métier ; aucun monument, aucun bâtiment reconnaissable, aucune
  personne, aucun animal au premier plan, aucun drapeau, aucun texte.
- **La palette de Socle**, pas une palette inventée : nuit ${socle('night')} ; jour ${socle('day')}
  (\`#FCFBF8\` au plus clair pour la surface \`page\`). Tu peux teinter très légèrement les surfaces
  (2 à 4 % vers la couleur dominante des images), jamais les couleurs d'accent.
- **Police** : \`${SOCLE_TYPEFACE}\` en titre et en accent (les écritures qu'elle n'a pas prennent la
  police de l'appareil).
- **Aucun domaine** : pas de clé \`collection\`.
- **Images encore plus calmes** : saturation faible, contrastes doux, grandes zones unies, aucune ligne
  forte qui traverse l'image, rien qui attire l'œil au centre ; nuit et jour également lisibles.
- **Opacités** : \`page\` entre 0 et 15, \`pageHeader\` et \`focusBar\` entre 10 et 30, les cartes de post
  entre 40 et 55, \`quoteCard\` 80, le reste comme ci-dessous.
- **Poids** : ce thème sera servi à des milliers d'univers ; 400 Ko au plus par image de page (JPEG
  qualité 80), sans perte visible.
` : '';
  return `Tu es directeur artistique et développeur front. Tu crées un **thème** pour break.rocks, un réseau
social organisé en univers (communautés gouvernées par leurs résidents), utilisé en nuit, nuit
atténuée et jour, sur ordinateur, tablette et téléphone. Deux livrables :

1. un fichier \`theme.json\` au format \`break-rocks-theme/2\` ;
2. les **8 images** du thème, nommées exactement comme le JSON les référence.

## Ce que je veux

- ${f.universal ? 'Thème **universel** (aucun domaine)' : `Domaine : ${FIELD_WORDS[f.field!].fr} (\`${f.field}\`)`}
- ${f.universal ? 'Scène et identité' : 'Ambiance'} : ${f.mood}
- Nom du thème : \`${f.name}\`
- Description (160 caractères au plus) : ${f.description ?? 'une phrase, à écrire par toi'}
- Univers où il sera publié : \`${f.universe}\`
- Polices : ${fonts}
${universal}
## Où le thème se voit

Sur **toutes les pages d'un univers**. **Toutes les surfaces sont transparentes à volonté** : chacune a
une \`opacity\` (0 à 100 %), et l'image \`page\` se voit à travers tout ce qui n'est pas opaque. Sous
chaque **bloc de texte** posé sur une surface transparente, la plateforme dessine un **voile de
texte** dont l'opacité est calculée selon le style du texte (4,5:1 pour le texte courant, 3:1 pour
les titres et les contrôles) : le texte reste lisible même sur une surface à 0 %. La **barre
d'identité** est la surface \`pageHeader\` ; la **navigation** de l'univers (onglets, barre du bas du
téléphone, menu replié, sélecteur de disposition) est la surface \`focusBar\` ; un **rail** de widgets
est la surface \`rail\` : donne-leur une opacité faible pour que l'image de la page se voie derrière.
Les images des posts restent opaques.

## Le JSON (\`theme.json\`)

Produis exactement cette structure, sans autre clé. Les couleurs sont des \`#RRGGBB\` ; les opacités
sont des exemples, à choisir.

\`\`\`json
${skeleton(f, 'mêmes clés que la nuit, couleurs du jour', '<une phrase>', '<police approuvée, facultatif>')}
\`\`\`

Règles du JSON :

- **Contraste** (WCAG 2, vérifié à la publication) : **4,5:1 au moins** entre \`text\` et \`background\`
  et entre \`text\` et \`surface\` de la palette, et entre \`text\` et \`background\` de chaque surface ;
  \`secondaryText\` 4,5:1 sur son \`background\`, **y compris pour \`badge\`, \`primaryButton\` et
  \`secondaryButton\`** (donne-le toujours : sans lui, la plateforme le calcule et le corrige souvent) ;
  **3:1 au moins** entre \`primary\`, \`accent\`, \`link\` et \`background\`, et pour chaque \`border\`. Les
  contrastes se calculent avec le \`background\` de chaque surface comme s'il était opaque. Une couleur
  trop faible est relevée à la publication : choisis-les justes.
- **Surfaces de thème** parmi : ${SURFACES}. Chacune donne \`background\`, \`text\`, \`secondaryText\`,
  \`border\` et \`opacity\` (tous facultatifs) ; une surface absente prend la palette.
- **Transparence** : \`opacity\` est un entier de **0 à 100** (pour cent), par surface et par variante
  (nuit et jour peuvent différer) ; \`surfaceOpacity\` (0 à 100) vaut pour toutes les surfaces sans
  \`opacity\`. Fais-en un choix de design, pas une valeur unique partout. Repères : \`page\` 0 à 30
  (l'image doit se voir) ; \`pageHeader\`, \`focusBar\`, \`rail\` 0 à 40 ; \`widget\`, \`liveLine\`,
  \`timeColumnCard\`, \`channelHeader\` 30 à 80 ; les cartes de post (\`postCard\`, \`repostCard\`,
  \`replyCard\`) **30 à 60** (les textes des posts ont leur voile) ; \`quoteCard\` **80** ;
  \`channelBubble\` 70 à 100 ; \`badge\`, \`primaryButton\`, \`secondaryButton\` **100** (une valeur plus
  basse est relevée à 100). Les deux variantes mettent en valeur l'image : pas de fond plein (100)
  sur la barre d'identité ou la navigation en jour seulement.
- **Voile de texte** : \`textBackdrop\` vaut \`block\` (un voile sous chaque bloc de texte, la surface
  garde ton opacité : recommandé) ou \`surface\` (pas de voile de texte : la plateforme relève
  l'opacité de toute la surface jusqu'au contraste AA).
- **Rayons** : \`surfaceRadius.<surface>\` et \`shape.radius\` valent \`sharp\`, \`soft\` ou \`round\` ;
  \`shape.stroke\` vaut \`thin\`, \`regular\` ou \`bold\`.
- **Polices** : \`typography.title\` obligatoire, \`typography.accent\` facultatif (chiffres, compteurs,
  badges), **uniquement** parmi : ${typefaceNames().join(', ')}. Aucune police pour le texte courant.
- **Dégradé** : 2 ou 3 couleurs **prises dans la palette**.
- **Images** : au plus **8** références en tout (emplacements, variantes nuit, \`wordmark\` et
  \`pattern\` compris) ; sans variante nuit, l'image du jour sert la nuit. Référence les fichiers par
  leur **nom** : l'atelier (ou \`breakrocks theme publish\`) les remplace par les identifiants d'envoi.
- **Interdit** : les clés \`scrims\`, \`textScrims\`, \`screenshots\`, \`creator\`, \`version\`,
  \`copiedFrom\` (calculées par la plateforme) ; toute URL, police ou feuille de style externe.

## Les images

**Photographies réalistes** (lumière naturelle crédible), cohérentes entre elles et avec la palette,
**sans texte, sans logo, sans marque, sans drapeau, sans personne reconnaissable**. **Recadrage sûr** :
l'image \`page\` est recadrée en 21:9 sur ordinateur et en 9:19,5 sur téléphone : l'intérêt dans le
tiers central, des zones calmes et peu contrastées sur au moins 60 % de l'image. **Nuit** : sombre,
contrastes doux, quelques points lumineux qui rappellent \`accent\`. **Jour** : clair, doux, légèrement
désaturé, sans surexposition.

| Fichier | Emplacement | Taille | Contenu |
|---|---|---|---|
| \`page-night.jpg\`, \`page-day.jpg\` | derrière toutes les pages de l'univers | 2 400 × 1 800 px (4:3) | la scène principale |
| \`page-header-night.jpg\`, \`page-header-day.jpg\` | bannière d'univers | 2 400 × 800 px (3:1) | un panorama de la scène |
| \`time-column-night.jpg\`, \`time-column-day.jpg\` | derrière la colonne du temps | 1 200 × 1 600 px (3:4) | un détail vertical très calme |
| \`channel-header-day.jpg\` | tête des channels et des débats | 2 400 × 800 px (3:1) | un lieu de rencontre ou de conversation |
| \`card-texture-day.jpg\` | derrière les cartes de post, répétée | 1 024 × 1 024 px, **raccordable** | une matière discrète, contraste très faible |

JPEG (qualité 85) ou WebP, sRGB, **5 Mo au plus** chacune, sans métadonnées de localisation. Si tu ne
peux pas produire une image, mets l'emplacement à \`null\` plutôt que de référencer un fichier absent.

## Rendu attendu

1. \`theme.json\` complet.
2. La liste des fichiers avec, pour chacun, le prompt d'image en anglais ; les images si tu sais en produire.
3. Trois lignes qui expliquent les choix (palette, polices, scènes).
4. Le tableau des contrastes calculés (paire, ratio).

Ensuite : \`breakrocks theme check theme.json\` montre les contrastes et les opacités que la plateforme
relèverait et les voiles de texte qu'elle calculerait.
`;
}

function english(f: Filled): string {
  const fonts = f.fonts.length ? `\`${f.fonts[0]}\`${f.fonts[1] ? ` and \`${f.fonts[1]}\`` : ''}` : 'your choice, from the approved list below';
  const universal = f.universal ? `
## Rules of the universal theme (they go before the rest)

A **universal** theme is a default theme of the universes that have neither a theme of their own nor
a field, in every country and the 20 languages: calm, welcoming, without an imposed subject,
recognizable as break.rocks; it leaves all the room to the posts of the community.

- **Neutral and universal**: no scene tied to a country, a culture, a religion, a marked season, a
  sport, a brand or a trade; no monument, no recognizable building, no person, no animal in the
  foreground, no flag, no text.
- **The palette of Socle**, not an invented one: night ${socle('night')}; day ${socle('day')}
  (\`#FCFBF8\` at the lightest for the surface \`page\`). You may tint the surfaces very slightly (2 to
  4 % toward the dominant color of the images), never the accent colors.
- **Typeface**: \`${SOCLE_TYPEFACE}\` for the title and the accent (the scripts it lacks take the
  typeface of the device).
- **No field**: no key \`collection\`.
- **Even calmer images**: low saturation, soft contrasts, wide plain areas, no strong line across
  the image, nothing that draws the eye to the center; night and day equally readable.
- **Opacities**: \`page\` from 0 to 15, \`pageHeader\` and \`focusBar\` from 10 to 30, the post cards
  from 40 to 55, \`quoteCard\` 80, the rest as below.
- **Weight**: this theme is served to thousands of universes; at most 400 KB per page image (JPEG
  quality 80), without visible loss.
` : '';
  return `You are an art director and a front-end developer. You make a **theme** for break.rocks, a social
network organized in universes (communities governed by their residents), used by night, dim night
and day, on desktop, tablet and phone. Two deliverables:

1. a file \`theme.json\` in the format \`break-rocks-theme/2\`;
2. the **8 images** of the theme, named exactly as the JSON references them.

## What I want

- ${f.universal ? 'A **universal** theme (no field)' : `Field: ${FIELD_WORDS[f.field!].en} (\`${f.field}\`)`}
- ${f.universal ? 'Scene and identity' : 'Mood'}: ${f.mood}
- Name of the theme: \`${f.name}\`
- Description (at most 160 characters): ${f.description ?? 'one sentence, yours to write'}
- Universe it will be published in: \`${f.universe}\`
- Typefaces: ${fonts}
${universal}
## Where the theme shows

On **every page of a universe**. **Every surface may be transparent**: each has an \`opacity\` (0 to
100 %), and the image \`page\` shows through everything that is not opaque. Under each **text run**
laid over a transparent surface, the platform draws a **text backdrop** whose opacity is computed for
the style of the text (4.5:1 for body text, 3:1 for titles and controls): the text stays readable even
on a surface at 0 %. The **identity bar** is the surface \`pageHeader\`; the **navigation** of the
universe (tabs, the bottom bar of the phone, the folded menu, the layout switcher) is the surface
\`focusBar\`; a **rail** of widgets is the surface \`rail\`: give them a low opacity so that the image
of the page shows behind them. The media of the posts stay opaque.

## The JSON (\`theme.json\`)

Write exactly this structure, without any other key. Colors are \`#RRGGBB\`; the opacities are
examples, yours to choose.

\`\`\`json
${skeleton(f, 'the same keys as the night, with the colors of the day', '<one sentence>', '<an approved typeface, optional>')}
\`\`\`

Rules of the JSON:

- **Contrast** (WCAG 2, checked at publication): **at least 4.5:1** between \`text\` and \`background\`
  and between \`text\` and \`surface\` of the palette, and between \`text\` and \`background\` of each
  surface; \`secondaryText\` 4.5:1 on its \`background\`, **\`badge\`, \`primaryButton\` and
  \`secondaryButton\` included** (always give it: without it, the platform computes it and often
  corrects it); **at least 3:1** between \`primary\`, \`accent\`, \`link\` and \`background\`, and for each
  \`border\`. The contrasts are computed with the \`background\` of each surface as if it were opaque. A
  color too weak is raised at publication: choose them right.
- **Theme surfaces** among: ${SURFACES}. Each gives \`background\`, \`text\`, \`secondaryText\`,
  \`border\` and \`opacity\` (all optional); a surface left out takes the palette.
- **Transparency**: \`opacity\` is an integer from **0 to 100** (percent), by surface and by variant
  (night and day may differ); \`surfaceOpacity\` (0 to 100) applies to every surface without an
  \`opacity\`. Make it a design choice, not one value everywhere. Guides: \`page\` 0 to 30 (the image
  must show); \`pageHeader\`, \`focusBar\`, \`rail\` 0 to 40; \`widget\`, \`liveLine\`, \`timeColumnCard\`,
  \`channelHeader\` 30 to 80; the post cards (\`postCard\`, \`repostCard\`, \`replyCard\`) **30 to 60**
  (the texts of the posts have their backdrops); \`quoteCard\` **80**; \`channelBubble\` 70 to 100;
  \`badge\`, \`primaryButton\`, \`secondaryButton\` **100** (a lower value is raised to 100). Both
  variants show the image: no plain background (100) on the identity bar or the navigation by day only.
- **Text backdrop**: \`textBackdrop\` is \`block\` (a backdrop under each text run, the surface keeps
  your opacity: recommended) or \`surface\` (no text backdrop: the platform raises the opacity of the
  whole surface to the contrast AA).
- **Radii**: \`surfaceRadius.<surface>\` and \`shape.radius\` are \`sharp\`, \`soft\` or \`round\`;
  \`shape.stroke\` is \`thin\`, \`regular\` or \`bold\`.
- **Typefaces**: \`typography.title\` required, \`typography.accent\` optional (figures, counts,
  badges), **only** among: ${typefaceNames().join(', ')}. No typeface for the body text.
- **Gradient**: 2 or 3 colors **taken from the palette**.
- **Images**: at most **8** references in all (slots, night variants, \`wordmark\` and \`pattern\`
  counted); without a night variant, the day image serves by night. Reference the files by their
  **name**: the studio (or \`breakrocks theme publish\`) replaces them with the upload ids.
- **Forbidden**: the keys \`scrims\`, \`textScrims\`, \`screenshots\`, \`creator\`, \`version\`,
  \`copiedFrom\` (computed by the platform); any external URL, typeface or stylesheet.

## The images

**Realistic photographs** (credible natural light), consistent with each other and with the palette,
**without text, logo, brand, flag or recognizable person**. **Safe crop**: the image \`page\` is cropped
to 21:9 on desktop and to 9:19.5 on phones: the interest in the central third, calm low-contrast
areas over at least 60 % of the image. **Night**: dark, soft contrasts, a few light points that recall
\`accent\`. **Day**: light, soft, slightly desaturated, no blown highlights.

| File | Slot | Size | Content |
|---|---|---|---|
| \`page-night.jpg\`, \`page-day.jpg\` | behind every page of the universe | 2,400 × 1,800 px (4:3) | the main scene |
| \`page-header-night.jpg\`, \`page-header-day.jpg\` | universe banner | 2,400 × 800 px (3:1) | a panorama of the scene |
| \`time-column-night.jpg\`, \`time-column-day.jpg\` | behind the time column | 1,200 × 1,600 px (3:4) | a very calm vertical detail |
| \`channel-header-day.jpg\` | the head of the channels and the debates | 2,400 × 800 px (3:1) | a place of meeting or conversation |
| \`card-texture-day.jpg\` | behind the post cards, repeated | 1,024 × 1,024 px, **seamless** | a discreet material, very low contrast |

JPEG (quality 85) or WebP, sRGB, **5 MB at most** each, without location metadata. If you cannot make
an image, set its slot to \`null\` rather than reference a missing file.

## Expected output

1. \`theme.json\`, complete.
2. The list of the files with, for each, its image prompt in English; the images if you can make them.
3. Three lines that explain the choices (palette, typefaces, scenes).
4. The table of the contrasts computed (pair, ratio).

Then: \`breakrocks theme check theme.json\` shows the contrasts and the opacities the platform would
raise and the text backdrops it would compute.
`;
}
