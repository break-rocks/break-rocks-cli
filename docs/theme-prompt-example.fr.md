Tu es directeur artistique et développeur front. Tu crées un **thème** pour break.rocks, un réseau
social organisé en univers (communautés gouvernées par leurs résidents), utilisé en nuit, nuit
atténuée et jour, sur ordinateur, tablette et téléphone. Deux livrables :

1. un fichier `theme.json` au format `break-rocks-theme/2`, tel que la plateforme l'accepte aujourd'hui ;
2. les **4 images** du thème (la page et le ciel, de jour et de nuit), nommées exactement comme le JSON les
   référence, avec pour chacune son prompt d'image.

## Ce que je veux

- Domaine : sport (`SPORT`)
- Ambiance : stade de quartier au crépuscule, les projecteurs s'allument sur une pelouse encore humide
- Nom du thème : `stade-crepuscule`
- Description (160 caractères au plus) : une phrase, à écrire par toi
- Univers où il sera publié : `%football`
- Police de titre : `Bebas Neue` (caractère d'apparence STAGE)
- L'image de la page se voit : `subtle` ; le ciel de l'univers : `column`

## Où le thème se voit

Sur **toutes les pages d'un univers**, en **quatre familles de surfaces** et **deux images** :

- `page` : la page, autour et entre les blocs, sous les posts (un post n'a pas de carte : il est posé sur la page) ;
- `sky` : le ciel de l'univers (la barre d'identité, la colonne du ciel ou la bande du ciel, la bannière de l'univers) ;
- `block` : chaque bloc de la page (un widget, une carte de la colonne du temps, une tuile de la bande du
  temps, la citation dans un post, l'en-tête et les bulles d'un channel, un bloc libre, un rail) ;
- `control` : les boutons, les badges, les puces (la barre des focus, le sélecteur de disposition) et
  les liens ; un lien et un bouton secondaire prennent son `background` comme couleur de texte.

L'image `page` est derrière la page ; l'image `pageHeader` derrière le ciel. **La plateforme fixe la
forme** : les rayons (un post 0, un bloc 20 px, un contrôle 12 px), aucun trait ni bordure autour d'une
surface, l'opacité des blocs ; le thème ne donne que des couleurs et des images.

**Comment l'image de la page se voit** (`appearance.imageShows`) :

- `none` : aucune image derrière la page (l'emplacement `page` n'est pas dessiné) ;
- `subtle` (par défaut) : l'image derrière la page **à toutes les tailles, téléphone compris**, la page
  posée dessus à l'**opacité de page du lecteur** (64 % par défaut, de 40 à 100 %, son réglage) ;
- `through` : l'image derrière la page à toutes les tailles, les blocs à l'opacité de bloc de la plateforme.

Avec `subtle` comme avec `through`, chaque post, chaque texte et chaque contrôle posés sur l'image ont sous
eux le **masque de lisibilité** : la couleur du `background` de `page` à une opacité que la plateforme
calcule à la publication pour cette image (`scrims.mask`, en nuit, nuit atténuée et jour : la plus
faible qui garde l'AA sur tous les tons de l'image, **jamais sous 60 %**). Le ciel est dessiné de même sur
l'image `pageHeader`, sous le voile de la couleur de `sky` que la plateforme calcule (`scrims.pageHeader`).
Les anciens « fonds de texte » (`textBackdrop`, `textScrims`) ne sont plus dessinés. Choisis donc des
images qui restent belles sous un voile de la couleur de `page` (et de `sky` pour le ciel).

## Le JSON (`theme.json`)

Produis exactement cette structure, sans autre clé. Les couleurs sont des `#RRGGBB`.

```json
{
  "format": "break-rocks-theme/2",
  "universe": "%football",
  "name": "stade-crepuscule",
  "description": "<une phrase>",
  "collection": "SPORT",
  "variants": {
    "night": {
      "palette": {
        "background": "#…",
        "surface": "#…",
        "text": "#…",
        "primary": "#…",
        "accent": "#…",
        "link": "#…"
      },
      "surfaces": {
        "page": {
          "background": "#…",
          "text": "#…",
          "secondaryText": "#…"
        },
        "sky": {
          "background": "#…",
          "text": "#…",
          "secondaryText": "#…"
        },
        "block": {
          "background": "#…",
          "text": "#…",
          "secondaryText": "#…"
        },
        "control": {
          "background": "#…",
          "text": "#…",
          "secondaryText": "#…"
        }
      }
    },
    "day": {
      "palette": {
        "background": "#…",
        "surface": "#…",
        "text": "#…",
        "primary": "#…",
        "accent": "#…",
        "link": "#…"
      },
      "surfaces": {
        "...": "mêmes clés que la nuit, couleurs du jour"
      }
    }
  },
  "typography": {
    "title": "Bebas Neue"
  },
  "gradient": [
    "#…",
    "#…"
  ],
  "motionAccents": true,
  "imageSlots": {
    "page": {
      "day": "page-day.jpg",
      "night": "page-night.jpg"
    },
    "pageHeader": {
      "day": "page-header-day.jpg",
      "night": "page-header-night.jpg"
    }
  },
  "images": {
    "wordmark": null,
    "pattern": null
  },
  "stickers": [],
  "pageImageOnPhone": true,
  "appearance": {
    "accent": "#…",
    "imageShows": "subtle",
    "sky": "column"
  }
}
```

Règles du JSON :

- **Palette** : les six couleurs `background`, `surface`, `text`, `primary`, `accent`, `link`, par variante.
- **Surfaces de thème** : les quatre familles `page`, `sky`, `block`, `control`, chacune avec
  `background`, `text` et `secondaryText` (tous facultatifs ; une couleur absente prend la palette :
  `page` le `background`, `sky` et `block` la `surface`, `control` le `primary`). **Aucune autre surface**
  (les anciennes, `postCard`, `widget`, `primaryButton`…, sont dépréciées), **aucune** `border`, **aucune**
  `opacity`.
- **Contraste** (WCAG 2, vérifié à la publication, en nuit, nuit atténuée et jour) : **4,5:1 au moins**
  entre `text` et `background` et entre `text` et `surface` de la palette, et entre `text` et
  `background`, `secondaryText` et `background` de chaque famille (donne toujours `secondaryText`) ;
  **3:1 au moins** entre `primary`, `accent`, `link` et `background`, et entre le `background` de
  `control` et celui de `page`, `sky` et `block`. Une couleur trop faible est relevée à la
  publication : choisis-les justes.
- **Police** : `typography.title` obligatoire (titres, chiffres et libellés courts des widgets),
  **uniquement** parmi : Abril Fatface, Alfa Slab One, Amiri, Anton, Archivo Black, Audiowide, Bebas Neue, Black Han Sans, Black Ops One, Bungee, Cairo, Caveat, Cormorant Garamond, Dancing Script, DM Serif Display, Do Hyeon, DotGothic16, Exo 2, Figtree, Frank Ruhl Libre, Fraunces, Galada, GFS Didot, Great Vibes, Hind Siliguri, IBM Plex Mono, JetBrains Mono, Kanit, Libre Baskerville, Lobster, Major Mono Display, Mitr, Monoton, Montserrat, Mukta, Neonderthaw, Orbitron, Oswald, Pacifico, Pixelify Sans, Playfair Display, Press Start 2P, Reem Kufi, Righteous, Rozha One, Ruslan Display, Russo One, Satisfy, Share Tech Mono, Silkscreen, Sora, Space Mono, Suez One, Tilt Neon, VT323, ZCOOL KuaiLe, Zen Maru Gothic. Aucune police pour le texte courant, aucune
  police d'accent.
- **Dégradé** : 2 ou 3 couleurs **prises dans la palette**.
- **Images** : les emplacements `page` et `pageHeader` seulement, chacun `{ "day": …, "night": … }` ; au plus
  **8** références en tout (variantes nuit, `wordmark` et `pattern` compris) ; sans variante nuit, l'image
  du jour sert la nuit. Référence les fichiers par leur **nom** : `breakrocks theme publish` les envoie et les
  remplace par leurs identifiants d'envoi.
- **`pageImageOnPhone`** : `true` (l'image de la page aussi sur téléphone) ou `false` (pas sur téléphone).
- **`appearance`** : `accent` **obligatoire**, le `primary` de la palette de nuit (sans lui la plateforme
  ignore tout le bloc : l'image se voit alors `subtle` et le ciel est la colonne) ; `imageShows` :
  `none`, `subtle` ou `through` (sans lui, la plateforme lit `none`) ; `sky` : `column` (la colonne du
  ciel, à gauche sur ordinateur) ou `band` (la bande du ciel, en haut de chaque page, comme sur tablette).
- **Interdit** : les clés `scrims` (le masque de lisibilité compris), `textScrims`, `screenshots`,
  `creator`, `version`, `copiedFrom` (calculées par la plateforme) ; `surfaceRadius`, `shape`,
  `surfaceOpacity`, `textBackdrop` (ignorées) ; toute URL, police ou feuille de style externe.

## Les images à produire

**Photographies réalistes** (lumière naturelle crédible), cohérentes entre elles et avec la palette,
**sans texte, sans logo, sans marque, sans drapeau, sans personne reconnaissable**. **Nuit** (servie en
nuit et en nuit atténuée) : sombre, contrastes doux, quelques points lumineux qui rappellent `accent`.
**Jour** : clair, doux, légèrement désaturé, sans surexposition. Les deux variantes montrent la même scène.

| Fichier | Emplacement, variante | Taille | Ce qu'elle montre | Ce qui se pose dessus |
|---|---|---|---|---|
| `page-night.jpg` | `page`, nuit | 2 400 × 1 800 px (4:3), au moins 2 160 × 1 620 | la scène principale, de nuit | la page à l'opacité du lecteur (`subtle`) ou les blocs (`through`), chaque post et chaque texte sur le masque de lisibilité (couleur `page`, 60 % au moins) |
| `page-day.jpg` | `page`, jour | 2 400 × 1 800 px (4:3) | la même scène, de jour | idem, avec les couleurs du jour |
| `page-header-night.jpg` | `pageHeader`, nuit | 2 400 × 800 px (3:1, au moins 1 500 × 500) | un panorama large de la scène, de nuit | le nom de l'univers, son logo, ses boutons, sous le voile de `sky` |
| `page-header-day.jpg` | `pageHeader`, jour | 2 400 × 800 px (3:1) | le même panorama, de jour | idem |

- **Recadrage sûr** : l'image `page` couvre la fenêtre (recadrée en 21:9 sur ordinateur, en 9:19,5 sur
  téléphone) : l'intérêt dans le tiers central, des zones calmes et peu contrastées sur au moins 60 % de
  l'image (le masque de lisibilité y sera plus léger). Le panorama `pageHeader` garde son sujet au centre,
  le bas et le côté de début calmes (le nom et le logo de l'univers s'y posent).
- **Format** : JPEG (qualité 85), PNG ou WebP, sRGB, **5 Mo au plus** chacune, sans métadonnées de
  localisation. La plateforme en sert des variantes WebP de 2160, 1080, 480, 160 px de large : en dessous de 2 160 px
  de large, l'image de la page est agrandie sur ordinateur.
- **Après la publication**, la plateforme calcule les voiles (`scrims`) et le masque de lisibilité à partir des
  tons de ces images, et génère les captures du thème (trois écrans 360 × 720, la page d'un univers en
  1 280 × 800, 834 × 1 112 et 390 × 844, de nuit et de jour) : n'en fournis aucune.
- Si tu ne peux pas produire une image, mets son emplacement à `null` plutôt que de référencer un fichier absent.

## Rendu attendu

1. `theme.json` complet.
2. La liste des 4 fichiers (nom, emplacement, variante, taille) avec, pour chacun, le prompt d'image en
   anglais ; les images si tu sais en produire.
3. Trois lignes qui expliquent les choix (palette, police, scènes).
4. Le tableau des contrastes calculés (paire, ratio).

Ensuite : `breakrocks theme check theme.json` montre les couleurs que la plateforme relèverait et le
masque de lisibilité qu'elle calculerait ; `breakrocks theme pack theme.json` écrit l'archive que l'import des
apps lit ; `breakrocks theme publish theme.json --in <univers>` (ou l'archive) le publie.

