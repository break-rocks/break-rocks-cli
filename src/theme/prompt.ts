// `theme prompt` (C-22): the prompt of THEME-IA-PROMPT.md (break.rocks, 2026-10-23, specs v48.3.3),
// filled with the field, the mood, the name, the universe and the typefaces, to give to an AI that
// writes the theme.json and its images. Offline: the approved typefaces and the image sizes are
// shipped with the CLI. In French (the text of the prompt) or English.
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

/** The field named in any of its forms (SPORT, sport, "vie quotidienne"…), THEME_FIELD_INVALID otherwise. */
export function fieldOf(value: string): Field {
  const v = value.trim().toLowerCase();
  for (const field of FIELDS) {
    const words = FIELD_WORDS[field];
    if ([field.toLowerCase(), words.en, words.fr, ...words.aliases].includes(v)) return field;
  }
  throw usageError('THEME_FIELD_INVALID', `"${value}" is not a field: ${FIELDS.map((f) => FIELD_WORDS[f].en).join(', ')}`);
}

export type PromptInput = { field: string; mood: string; name: string; universe: string; description?: string; fonts?: string[]; language?: Language };
export type PromptResult = { prompt: string; language: Language; field: Field; name: string; universe: string; fonts: string[] };

/** The prompt filled; the name, the universe and the typefaces checked first (exit 2). */
export function themePrompt(input: PromptInput): PromptResult {
  const language = input.language ?? 'en';
  const field = fieldOf(input.field);
  const name = input.name.trim();
  if (!validThemeName(name)) throw usageError('THEME_NAME_INVALID', 'A theme name has 2 to 64 letters, digits, "-", "_" or ".", beginning with a letter, without ".." nor a final "."');
  const universe = input.universe.trim();
  if (!/^%\S+$/.test(universe)) throw usageError('THEME_UNIVERSE_INVALID', 'The universe is an address beginning with "%" (%name)');
  const fonts = (input.fonts ?? []).map((f) => {
    const face = approvedTypeface(f);
    if (!face) throw usageError('THEME_TYPEFACE_NOT_APPROVED', `"${f}" is not an approved typeface (breakrocks theme typefaces)`, { typeface: f });
    return face.name;
  });
  if (fonts.length > 2) throw usageError('INVALID_INPUT', 'At most two typefaces: the title one, then the accent one');
  const mood = input.mood.trim();
  const description = input.description?.trim();
  const prompt = (language === 'fr' ? french : english)({ field, mood, name, universe, description, fonts, words: FIELD_WORDS[field] });
  return { prompt, language, field, name, universe, fonts };
}

type Filled = { field: Field; mood: string; name: string; universe: string; description?: string; fonts: string[]; words: { en: string; fr: string } };

function skeleton(f: Filled, sameKeys: string, descriptionPlaceholder: string, accentPlaceholder: string): string {
  return JSON.stringify({
    format: 'break-rocks-theme/2', universe: f.universe, name: f.name, description: f.description ?? descriptionPlaceholder, collection: f.field,
    variants: {
      night: {
        palette: { background: '#…', surface: '#…', text: '#…', primary: '#…', accent: '#…', link: '#…' },
        surfaces: {
          page: { background: '#…', text: '#…', secondaryText: '#…', border: '#…' },
          postCard: { background: '#…', text: '#…', secondaryText: '#…', border: '#…' },
          primaryButton: { background: '#…', text: '#…' },
        },
      },
      day: { palette: { background: '#…', surface: '#…', text: '#…', primary: '#…', accent: '#…', link: '#…' }, surfaces: { '...': sameKeys } },
    },
    surfaceRadius: { postCard: 'soft', primaryButton: 'round' },
    typography: { title: f.fonts[0] ?? '<…>', accent: f.fonts[1] ?? accentPlaceholder },
    gradient: ['#…', '#…'], motionAccents: true, shape: { radius: 'soft', stroke: 'regular' },
    imageSlots: {
      page: { day: 'page-day.jpg', night: 'page-night.jpg' }, pageHeader: { day: 'page-header-day.jpg', night: 'page-header-night.jpg' },
      timeColumn: { day: 'time-column-day.jpg' }, channelHeader: null, cardTexture: { day: 'card-texture-day.jpg' },
    },
    images: { wordmark: null, pattern: null }, stickers: [],
  }, null, 2);
}

const SURFACES = 'page, pageHeader, postCard, repostCard, quoteCard, replyCard, headRow, timeColumnCard, widget, rail, liveLine, focusBar, channelHeader, channelBubble, badge, divider, link, primaryButton, secondaryButton';

function french(f: Filled): string {
  const fonts = f.fonts.length ? `\`${f.fonts[0]}\`${f.fonts[1] ? ` et \`${f.fonts[1]}\`` : ''}` : 'à ton choix, parmi la liste approuvée ci-dessous';
  return `Tu es un directeur artistique et un développeur. Produis un **thème** pour break.rocks, un réseau
social organisé en univers (communautés), composé de **deux livrables** :

1. un fichier \`theme.json\` au format \`break-rocks-theme/2\` ;
2. des **images d'arrière-plan réalistes**, générées par toi, nommées comme le JSON les référence.

## Ce que je veux

- Thématique (domaine) : ${f.words.fr} (\`${f.field}\`)
- Ambiance : ${f.mood}
- Nom du thème : \`${f.name}\`
- Description (160 caractères au plus) : ${f.description ?? 'une phrase, à écrire par toi'}
- Univers où il sera publié : \`${f.universe}\`
- Polices : ${fonts}

## Le JSON (\`theme.json\`)

Produis exactement cette structure, sans autre clé. Les couleurs sont des \`#RRGGBB\`.

\`\`\`json
${skeleton(f, 'mêmes clés que la nuit, couleurs du jour', '<une phrase>', '<police approuvée, facultatif>')}
\`\`\`

Règles du JSON :

- **Palette** : 6 couleurs par variante. \`background\` et \`surface\` sombres la nuit, claires le jour ;
  \`text\` lisible sur les deux : **contraste 4,5:1 au moins** entre \`text\` et \`background\`, entre
  \`text\` et \`surface\` ; **3:1 au moins** entre \`primary\`, \`accent\`, \`link\` et \`background\` (règle
  AA, vérifiée à la publication : une couleur trop faible est relevée automatiquement, mais
  choisis-les justes).
- **Surfaces de thème** (facultatives, une par partie de l'écran que tu veux styliser) parmi :
  ${SURFACES}. Chaque surface donne \`background\`, \`text\`, \`secondaryText\`, \`border\` (tous
  facultatifs) ; même règle de contraste entre son \`text\` et son \`background\`. Une surface absente
  prend la palette.
- **Rayons** : \`surfaceRadius.<surface>\` et \`shape.radius\` valent \`sharp\`, \`soft\` ou \`round\` ;
  \`shape.stroke\` vaut \`thin\`, \`regular\` ou \`bold\`.
- **Polices** : \`typography.title\` obligatoire, \`typography.accent\` facultatif, **uniquement** parmi :
  ${typefaceNames().join(', ')}. Aucune police pour le texte courant (il reste celui de la plateforme).
- **Dégradé** : 2 ou 3 couleurs **prises dans la palette**.
- **Images** : au plus **8** références en tout (emplacements, variantes nuit, \`wordmark\` et
  \`pattern\` compris) ; chaque emplacement a une variante \`day\` et, facultativement, \`night\` (sans
  variante nuit, l'image du jour sert la nuit). Référence les fichiers par leur **nom** : l'atelier
  les remplacera par les identifiants d'envoi.
- **Interdit** : les clés \`scrims\`, \`screenshots\`, \`creator\`, \`version\`, \`copiedFrom\` (calculées
  par la plateforme) ; toute URL, police ou feuille de style externe.

## Les images

Génère des **photographies réalistes** (pas d'illustration plate), cohérentes entre elles et avec
la palette, **sans texte, sans logo, sans marque, sans personne reconnaissable**, avec de larges
zones calmes (le texte et les cartes se posent par-dessus, derrière un voile calculé par la
plateforme). La nuit : sombre, contrastée, peu de hautes lumières ; le jour : claire, douce.

| Fichier | Emplacement | Format | Taille | Contenu |
|---|---|---|---|---|
| \`page-day.jpg\`, \`page-night.jpg\` | derrière toute la page | 4:3 | 2 160 × 1 620 px | la scène principale de la thématique, horizon bas ou haut, centre calme |
| \`page-header-day.jpg\`, \`page-header-night.jpg\` | bannière d'univers | 3:1 | 2 160 × 720 px (≥ 1 500 × 500) | un panorama de la même scène |
| \`time-column-day.jpg\` | derrière la colonne du temps | 3:4 | 1 080 × 1 440 px | un détail vertical, très calme |
| \`card-texture-day.jpg\` | derrière les cartes de post, répétée | carré, **raccordable** (tuile sans couture) | 1 024 × 1 024 px | une matière discrète (grain, tissu, métal brossé, papier), contraste très faible |

JPEG ou PNG ou WebP, **5 Mo au plus** chacune. Si tu ne peux pas produire une image, laisse
l'emplacement à \`null\` dans le JSON plutôt que de référencer un fichier absent.

## Rendu attendu

1. \`theme.json\` tel que ci-dessus.
2. Les fichiers d'images nommés exactement comme dans \`imageSlots\`.
3. Trois lignes qui expliquent les choix (palette, polices, scènes).
`;
}

function english(f: Filled): string {
  const fonts = f.fonts.length ? `\`${f.fonts[0]}\`${f.fonts[1] ? ` and \`${f.fonts[1]}\`` : ''}` : 'your choice, from the approved list below';
  return `You are an art director and a developer. Make a **theme** for break.rocks, a social network
organized in universes (communities), as **two deliverables**:

1. a file \`theme.json\` in the format \`break-rocks-theme/2\`;
2. **realistic background images**, generated by you, named as the JSON references them.

## What I want

- Field: ${f.words.en} (\`${f.field}\`)
- Mood: ${f.mood}
- Name of the theme: \`${f.name}\`
- Description (at most 160 characters): ${f.description ?? 'one sentence, yours to write'}
- Universe it will be published in: \`${f.universe}\`
- Typefaces: ${fonts}

## The JSON (\`theme.json\`)

Write exactly this structure, without any other key. Colors are \`#RRGGBB\`.

\`\`\`json
${skeleton(f, 'the same keys as the night, with the colors of the day', '<one sentence>', '<an approved typeface, optional>')}
\`\`\`

Rules of the JSON:

- **Palette**: 6 colors per variant. \`background\` and \`surface\` dark by night, light by day;
  \`text\` readable on both: **a contrast of at least 4.5:1** between \`text\` and \`background\`, and
  between \`text\` and \`surface\`; **at least 3:1** between \`primary\`, \`accent\`, \`link\` and
  \`background\` (the AA rule, checked at publication: a color too weak is raised automatically, but
  choose them right).
- **Theme surfaces** (optional, one per part of the screen you want to style), among:
  ${SURFACES}. Each surface gives \`background\`, \`text\`, \`secondaryText\`, \`border\` (all
  optional); the same contrast rule between its \`text\` and its \`background\`. A surface left out
  takes the palette.
- **Radii**: \`surfaceRadius.<surface>\` and \`shape.radius\` are \`sharp\`, \`soft\` or \`round\`;
  \`shape.stroke\` is \`thin\`, \`regular\` or \`bold\`.
- **Typefaces**: \`typography.title\` required, \`typography.accent\` optional, **only** among:
  ${typefaceNames().join(', ')}. No typeface for the body text (it stays the platform's).
- **Gradient**: 2 or 3 colors **taken from the palette**.
- **Images**: at most **8** references in all (slots, night variants, \`wordmark\` and \`pattern\`
  counted); each slot has a \`day\` variant and, optionally, a \`night\` one (without a night
  variant, the day image serves by night). Reference the files by their **name**: the studio (or
  \`breakrocks theme pack\`) replaces them with the upload ids.
- **Forbidden**: the keys \`scrims\`, \`screenshots\`, \`creator\`, \`version\`, \`copiedFrom\` (computed
  by the platform); any external URL, typeface or stylesheet.

## The images

Generate **realistic photographs** (no flat illustration), consistent with each other and with
the palette, **without text, logo, brand or recognizable person**, with wide calm areas (text and
cards are laid over them, behind a scrim computed by the platform). By night: dark, contrasted, few
highlights; by day: light, soft.

| File | Slot | Format | Size | Content |
|---|---|---|---|---|
| \`page-day.jpg\`, \`page-night.jpg\` | behind the whole page | 4:3 | 2,160 × 1,620 px | the main scene of the field, horizon low or high, calm center |
| \`page-header-day.jpg\`, \`page-header-night.jpg\` | universe banner | 3:1 | 2,160 × 720 px (≥ 1,500 × 500) | a panorama of the same scene |
| \`time-column-day.jpg\` | behind the time column | 3:4 | 1,080 × 1,440 px | a vertical detail, very calm |
| \`card-texture-day.jpg\` | behind the post cards, repeated | square, **seamless** (a tile) | 1,024 × 1,024 px | a discreet material (grain, fabric, brushed metal, paper), very low contrast |

JPEG, PNG or WebP, **5 MB at most** each. If you cannot make an image, leave its slot \`null\` in
the JSON rather than reference a missing file.

## Expected output

1. \`theme.json\` as above.
2. The image files, named exactly as in \`imageSlots\`.
3. Three lines that explain the choices (palette, typefaces, scenes).
`;
}
