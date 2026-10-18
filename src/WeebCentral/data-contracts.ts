/**
 * WeebCentral — contrats de données (formes réellement observées).
 *
 * Ces interfaces décrivent uniquement les entités extraites du HTML public de
 * `https://weebcentral.com` (relevé du 2026-10-18 par requêtes réelles avec UA
 * navigateur) :
 *   - GET /search/data?…&limit=32&offset=<O>      -> fragment HTML (tuiles)
 *   - GET /series/<ULID>                          -> page HTML (fiche)
 *   - GET /series/<ULID>/full-chapter-list        -> fragment HTML (chapitres)
 *   - GET /chapters/<ULID>/images                 -> fragment HTML (pages)
 *   - GET /latest-updates/<page>                  -> fragment HTML (tuiles)
 *
 * Aucune référence au runtime Paperback (`App`) ici : ce fichier reste
 * importable et compilable hors application (tests unitaires).
 */

/** Tuile de liste (résultat de recherche ou section d'accueil). */
export interface WCSeriesTile {
  /** ULID de série (identifiant stable utilisé comme `mangaId`). */
  mangaId: string;
  /** Titre d'affichage (jamais vide : replis successifs sur le slug). */
  title: string;
  /** URL absolue de couverture (`""` si la page n'en expose pas). */
  image: string;
}

/** Fiche série analysée depuis `/series/<ULID>`. */
export interface WCSeriesDetails {
  /** ULID demandé (recopié tel quel : la page ne le réexpose pas toujours). */
  mangaId: string;
  /** Titre principal (premier `<h1>` de la page). */
  title: string;
  /** Tous les titres connus (h1 + « Associated Name(s) »), dédoublonnés. */
  titles: string[];
  /** `og:image` (couverture), `""` si absent. */
  image: string;
  /** Synopsis (bloc `Description`). */
  description: string;
  /** Statut affiché (ex. `"Ongoing"`), `""` si absent. */
  status: string;
  /** Auteur(s) (liens de la ligne `Author(s):`), `""` si absent. */
  author: string;
  /** Année de parution (`Released:`), `undefined` si absente. */
  year: number | undefined;
  /** Tags (`Tags(s):`), dédoublonnés. */
  tags: string[];
}

/** Une entrée de `/series/<ULID>/full-chapter-list`. */
export interface WCChapterEntry {
  /** ULID de chapitre — JAMAIS le numéro (le numéro n'est pas unique). */
  chapterId: string;
  /** Libellé complet affiché (ex. `"Chapter 203"`, `"Mag Version 241"`). */
  name: string;
  /** Nombre terminal du libellé (`0` si aucun nombre exploitable). */
  chapNum: number;
  /** Date de publication extraite de `<time datetime>`, `undefined` si invalide. */
  time: Date | undefined;
}

/** Résultat de `/search/data` : tuiles + présence d'une page suivante. */
export interface WCSearchPage {
  items: WCSeriesTile[];
  hasMore: boolean;
}
