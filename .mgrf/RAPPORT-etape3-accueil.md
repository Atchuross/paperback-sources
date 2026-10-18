# Étape 3 — Fanfox sur l'écran d'accueil (intent HOMEPAGE_SECTIONS + sections)

Ticket Kanban : `t_521295d0` — agent `technical-manager`
Dépôt : `/Users/atc/paperback-repo-fresh` (dépôt vivant, workspace `dir` persistant)
Date : 2026-10-18

## 1. Cause (confirmée par lecture du code de départ)

`src/Fanfox/Fanfox.ts` déclarait `intents: SourceIntents.MANGA_CHAPTERS` seul
(valeur 1) et n'implémentait NI `getHomePageSections` NI `getViewMoreItems`.
Sans l'intent `HOMEPAGE_SECTIONS`, l'application n'appelle jamais la méthode
d'accueil : Fanfox n'apparaît donc pas sur l'accueil.

Preuve avant correctif (instantané « avant », `bundles/versioning.json`) :

    {"id":"Fanfox", ..., "version":"1.0.4", ..., "intents":1}

## 2. Correctif livré (3 fichiers, dans `src/Fanfox/` seulement)

### `src/Fanfox/Fanfox.ts`
- `intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS`
  (`1 | 4 = 5`, valeurs de l'énum `SourceIntents` de `@paperback/types` 0.8.7).
- `version: "1.0.4"` → `"1.0.5"` (l'app doit récupérer le changement).
- `getHomePageSections(sectionCallback)` : publie 2 sections, chacune
  construite par `App.createHomeSection({...})`, items par
  `App.createPartialSourceManga({...})` :
  - `id = "latest_updates"`, titre « Dernières sorties », 21 items issus de
    `GET /releases/` (« Lastest Updates » du site), `type = singleRowNormal` ;
  - `id = "trending"`, titre « Tendances », 28 items issus de `GET /trending/`
    (« Trending Manga »), `type = singleRowLarge` ;
  - `containsMoreItems: false` pour les deux (le site ne pagine ni `/releases/`
    ni `/trending/` : mesuré, `/releases/?page=2` renvoie EXACTEMENT la même
    liste que `/releases/`).
  - Robustesse : une page en échec n'invalide pas l'autre (elle est consignée
    dans `problems` et la section n'est pas publiée) ; une section vide n'est
    JAMAIS transmise (le harnais officiel rejette `section[x] has no items`) ;
    si aucune section ne peut être construite, une erreur explicite (URLs +
    motifs) est levée plutôt qu'un accueil silencieusement vide.
- `getViewMoreItems(homepageSectionId, metadata)` : renvoie
  `App.createPagedResults({ results: [], metadata: undefined })` sans lever
  d'erreur (pas de pagination côté site, identifiant inconnu toléré).
- `homeTiles(url, parse, problems)` : helper privé de récupération + parsing.

### `src/Fanfox/Common.ts`
- Constantes : `RELEASES_PATH`, `TRENDING_PATH`, `HOME_SECTION_LATEST`,
  `HOME_SECTION_TRENDING`, classes de tuiles `manga-list-4` / `manga-list-1`.
- URL builders purs : `releasesUrl()`, `trendingUrl()`.
- `parseTiles(html, titleClass, coverClass)` : parseur générique extrait du
  corps EXISTANT de `parseSearchTiles` (aucun changement de logique : seul le
  nom des classes devient paramétrable ; le motif de couverture est compilé une
  fois via `escapeRegExp`).
- `parseSearchTiles` devient un appel à `parseTiles` avec les classes
  `manga-list-4` ⇒ comportement identique (vérifié, cf. §4).
- Nouveaux parseurs purs : `parseReleaseTiles` (`/releases/`) et
  `parseMangaList1Tiles` (`/trending/`).

### `src/Fanfox/data-contracts.ts`
- En-tête documentaire mis à jour (les 2 nouvelles pages publiques). Aucun type
  modifié (`FSeriesTile` est réutilisé tel quel).

`src/Bigsolo/` : **aucune modification** — vérifié par `diff -r` contre
l'instantané d'avant : « BIGSOLO IDENTIQUE ».

## 3. Règle critique « objets natifs » (relecture de code explicite)

Tout objet transmis à une API native est produit par une fabrique `App.createXxx` :

| Emplacement | Objet transmis | Fabrique |
|---|---|---|
| `Fanfox.ts:239`, `252` | section d'accueil | `App.createHomeSection(...)` |
| `Fanfox.ts:193` (via `toPartialSourceManga`) | item de section/recherche | `App.createPartialSourceManga(...)` |
| `Fanfox.ts:274` | résultat « voir plus » | `App.createPagedResults(...)` |

Aucun littéral `{ ... }` n'est passé directement à une API native dans le code
ajouté (les littéraux sont uniquement les ARGUMENTS des fabriques).
`getHomePageSections` ne fait que `sectionCallback(App.createHomeSection(...))`.

## 4. Commandes exécutées et sorties réelles (testé localement)

### a) `npx tsc -p tsconfig.json --noEmit`
    typecheck exit=0

### b) `./node_modules/.bin/paperback bundle`
    # Transpile and bundle time: 17ms
    # Versioning File: 2ms
    # Execution time: 43ms
    bundle exit=0

`bundles/versioning.json` après : **2 sources**, Bigsolo `0.2.2` (`intents: 5`,
inchangé), Fanfox `1.0.5` (`intents: 5`) ; `bundles/Fanfox/source.js` régénéré
(sha256 `77eca16cadf548a46087236100e73b05921e06407b38561448d12f0eba68c1f2`).

### c) `./node_modules/.bin/paperback test` → 0 `[FAILURE]`
    Testing Bigsolo
    Testing Fanfox
    # source should return homepage sections containing items: 272ms
    # source should return valid SourceManga definition: 1ms
    # source should return some chapters: 1ms
    # source should return homepage sections containing items: 543ms
    # source should return chapter details with some pages: 281ms
    # source should return some search results: 2ms
    # source should return valid SourceManga definition: 476ms
    # source should return some chapters: 477ms
    # source should return chapter details with some pages: 3737ms
    # source should return some search results: 217ms
    test exit=0

Le harnais ajoute bien le cas « source should return homepage sections
containing items » (il apparaît dès que `getHomePageSections` existe) : il
PASSE pour Fanfox. Aucune ligne `[FAILURE]` dans la sortie.

### d) Sonde live des sections (réseau réel, code compilé `tmp/Fanfox/Fanfox.js`)
    version déclarée : 1.0.5
    intents           : 5 (MANGA_CHAPTERS=1, HOMEPAGE_SECTIONS=4)
    === getHomePageSections : 2 section(s) ===
    OK   id=latest_updates titre="Dernières sorties" type="singleRowNormal" containsMoreItems=false items=21 (imagesAbsolues=21, ids=21, titres=21)
    OK   id=trending titre="Tendances" type="singleRowLarge" containsMoreItems=false items=28 (imagesAbsolues=28, ids=28, titres=28)
    === getViewMoreItems ===
    id=latest_updates metadata=null -> results=0 metadata=undefined
    id=inconnue metadata={"page":2} -> results=0 metadata=undefined
    RESULTAT SONDE LIVE : SECTIONS NON VIDES, ITEMS COMPLETS

Exemples d'items réellement reçus (images absolues, hôte CDN non codé en dur) :

    oshi_no_shuuchakushin_wo_namete_ita | Oshi no Shuuchakushin wo Namete Ita | https://fmcdn.mfcdn.net/store/manga/48502/cover.jpg?token=...&ttl=...&v=...
    toki_doki_sou                      | Toki Doki Sou!                    | https://fmcdn.mfcdn.net/store/manga/28756/cover.jpg?token=...&ttl=...&v=...

### e) Sonde live fonctionnelle : les items d'accueil mènent à des fiches réelles
    OK   latest_updates [0]      id=oshi_no_shuuchakushin_wo_namete_ita titre="Oshi no Shuuchakushin wo Namete Ita" statut="Ongoing" couverture=absolue chapitres=160 (1er=c001, dernier=c160) 2eAppel=stable
    OK   latest_updates [dernier] id=the_possessed_prodigy_actor titre="The Possessed Prodigy Actor" statut="Ongoing" couverture=absolue chapitres=72 (1er=c001, dernier=c072) 2eAppel=stable
    OK   trending [0]            id=toki_doki_sou titre="Toki Doki Sou!" statut="Ongoing" couverture=absolue chapitres=9 (1er=c001.1, dernier=c002.4) 2eAppel=stable
    OK   trending [dernier]      id=flower_girl_in_dystopia titre="Flower Girl in Dystopia" statut="Ongoing" couverture=absolue chapitres=125 (1er=c001, dernier=c125) 2eAppel=stable
    recherche "naruto" -> 12 résultat(s), 1er = naruto_dj_the_last_naruto_the_movie, pageSuivante={"page":2}
    RESULTAT SONDE FONCTIONNELLE : OK (items d'accueil cliquables et fonctionnels)

### f) Non-régression du parsing de recherche (refactor `parseTiles`)
    search: parseSearchTiles=12 vs parseTiles(generic)=12 identiques=true

Et sur 6 pages HTML réelles (`.mgrf/*.html`) : `parseReleaseTiles`,
`parseMangaList1Tiles`, `parseTiles` → toutes les sondes OK (items non vides,
100 % d'images absolues, identifiants valides, aucun titre vide), y compris sur
le bloc « Lastest Updates » de l'accueil (6 tuiles) et `/releases/?page=2`.

### g) Chemin 18+ (limite honnête du harnais Node)
    diagnostic cookie (constructeur) : magasin de cookies ABSENT
    magasin de cookies exposé par le runtime de test : ABSENT
    OK   message 18+ explicite : Fiche 18+ sur fanfox.net : l'écran
         d'avertissement d'âge est affiché et le cookie « isAdult=1 » n'a pas
         été pris en compte. Diagnostic : magasin de cookies fourni par
         l'application = ABSENT ; résultat de l'ajout = magasin de cookies ABSENT.

Le polyfill Node (`@paperback/runtime-polyfills` 0.8.7) ne fournit AUCUN
magasin de cookies : le harnais local ne peut donc PAS prouver le
fonctionnement 18+ (il ne peut que constater que le chemin d'erreur explicite est
intact). Le code du cookie (`App.createCookie` + `requestManager.cookieStore`)
n'a pas été touché par cette tâche.

## 5. Sauvegardes / rollback

- AVANT : `/Users/atc/paperback-backups/repo-avant-etape3-accueil-20261018-203918.tar.gz`
  (sha256 `2f4920460b95b0433bf34872142c7367d4a4c199c479e4128ec042727c7e56bb`)
- APRÈS : `/Users/atc/paperback-backups/repo-etape3-accueil-20261018-204844.tar.gz`
  (sha256 `ba3a73e445d6a4445c9c2c1dd5088a9e910c1ee41b35bdc451026c5cfd2477f9`)
- Rollback utilisateur : `bash /Users/atc/paperback-backups/restore.sh repo-avant-etape3-accueil-20261018-203918.tar.gz`

## 6. TESTÉ LOCALEMENT vs À VALIDER SUR iPHONE

Testé localement (sorties réelles ci-dessus) :
- 2 sources compilées, manifeste Fanfox 1.0.5 intents 5, Bigsolo 0.2.2 intacts ;
- `paperback test` : 0 `[FAILURE]`, cas « homepage sections » PASSÉ ;
- sections d'accueil non vides (21 + 28 items) avec images absolues, sondes
  live réelles ; items cliquables (fiche + chapitres) ; recherche OK ;
- aucun objet JS brut transmis au natif (relecture de code ci-dessus).

**À VALIDER SUR iPHONE (aucune affirmation de ma part)** :
1. L'écran d'accueil affiche bien Fanfox avec les sections « Dernières sorties »
   et « Tendances » (et leurs couvertures).
2. Absence de crash / d'erreur « Argument does not match Objective-C Class » :
   le harnais Node ne valide PAS les classes natives (il renvoie l'objet tel
   quel pour tout `App.createXxx`).
3. Séries 18+ (cookie `isAdult=1`) : non vérifiable localement (harnais sans
   magasin de cookies) — comportement supposé inchangé, ce chemin de code n'a
   pas été modifié.
4. Performance du chargement des chapitres : non traitée ici (tâche séparée),
   et non modifiée par ce correctif.

## 7. Empreintes des fichiers livrés

    d333427baa729f5f37f59bc496e9bf882931b2874b89313c4d8ec42a4851bd85  src/Fanfox/Fanfox.ts
    004a0aa2f37a80e0f5a790f55c681d85e15bdfeeb228c096fe333b2092af8ad8  src/Fanfox/Common.ts
    7e71cc58733de56f8fa2b9ae4aab3da8c98e71bb4192da190817ed5f9c03800c  src/Fanfox/data-contracts.ts
    77eca16cadf548a46087236100e73b05921e06407b38561448d12f0eba68c1f2  bundles/Fanfox/source.js
    a4602efecbf81f18962717efb943bb41f111d062e9b5fa263b0d7f1332184912  bundles/versioning.json
