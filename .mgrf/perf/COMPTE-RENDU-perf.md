# Compte rendu PERF Fanfox — getChapterDetails (Kanban t_a6d6f882)

Fanfox passe en **1.0.6**. Livrable vérifié par exécution réelle sur fanfox.net.

## Mesures (harnais `.mgrf/perf/harness.js`, mêmes 2 chapitres)

| build | débit | one_piece/vTBE/c1196 (18 p.) | bleach/v00/c000 (46 p.) | requêtes |
|---|---|---|---|---|
| avant 1.0.5 (séquentiel) | 1 req/s | 18 172 ms | 46 225 ms | 19 / 47 |
| après 1.0.6 (vagues bornées 5) | 4 req/s | 5 104 ms | 11 836 ms | 19 / 47 |
| avant (séquentiel) | 4 req/s | 4 944 ms | 12 024 ms | 19 / 47 |
| après (vagues bornées) | 1 req/s | 18 190 ms | 46 160 ms | 19 / 47 |
| avant, sans limiteur | — | 3 824 ms | 9 453 ms | 19 / 47 |

Gain livré : **×3,56** (court) et **×3,91** (long). La ligne 1 reproduit exactement les
mesures du CEO (18 s / 46 s), ce qui calibre le modèle de limiteur utilisé par le harnais.

Décomposition : à latence ~200 ms, le levier dominant est `requestsPerSecond: 1 → 4`
(ligne 3 : le code séquentiel à 4 req/s donne déjà ~4,9 s / ~12 s). Les vagues bornées
n'apportent rien quand la latence < 1/débit (ligne 4) mais bornent le pire cas sur
réseau lent. Plancher réseau absolu : 3,8 s / 9,5 s.

## Méthode retenue

Piste A : pool borné de 5 appels `chapterfun.ashx` en vol (`mapWithConcurrency`,
résultats replacés PAR INDEX de page, jamais dans l'ordre d'arrivée) + débit 4 req/s.
Aucune URL reconstruite ni déduite ; erreurs propagées à l'identique.

Piste B (demi-requêtes) mesurée puis écartée : `pvalue[1]` == page suivante dans
**62/62** couples vérifiables, mais preuve limitée à 2 chapitres, mode d'échec
**silencieux** (URL valide désignant la mauvaise page), objectif déjà atteint.
Piège n°3 confirmé : **1 trou de numérotation par chapitre, à la dernière page**
(`d017.jpg`→`d037.jpg` pour vTBE/c1196 ; `m45.jpg`→`ma5.jpg` pour v00/c000).

## Égalité fonctionnelle (3 chemins indépendants)

1. `.mgrf/perf/compare.js` : **4/4 listes d'URLs identiques, ordre inclus** (dont deux
   comparaisons à débit identique 1 req/s ⇒ seule la parallélisation change).
2. `.mgrf/perf/probe-pairs.js` (autre chemin) : **64/64 URLs identiques**.
3. `.mgrf/perf/check-all-images.js` : **18/18 et 46/46 images en `200 image/*`**
   (première ET dernière page comprises).

## Vérifications exigées

- `npm run typecheck` exit 0 ; `paperback bundle` **exit 0** ; manifeste **2 sources**,
  **Fanfox 1.0.6** ; `paperback test` **exit 0, 0 `[FAILURE]`**.
- Non-régression exécutée **avant ET après**, résultats identiques : accueil 21 + 28
  items, fiche `One Piece` / `Ongoing` / `ODA Eiichiro` / 1 tag / 1 149 car.,
  **1 232 chapitres**, recherche 12 + 12 (`metadata={page:2}`), **18+ `grand_blue` → 149
  chapitres** (`v01/c001` … `v20/c112`).
- 18+ : non testable avec le polyfill nu (aucun `cookieStore`) ⇒ sonde à magasin de
  cookies émulé (comportement du runtime natif) + témoin négatif conservé.
- Instantanés : `repo-avant-perf-20261018-210135.tar.gz`, `repo-apres-perf-20261018-211833.tar.gz`.

## Livrables

- `src/Fanfox/Fanfox.ts` (1.0.6), `src/Fanfox/Common.ts` (`mapWithConcurrency`,
  `CHAPTER_PAGE_CONCURRENCY = 5`), `bundles/` régénéré.
- Rapport complet : `.mgrf/perf/RAPPORT-perf-chapitres.md`
- Archive de toutes les preuves : `.mgrf/perf/livrable-perf-chapitres.tar.gz`
  (harnais, sondes, journaux, JSON bruts, diffs, copies des sources, rapport).
- Diffs : `.mgrf/perf/diff-Fanfox.ts.patch`, `.mgrf/perf/diff-Common.ts.patch`.

Empreintes SHA-256 de l'artefact testé : voir `hashes.txt` (pièce jointe) —
`Fanfox.ts` bcaf3556…, `Common.ts` f4f928ff…, `bundles/Fanfox/source.js` b94f4a89….

## NON testé — aucune affirmation iPhone

Durée réelle dans l'application (le harnais MODÉLISE le limiteur natif, il ne l'est
pas), rendu des pages (dont la dernière au nom non contigu), 18+ avec le vrai
`cookieStore`, UI accueil/fiches/recherche, réseau 4G dégradé, séries autres que
`one_piece`, `bleach`, `naruto`, `grand_blue`.
