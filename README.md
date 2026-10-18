# Sources Paperback 0.8

Dépôt de sources [Paperback](https://paperback.moe) (API **0.8**), publié via GitHub Pages.

## Ajouter le dépôt dans Paperback

1. Ouvrir Paperback → **Settings → Extensions → Edit → +**
2. **Repository Base URL** : l'URL GitHub Pages de ce dépôt (**sans slash final**) :
   ```
   https://atchuross.github.io/paperback-sources
   ```
3. **Add to Paperback**

## Sources incluses

| Source | Site |
|---|---|
| Bigsolo | bigsolo.org |
| Fanfox | fanfox.net |

## Modifier / publier

Le contenu servi par GitHub Pages est le dossier **`docs/`** (généré depuis `bundles/`).

```sh
./deploy.sh "message de commit"     # reconstruit, copie vers docs/, commit + push
```

Par sécurité, faire un instantané avant une modification :

```sh
bash ~/paperback-backups/snapshot.sh "avant-<etape>"
```

## Notes techniques

- Toolchain épinglée : `@paperback/toolchain` et `@paperback/types` **0.8.7** (ne pas changer :
  l'application attend l'API 0.8).
- Pour que l'application récupère une modification, **incrémenter `SourceInfo.version`**
  (elle ne se met à jour que vers un numéro supérieur).
- Tout objet passé à l'API native doit être construit par `App.createXxx(...)`
  (un objet JavaScript brut fait planter l'application).
