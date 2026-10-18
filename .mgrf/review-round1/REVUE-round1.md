# Revue indépendante — round 1 (lentille « artefact »)

Carte : t_521295d0 — [FIX] Fanfox absente de l'écran d'accueil
Implémenteur : technical-manager (run 42) — Relecteur : technical-manager (run 43, revue)
Verdict : **APPROUVÉ**

Aucun fichier d'implémentation n'a été modifié par le relecteur.
Seul ajout : ce dossier `.mgrf/review-round1/` (journaux de preuve de la revue).

## 1. Lecture à froid de l'artefact (avant le récit de livraison)

Périmètre du diff (`diff -r .mgrf/before/src` vs `src`) — exactement 3 fichiers,
tous dans `src/Fanfox/` :

- `Fanfox.ts` : `version 1.0.4 → 1.0.5`, `intents` `MANGA_CHAPTERS` → `MANGA_CHAPTERS | HOMEPAGE_SECTIONS`,
  ajout de `getHomePageSections`, `getViewMoreItems`, helper privé `homeTiles`. Commentaires/doc seuls ailleurs.
- `Common.ts` : 5 hunks — constantes `RELEASES_PATH`/`TRENDING_PATH`/`HOME_SECTION_*`/classes de tuiles,
  `releasesUrl()`/`trendingUrl()`, extraction du corps de `parseSearchTiles` en `parseTiles(html, titleClass, coverClass)`
  + 2 wrappers. Logique de parsing inchangée (seules les classes deviennent paramètres).
- `data-contracts.ts` : en-tête documentaire (2 lignes) uniquement, aucun type modifié.

`diff -r .mgrf/before/src/Bigsolo src/Bigsolo` → **identique**. Idem pour `bundles/Bigsolo/`.
Aucune trace d'un changement touchant le chargement des chapitres (`parseChapterList`,
`getChapterDetails` hors diff).

## 2. Contrat d'interface (types 0.8.7)

- `SourceIntents` : `MANGA_CHAPTERS = 1<<0`, `HOMEPAGE_SECTIONS = 1<<2` ⇒ `5` attendu. observé `5`.
- `getHomePageSections?(sectionCallback: (section: HomeSection) => void): Promise<void>` — signature conforme.
- `getViewMoreItems?(homepageSectionId: string, metadata: any): Promise<PagedResults>` — signature conforme.
- `App.createHomeSection(info: {id,title,type,items?,containsMoreItems})` — champs utilisés conformes.

## 3. Règle « objets natifs »

Les 15 sites `App.*` de `src/Fanfox/` sont tous des fabriques (`createRequestManager`,
`createCookie`, `createPagedResults`, `createPartialSourceManga`, `createHomeSection`,
`createTagSection`, `createSourceManga`, `createMangaInfo`, `createChapter`,
`createChapterDetails`, `createRequest`). Le code ajouté (accueil) n'envoie aucun littéral brut.

Observation non bloquante (pré-existante, hors diff de cette tâche) :
`App.createTagSection({tags: details.tags.map(t => ({id: t, label: t}))})` à `Fanfox.ts:311`
passe des littéraux `{id,label}` là où `Tag` dispose aussi d'une fabrique `App.createTag`.
Le chemin est bel et bien exercé (sonde 3 : 5 tags pour `the_dark_swordsman_returns`,
3 pour `gensou_gourmet`) et la version 1.0.4, qui contenait déjà ce code, a été validée
« fiches OK » sur iPhone. À traiter éventuellement par une carte dédiée si l'on veut une
conformité stricte à la règle ; ne bloque pas la présente tâche (lignes non modifiées).

## 4. Exécution réelle (relecteur)

    ./node_modules/.bin/tsc -p tsconfig.json --noEmit      → exit 0
    ./node_modules/.bin/paperback bundle                   → exit 0
      versioning.json : 2 sources — Bigsolo 0.2.2 intents=5, Fanfox 1.0.5 intents=5
    ./node_modules/.bin/paperback test                     → exit 0, 0 [FAILURE]
      cas « source should return homepage sections containing items » présent et vert
      (+ valid SourceManga definition, some chapters, chapter details with pages, some search results)
    reconstruction indépendante de bundles/Fanfox/source.js → sha256 77eca16c… **identique** au livré
      ⇒ le bundle livré provient exactement du source testé.
    restauration du workspace après la revue : `diff -r` == identique (aucune modification).

## 5. Sondes live du relecteur (réseau réel, scripts écrits par le relecteur)

`reviewer-probe.js` :
- intents=5, `getHomePageSections`/`getViewMoreItems` présentes ;
- 2 sections : `latest_updates` (21 items, singleRowNormal), `trending` (28 items, singleRowLarge) ;
- 100 % d'URLs d'images absolues (hôte observé : fmcdn.mfcdn.net), ids et titres non vides ;
- `getViewMoreItems` → 0 résultat, sans exception, pour `latest_updates`, `trending` et un id inconnu.

`reviewer-probe2.js` (non-régression) :
- `getSearchResults("naruto")` → 12 résultats page 1 + metadata `{page:2}`, 12 en page 2 ;
- chacun des 2 items d'accueil ouvre une fiche réelle (70 et 45 chapitres).

`pagination-check.js` (justification de `containsMoreItems:false`) :
- `/releases/` = 21 slugs, `/releases/?page=2` = 21 slugs, **0 slug exclusif à la page 2** ⇒ aucune pagination.

## 6. Pièces et sauvegardes

- 4 pièces jointes à la carte : aucune en double ; sha256 identiques aux fichiers `.mgrf/` testés
  (`test-after.log`, `probe-home-live.log`, `probe-items-live.log`, `probe-adult.log`).
- `.mgrf/etape3-accueil-livrable.tar.gz` : les 4 fichiers qu'il contient (Fanfox.ts/Common.ts/
  data-contracts.ts/versioning.json) ont exactement les sha256 du workspace livré.
- Sauvegardes : `repo-avant-etape3-accueil-20261018-203918.tar.gz` = 2f492046… et
  `repo-etape3-accueil-20261018-204844.tar.gz` = ba3a73e4… — conformes aux valeurs annoncées ;
  le contenu de la seconde porte les sha256 livrés (Fanfox.ts d333427b…).

## 7. Ce qui reste NON vérifiable localement (aucune affirmation iPhone)

1. Affichage réel de l'accueil dans l'app (2 sections + couvertures).
2. Absence de crash « Argument does not match Objective-C Class » : le harnais Node ne valide
   pas les classes natives — c'est la seule vraie limite du raisonnement local.
3. Chemin 18+ (`isAdult=1`) : exige le magasin de cookies de l'application.
L'implémenteur a correctement distingué « testé localement » de « à valider sur iPhone ».
