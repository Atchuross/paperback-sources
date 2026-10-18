# Consignes projet — sources Paperback 0.8

## Environnements

| | Où | Rôle |
|---|---|---|
| **PRÉPROD** | ce dossier, sur le **Mac** (`/Users/atc/paperback-repo-fresh`) | on développe et on teste ici, en local |
| **PROD** | **GitHub Pages** : `https://atchuross.github.io/paperback-sources` | ce que l'utilisateur utilise au quotidien |

Dépôt GitHub : `https://github.com/Atchuross/paperback-sources` — branche `main`,
dossier publié **`docs/`**.

## Règle absolue

**Aucun `git push` vers GitHub tant que l'utilisateur n'a pas validé sur son iPhone,
en local.** La mise en PROD n'a lieu que sur sa **demande explicite**, après sa
validation. Un agent ne pousse jamais de sa propre initiative.

## Cycle de travail

1. **Instantané** avant toute modification :
   `bash ~/paperback-backups/snapshot.sh "avant-<etape>"`
2. Modifier `src/...`, puis **incrémenter `SourceInfo.version`** (l'app ne se met à jour
   que vers un numéro **supérieur**).
3. Construire et vérifier :
   `./node_modules/.bin/paperback bundle` puis `./node_modules/.bin/paperback test`
   (0 `[FAILURE]` pour chaque source).
4. **Tester en PRÉPROD** : servir le dossier localement et faire valider par
   l'utilisateur sur son iPhone.
   ```sh
   cd bundles && python3 -m http.server 8080 --bind 0.0.0.0
   # URL de test : http://<ip-du-mac>:8080   (sans slash final)
   ```
5. **Seulement après validation de l'utilisateur** : publier en PROD.
   ```sh
   ./deploy.sh --prod "message de commit"
   ```

`./deploy.sh "message"` **sans** `--prod` prépare et commite **en local uniquement**
(aucun push). C'est le mode par défaut.

## Rappels techniques (chaque écart a déjà cassé quelque chose)

- **Tout objet passé à l'API native doit venir de `App.createXxx(...)`.** Un objet
  JavaScript brut lève `Argument does not match Objective-C Class` et peut faire
  **planter l'application**.
- `interceptRequest` doit **muter et renvoyer le MÊME** objet `Request` (renvoyer une
  copie → `MethodInvalidReturnTypeError [PBError(303)]` à chaque requête).
- Les cookies passent par `requestManager.cookieStore.addCookie(App.createCookie({...}))` :
  l'en-tête `Cookie` posé par un interceptor est **écrasé** par le runtime.
- Ne déclarer que les **intents réellement implémentés** (`MANGA_TRACKING` ↔
  `MangaProgressProviding`, `HOMEPAGE_SECTIONS` ↔ `getHomePageSections`).
- **Le harnais Node ne valide ni les classes natives ni `requestsPerSecond`** : une
  validation sur l'iPhone reste indispensable.

## Sources du dépôt

| Source | Site | Notes |
|---|---|---|
| Bigsolo | bigsolo.org | API JSON statique, User-Agent navigateur obligatoire |
| Fanfox | fanfox.net | lecteur `chapterfun.ashx` ; cookie `isAdult=1` pour les séries 18+ |
