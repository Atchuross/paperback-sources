# [PERF] Fanfox — accélération du chargement des pages de chapitre

Tâche Kanban : `t_a6d6f882` · Manager technique · 2026-10-18
Workspace : `/Users/atc/paperback-repo-fresh` (dépôt vivant) · Version livrée : **Fanfox 1.0.6**

---

## 1. Objectif et critères de réussite (reformulés)

`getChapterDetails` prenait **≈ 1 minute** pour un chapitre (18–46 pages) : la boucle
émettait `1 + imagecount` requêtes **séquentielles** à `requestsPerSecond: 1`.
Critères : durée **réduite d'au moins 3×**, **sans changer une seule URL produite**,
sans régression (accueil, fiches, chapitres, recherche, déblocage 18+) et avec
`paperback bundle` / `paperback test` au vert.

## 2. Méthode de mesure (et sa limite, énoncée franchement)

Le polyfill Node `@paperback/runtime-polyfills` **n'applique pas `requestsPerSecond`**
(vérifié dans `node_modules/@paperback/runtime-polyfills/src/RequestManager.ts` : il
appelle `axios` immédiatement). Or, dans l'application, c'est ce limiteur le goulot
d'étranglement. Le harnais `.mgrf/perf/harness.js` enveloppe donc le `RequestManager`
dans un limiteur qui **reproduit la sémantique du manager natif** : un DÉPART de
requête toutes les `1/requestsPerSecond` secondes, les requêtes déjà lancées restant
EN VOL. Il mesure en plus le nombre d'appels, la concurrence maximale atteinte et la
fenêtre de départ, et il contrôle le statut HTTP réel des images.

- Validité du modèle : la reproduction du débit donne **18 172 ms / 46 225 ms**, soit
  exactement les durées annoncées par le CEO (18–46 s). Le modèle est donc calibré.
- Ce qui reste NON mesuré : le comportement du manager natif sur iPhone (voir §7).

Deux chapitres réels, choisis par mesure (`.mgrf/perf/find-long.js`,
`.mgrf/perf/scan-manga.js` scannent `var imagecount` page par page) :

| cas | série / chapitre | pages | `var chapterid` |
|---|---|---|---|
| court | `one_piece` / `vTBE/c1196` | 18 | 1790886 |
| long | `bleach` / `v00/c000` | 46 | 140188 |

## 3. Mesures AVANT / APRÈS (mêmes chapitres, même harnais, même machine)

| build | débit modélisé | court-18 | long-46 | requêtes |
|---|---|---|---|---|
| avant 1.0.5 (séquentiel) | 1 req/s | **18 172 ms** | **46 225 ms** | 19 / 47 |
| après 1.0.6 (vagues bornées 5) | 4 req/s | **5 104 ms** | **11 836 ms** | 19 / 47 |
| avant 1.0.5 (séquentiel) | 4 req/s | 4 944 ms | 12 024 ms | 19 / 47 |
| après 1.0.6 (vagues bornées 5) | 1 req/s | 18 190 ms | 46 160 ms | 19 / 47 |
| avant 1.0.5, **sans aucun limiteur** | — | 3 824 ms | 9 453 ms | 19 / 47 |

**Gain livré (ligne 1 → ligne 2) : ×3,56 sur le chapitre court, ×3,91 sur le long.**
Objectif « ≥ 3× » atteint, sans changer les URLs (§4).

Décomposition honnête des deux leviers (lignes 3 et 4) :

- **`requestsPerSecond: 1 → 4`** est le levier principal à latence ~200 ms : le code
  SÉQUENTIEL à 4 req/s donne déjà 4 944 / 12 024 ms. C'est cette valeur qui a été
  augmentée (le CEO autorisait 3–4 ; 4 est la borne haute, volontairement modérée).
- **Les vagues bornées (5 en vol max)** n'apportent rien quand la latence est
  inférieure à l'intervalle de débit (1 req/s → mesure inchangée, en vol max = 1),
  mais elles **protègent contre une latence élevée** : sur un réseau mobile où une
  requête coûte 0,5 s, une boucle séquentielle coûterait `n × latence` alors que la
  version livrée reste bornée par `(1 + imagecount) / 4`. C'est la raison de fond du
  choix : elle ne dégrade jamais et borne toujours le pire cas.
- Le plancher réseau absolu (sans limiteur) est de 3,8 s / 9,5 s : la version livrée
  (5,1 s / 11,8 s) est proche de ce plancher, il ne reste presque rien à gagner sans
  agresser le site.

## 4. Preuve d'égalité fonctionnelle (URLs identiques, ordre inclus)

`.mgrf/perf/compare.js` compare **les listes complètes** produites avant et après
(mesures réelles, jetons du CDN inclus) :

```
OK   court-18 : avant=18 pages (18172 ms, rps=1), après=18 pages (5104 ms, rps=4) — listes identiques (ordre inclus) = true
OK   long-46  : avant=46 pages (46225 ms, rps=1), après=46 pages (11836 ms, rps=4) — listes identiques (ordre inclus) = true
OK   court-18 (même débit 1 req/s) : listes identiques = true
OK   long-46  (même débit 1 req/s) : listes identiques = true
```

Les deux derniers cas sont décisifs : **débit identique, seul le code change** ⇒
aucune différence ne peut être imputée à autre chose qu'à la parallélisation.

Deuxième preuve indépendante (`.mgrf/perf/probe-pairs.js`, autre chemin de mesure,
`pvalue[0]` de chaque page re-résolu contre la référence séquentielle) :
**64/64 URLs identiques** (18/18 et 46/46).

Troisième preuve, côté images : **`18/18` et `46/46` URLs répondent `200 image/jpeg`**
avec `Referer: https://fanfox.net/` en-tête **première ET dernière** comprises
(`.mgrf/perf/check-all-images.js`, 11,3 Mio téléchargés).

## 5. Méthode retenue : piste A, et pourquoi pas B (mesurée)

**Retenu — piste A : vagues bornées de `chapterfun.ashx` (5 en vol maximum) +
`requestsPerSecond: 4`.** Les résultats sont replacés **par index de page** (jamais
dans l'ordre d'arrivée), donc la liste produite est celle de la boucle séquentielle.
La première erreur est propagée à l'identique (mêmes messages 403/404/404/vide).
Aucune URL n'est reconstruite ni déduite : `pvalue[0]` et `var pix` du site restent
la seule source des URLs.

**Piste B (demi-requêtes + rattrapage) — mesurée puis NON retenue.** Mesure :
`pvalue[1]` correspond bien à la page suivante dans **62/62 couples vérifiables**
(17/17 sur `vTBE/c1196`, 45/45 sur `v00/c000`) — l'hypothèse est donc *vraie sur les
2 chapitres testés*. Elle est écartée pour trois raisons explicites :

1. la preuve ne porte que sur **2 chapitres** : la faire passer pour générale serait
   exactement le genre d'affirmation non prouvée que la tâche interdit ;
2. son mode d'échec est **silencieux** : un désaccord produirait une URL *valide*
   désignant la **mauvaise page** (corruption visuelle), là où un échec de la
   piste A lève une erreur explicite ;
3. l'objectif (≥ 3×) est **déjà atteint sans elle** (×3,56 / ×3,91).

Piège n°3 confirmé par la mesure, dans les deux chapitres : **un trou de numérotation
par chapitre, à la DERNIÈRE page** (`d017.jpg` → `d037.jpg` ; `m45.jpg` → `ma5.jpg`).
Toute reconstruction « 1..imagecount » produirait une URL fausse : il n'y en a aucune.

## 6. Vérifications exigées — résultats réels

| vérification | commande | résultat |
|---|---|---|
| compilation | `npm run typecheck` | exit 0 |
| bundle | `./node_modules/.bin/paperback bundle` | **exit 0** |
| manifeste | `bundles/versioning.json` | **2 sources** : Bigsolo 0.2.2, **Fanfox 1.0.6** |
| harnais officiel | `./node_modules/.bin/paperback test` | **exit 0, 0 `[FAILURE]`** |
| égalité des URLs | `.mgrf/perf/compare.js` | 4/4 listes identiques (ordre inclus) |
| images | `.mgrf/perf/check-all-images.js` | 64/64 en `200 image/*` |
| non-régression | `.mgrf/perf/probe-regression.js` (avant **et** après) | **identiques** : accueil 21+28 items, fiche `One Piece`/`Ongoing`/`ODA Eiichiro`/1 tag/1 149 car., 1 232 chapitres, recherche 12+12 avec `metadata={page:2}` |
| 18+ (`grand_blue`) | `.mgrf/perf/probe-adult.js` (avant **et** après) | **149 chapitres**, `premier=v01/c001 dernier=v20/c112`, identique avant/après |
| instantanés | `snapshot.sh` | `repo-avant-perf-20261018-210135.tar.gz` puis `repo-apres-perf-*.tar.gz` |

Le déblocage 18+ n'est pas vérifiable avec le polyfill nu (il ne fournit **aucun**
`cookieStore`) : la sonde installe un magasin de cookies minimal qui renvoie les
cookies ajoutés dans l'en-tête `Cookie` des requêtes suivantes, ce qui **reproduit le
runtime natif**. Témoin négatif conservé : sans magasin, le message diagnostic
explicite « Fiche 18+ … magasin de cookies ABSENT » est bien levé.

## 7. Ce qui reste à valider sur iPhone — AUCUNE affirmation ici

Rien de ce rapport ne prouve le comportement de l'application. Restent à vérifier
sur appareil :

1. **durée réelle d'ouverture d'un chapitre** dans l'app (le manager natif peut
   espacer différemment les départs ; le harnais le modélise, il ne l'est pas) ;
2. **rendu des pages** : toutes les images s'affichent, dans le bon ordre, y compris
   la dernière page (URL au nom non contigu) ;
3. **déblocage 18+** (`grand_blue`) avec le vrai `cookieStore` de l'app ;
4. **sections d'accueil** et **instantanés** : non touchés par ce lot (aucune
   modification de `getHomePageSections`, `getMangaDetails`, `getChapters`,
   `getSearchResults`) mais non rejoués dans l'UI ;
5. **comportement réseau dégradé** (4G) : c'est là que les vagues bornées devraient
   apporter le gain le plus visible.

## 8. Fichiers livrés

Code (2 fichiers, diff intégral fourni) :

- `src/Fanfox/Fanfox.ts` — `getChapterDetails` en vagues bornées, `requestsPerSecond: 4`, version **1.0.6**, commentaires de performance et de piège mis à jour ;
- `src/Fanfox/Common.ts` — `mapWithConcurrency` (pool borné, résultats par index, fonction pure testable en Node) + constante `CHAPTER_PAGE_CONCURRENCY = 5` ;
- `bundles/` régénéré (`bundles/Fanfox/source.js`, `bundles/versioning.json`).

Harnais et preuves (`.mgrf/perf/`, joints à la carte Kanban) :
`RAPPORT-perf-chapitres.md`, `harness.js`, `compare.js`, `check-all-images.js`,
`probe-pairs.js`, `probe-regression.js`, `probe-adult.js`, `find-long.js`,
`scan-manga.js`, `diff-Fanfox.ts.patch`, `diff-Common.ts.patch`, `hashes.txt`,
`avant-rps1.json`, `avant-rps4.json`, `apres-rps1.json`, `apres-rps4.json`,
`piste-b.json`, `court-18-images.json`, `long-46-images.json`,
`court-18-apres-rps4.pages.json`, `long-46-apres-rps4.pages.json`,
`test-after-perf.log`, `bundle-after-perf.log`, `compare.log`, `images.log`,
`probe-regression-*.log`, `probe-adult-after.log`, `harness-apres-rps*.log`,
`.mgrf/perf/livrable-perf-chapitres.tar.gz` (archive de l'ensemble).

Empreintes SHA-256 de l'artefact testé (`hashes.txt`) :

```
bcaf35564517b4d78f68f72e75b4ba4054ac390ad91302a77f3cfaeea5a3fdfc  src/Fanfox/Fanfox.ts
f4f928ffdbe2df68e6cba9584c4f70d657e80ac71de8c9d96bb1bb3d6a105bab  src/Fanfox/Common.ts
d8654c81661023446f3a5b4cbc71755321d945dfcb930ef9ce3f28f18cd744c4  tmp/Fanfox/Fanfox.js
b94f4a891bc6abf7bd56b2b921e6a825035fcc5cff1d009285d3634cceca3ca3  bundles/Fanfox/source.js
7afd4438b4156b558e5b6bcb065f27cb408cb498b2d9bf1bb6c935dc39c78689  bundles/versioning.json
```

## 9. Honnêteté — testé / non testé

**Testé par exécution réelle** : durées avant/après sur 2 chapitres réels, égalité
des listes d'URLs par 3 chemins indépendants, 64 images en 200, non-régression
accueil/fiche/chapitres/recherche/18+ avant **et** après, `bundle`, `test`,
`typecheck`. **Non testé** : comportement sur iPhone (§7), autres séries que les
4 utilisées (`one_piece`, `bleach`, `naruto`, `grand_blue`), réseau dégradé, et
toute mesure de débit réellement appliquée par le manager natif.

Aucun objet brut n'est transmis au natif : les seules fabriques utilisées restent
`App.createRequest`, `App.createChapterDetails`, `App.createHomeSection`,
`App.createPartialSourceManga`, `App.createSourceManga`, `App.createMangaInfo`,
`App.createTagSection`, `App.createChapter`, `App.createPagedResults`,
`App.createRequestManager` (achat inchangé de ce côté).
