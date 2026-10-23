# break-rocks — CLI

Le client en ligne de commande de break.rocks (`breakrocks`), en **TypeScript sur Node 24**. Vue
d'ensemble, commandes et portée (D-91) : [README.md](README.md).

## Règles

- **Contrat compact** : `src/api/schema.generated.ts` est régénéré par `npm run gen:schema` à chaque
  montée de `specs/common` (jamais édité à la main) ; une commande qui est une opération de l'API passe
  par `apiCommand` (`src/api/command.ts`).
- **Le contrat fait foi** : `specs/common` (sous-module `break-rocks-specs`) : `contracts/agent-sign-in.md`
  pour les opérateurs et agents délégués, `contracts/schema.graphql` pour l'API. **Ne jamais écrire
  ni commiter dans `specs/common`** : une spec commune se change par PR sur `break-rocks-specs`.
- **Un registre, toutes les sorties** : chaque commande se déclare dans le registre
  (`src/registry.ts`) avec les schémas JSON de son entrée et de sa sortie ; l'aide, `--json`,
  `breakrocks schema` et le serveur MCP en dérivent. Elle répond en texte lisible par défaut et en
  JSON avec `--json` ; tout passe par `src/output.ts` (`no-console` ailleurs). Codes de sortie : 0
  fait, 1 refus (de la plateforme, avec le code du contrat, ou d'une garde du CLI), 2 usage, 3
  réseau ou session.
- **Aucun secret écrit en clair** dans la sortie, les journaux ou les tests ; les clés privées
  restent sur l'appareil, dans le dossier de configuration de l'utilisateur (0600 sur POSIX, ACL de l'utilisateur sur Windows).
- **Portable** : macOS, Linux et Windows (exigence de l'utilisateur, 2026-10-23). Aucun module
  natif, aucun appel à un shell ni à un binaire du système, chemins par `node:path` et
  `os.homedir()`, aucune hypothèse sur `/`, les droits POSIX ou les fins de ligne ; une commande
  qui ne peut pas marcher sur un système le dit et échoue proprement. La CI tourne sur les trois.
- **Pas de réseau dans les tests** : fausses sorties et faux transports ; les parcours réels se
  vérifient sur dev à la main et se rapportent.
- **Dépendances** : d'exécution, celles décidées avec D-91 seulement (`@x402/core`, `@x402/evm`,
  `viem`, `@modelcontextprotocol/sdk`, chargées à la demande) ; toute autre sur décision de
  l'utilisateur ; toute version a au moins 7 jours (`.github/dependabot.yml`, `npm install --before=…`).
- **Commits** : messages en anglais, au nom de l'utilisateur, sans trailer ; `CHANGELOG.md` à jour
  (Keep a Changelog) ; version dans `package.json`.
- Une solution provisoire se marque `TEMPORARY (technical debt, …)` et se liste dans le README.
