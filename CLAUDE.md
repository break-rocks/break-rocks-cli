# break-rocks — CLI

Le client en ligne de commande de break.rocks (`breakrocks`), en **TypeScript sur Node 24**, sans
dépendance d'exécution. Vue d'ensemble et portée : [README.md](README.md).

## Règles

- **Le contrat fait foi** : `specs/common` (sous-module `break-rocks-specs`) : `contracts/agent-sign-in.md`
  pour les opérateurs et agents délégués, `contracts/schema.graphql` pour l'API. **Ne jamais écrire
  ni commiter dans `specs/common`** : une spec commune se change par PR sur `break-rocks-specs`.
- **Deux sorties, une seule voie** : chaque commande répond en texte lisible par défaut et en JSON
  avec `--json` ; tout passe par `src/output.ts` (`no-console` ailleurs). Codes de sortie : 0 fait,
  1 refus de la plateforme (erreur de domaine, rapportée avec son code), 2 usage.
- **Aucun secret écrit en clair** dans la sortie, les journaux ou les tests ; les clés privées
  restent sur l'appareil, dans le dossier de configuration de l'utilisateur, en 0600.
- **Pas de réseau dans les tests** : fausses sorties et faux transports ; les parcours réels se
  vérifient sur dev à la main et se rapportent.
- **Dépendances** : aucune d'exécution sans décision de l'utilisateur ; toute version a au moins
  7 jours (`.github/dependabot.yml`, `npm install --before=…`).
- **Commits** : messages en anglais, au nom de l'utilisateur, sans trailer ; `CHANGELOG.md` à jour
  (Keep a Changelog) ; version dans `package.json`.
- Une solution provisoire se marque `TEMPORARY (technical debt, …)` et se liste dans le README.
