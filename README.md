# break-rocks-cli

Le client en ligne de commande de break.rocks : `breakrocks`. Un exécutable Node 24 en TypeScript,
pensé pour un terminal **et** pour un agent IA : chaque commande répond en texte, ou en JSON avec
`--json`. Portée décidée (D-91, 2026-10-23) :
[`CLI-PROPOSITIONS.md`](../CLI-PROPOSITIONS.md) du dossier kaolin ; ce dépôt couvre aujourd'hui le
palier 1 (v0.2.0) ; les opérateurs, les agents délégués, x402 et le serveur MCP suivent.

## Installation

Distribution par npm (C-01) : `npx breakrocks …` ou `npm i -g breakrocks` une fois le paquet publié
(nom `breakrocks`, publication au palier 5 ; `private` jusque-là). Depuis le dépôt :

```sh
npm ci
npm run build
node bin/breakrocks.js --help        # ou : npm link, puis breakrocks --help
```

En développement : `npm start -- help`. Vérifications : `npm run check` (lint, types, tests, build).

## Systèmes

macOS, Linux et Windows (exigence de l'utilisateur, 2026-10-23) : le CLI tourne partout où Node 24
tourne, sans module natif ni appel à un shell ; la CI l'exécute sur les trois systèmes à chaque push
(tests et exécutable). Chemins par `node:path` et `os.homedir()`, fichiers privés
en 0600 sur POSIX ; sous Windows, le dossier `%APPDATA%` de l'utilisateur est protégé par ses ACL par
défaut (le mode POSIX n'y a pas de sens).

## Sorties et codes de sortie

- Texte lisible par défaut ; `--json` donne la réponse (les champs et les noms de l'API) ;
  `--quiet` n'écrit que l'identifiant créé ou lu ; `--fields a,b.c` garde ces champs (de chaque
  élément d'une liste). Jamais de couleur ni d'animation (C-33) : la sortie est la même dans un
  terminal, un tube ou un agent. La progression et les questions vont sur stderr.
- Codes : **0** fait ; **1** refus, de la plateforme (le code du contrat, `errors.md` ou
  `agent-sign-in.md`, `source: "platform"`) ou d'une garde du CLI (`source: "cli"`) ; **2** usage (commande, option ou valeur hors schéma,
  confirmation manquante) ; **3** réseau ou session (pas de réponse, session à rouvrir).
- Un refus en JSON : `{ "error": { "code": "…", "message": "…", "source": "platform", … } }` ; les
  programmes lisent le code, jamais le message.
- Confirmations : les actions irréversibles et les paiements demandent une confirmation quand une
  personne peut répondre ; sinon (script, agent, MCP) ils exigent `--yes`, faute de quoi
  `CONFIRMATION_REQUIRED` (exit 2).

## Profils et environnements

- `--env dev|staging|prod` (défaut `prod`) choisit l'environnement d'un profil sans compte ; un profil
  garde ensuite l'environnement de son compte (`ENV_MISMATCH` sinon).
- Un profil (C-05) = un environnement, une cellule, au plus un compte de l'hôte des agents (un
  opérateur, ou un de ses agents délégués) et l'emplacement de ses clés. `--profile <nom>`, sinon
  `BREAKROCKS_PROFILE`, sinon le profil courant (`profile use`), sinon `default`.
- Dossier de configuration : `$XDG_CONFIG_HOME/breakrocks` ou `~/.config/breakrocks` (macOS, Linux),
  `%APPDATA%\breakrocks` (Windows), ou `BREAKROCKS_CONFIG_DIR`. `config.json` (profils, chemins des
  clés, jamais de secret), `cache/` (carte des cellules) : tout en 0600 ; les sessions et les clés
  viennent avec les opérateurs.
- Adresses de l'API, comme les apps (`contracts/cells.md`) : la carte des cellules
  `https://apps[.<env>].break.rocks/config/cells.json` (gardée 5 minutes), puis la cellule du compte
  (celle du profil, sinon le préfixe de son id, `eu-…`), sinon celle du pays à l'enregistrement
  (`byCountry`), sinon la cellule par défaut. En dev : `api` = l'adresse AppSync de la cellule `eu`,
  `agents` = `https://agents.dev.break.rocks`.

| Variable | Rôle |
|---|---|
| `BREAKROCKS_PROFILE` | le profil, sans `--profile` |
| `BREAKROCKS_CONFIG_DIR` | un autre dossier de configuration (tests, CI) |
| `BREAKROCKS_API_URL`, `BREAKROCKS_AGENTS_URL` | remplacent les adresses de la carte (un bac à sable : `BREAKROCKS_AGENTS_URL` se termine par `/v1`) |

## Commandes

Chaque commande a son aide (`breakrocks <commande> --help`) et ses schémas JSON
(`breakrocks schema <commande>`, `breakrocks schema all`), dérivés d'un registre unique.

| Commande | Fait | Exemple |
|---|---|---|
| `help` | l'aide du CLI, d'un groupe ou d'une commande | `breakrocks help theme check` |
| `version` | la version du CLI | `breakrocks --version` |
| `schema` | les schémas JSON de l'entrée et de la sortie d'une commande, et son outil MCP (C-30) | `breakrocks schema theme pack --json` |
| `profile add` | ajoute un profil (environnement, cellule) | `breakrocks profile add atlas-dev --env dev --use` |
| `profile use` | change de profil courant | `breakrocks profile use atlas-dev` |
| `profile list` | liste les profils | `breakrocks profile list --json --fields name,env,kind` |
| `profile show` | montre un profil (sans secret) | `breakrocks profile show` |
| `profile remove` | retire un profil et sa session, garde ses clés (confirmation) | `breakrocks profile remove old-dev --yes` |
| `theme prompt` | le prompt de `THEME-IA-PROMPT.md`, rempli (hors ligne, `--language en\|fr`) | `breakrocks theme prompt --field sport --mood "stade la nuit" --name stade-nuit --universe %football --language fr` |
| `theme check` | format 2, contrastes AA, images (8, 5 Mo, tailles), polices approuvées ; JSON pour les hooks (hors ligne) | `breakrocks theme check theme.json images/ --json` |
| `theme pack` | le ZIP de l'import de l'atelier (hors ligne) | `breakrocks theme pack theme.json --out stade-nuit.zip` |
| `theme unpack` | ouvre un ZIP de thème (hors ligne) | `breakrocks theme unpack stade-nuit.zip --out stade-nuit/` |
| `theme typefaces` | les polices approuvées embarquées | `breakrocks theme typefaces` |

## Organisation

- `src/cli.ts` : options globales, choix de la commande, sortie ; `src/registry.ts` : le registre ;
  `src/commands/` : les commandes par groupe ; `src/schema.ts` : schémas JSON, analyse des options,
  validation ; `src/help.ts`, `src/render.ts` : aide et texte ; `src/output.ts` : la seule sortie vers
  le terminal.
- `src/config.ts` (profils, fichiers privés), `src/endpoints.ts` (carte des cellules),
  `src/transport.ts` (GraphQL, hôte des agents, 429).
- `src/theme/` : vérification (portage de `backend/amplify/themes/surfaces.ts` et `model.ts`), prompt,
  ZIP (`node:zlib`), polices approuvées embarquées.
- `test/` : `vitest`, sans réseau (faux transports).
- `specs/common` : sous-module `break-rocks-specs` ; jamais modifié ici.

## Dépendances d'exécution

Aucune au palier 1. Décidées avec D-91 pour la suite (au moins 7 jours) : `@x402/core` et
`@x402/evm` 2.28.0, `viem` 2.57.7, `@modelcontextprotocol/sdk` 1.32.1.

## Dependabot

Mineures, correctifs et actions GitHub sont fusionnés automatiquement une fois le contrôle `check`
requis sur `main` vert ; les majeures restent ouvertes pour évaluation. Chaque version doit avoir au
moins 7 jours (`cooldown`), à la main : `npm install --before=<aujourd'hui − 7 jours>`.
