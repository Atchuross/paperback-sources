/**
 * AsuraScans — contrats de données (formes réellement observées).
 *
 * Toutes les formes ci-dessous proviennent de `https://api.asurascans.com`
 * (relevé du 2026-11-13 par requêtes réelles avec en-têtes navigateur) :
 *
 *   GET /api/series?search=<q>&limit=20&offset=<O>        -> { data[], meta{total,per_page,has_more?} }
 *   GET /api/series?limit=20&sort=trending|popular|latest -> { data[], meta{…} }
 *   GET /api/series/<slug>                                -> { series{…}, recommended_series[] }
 *   GET /api/series/<slug>/chapters                       -> { data[] }
 *   GET /api/series/<slug>/chapters/<numéro>              -> { data{ chapter{…}, … } }
 *
 * Les `…Dto` décrivent les charges JSON brutes ; les interfaces sans suffixe
 * décrivent les entités normalisées produites par les mappers purs de
 * `Common.ts`. Aucune référence au runtime Paperback (`App`) ici : ce fichier
 * reste importable et compilable hors application (tests unitaires).
 */

/* ------------------------------------------------------------------ */
/* Charges API (JSON brut, champs optionnels : rien n'est garanti)     */
/* ------------------------------------------------------------------ */

/** Genre renvoyé par l'API (`{id, name, slug}`). */
export interface AsuraGenreDto {
  id?: number | null;
  name?: string | null;
  slug?: string | null;
}

/** Série renvoyée par la recherche, les sections d'accueil et la fiche. */
export interface AsuraSeriesDto {
  id?: number | null;
  slug?: string | null;
  title?: string | null;
  alt_titles?: string[] | null;
  alternative_titles?: string | null;
  description?: string | null;
  cover?: string | null;
  banner?: string | null;
  status?: string | null;
  type?: string | null;
  author?: string | null;
  artist?: string | null;
  rating?: number | null;
  chapter_count?: number | null;
  last_chapter_at?: string | null;
  public_url?: string | null;
  genres?: AsuraGenreDto[] | null;
}

/** Métadonnées de pagination (`has_more` n'apparaît que si `total > per_page`). */
export interface AsuraSearchMetaDto {
  total?: number | null;
  per_page?: number | null;
  has_more?: boolean | null;
}

/** `GET /api/series?…&limit&offset` — recherche et sections d'accueil. */
export interface AsuraSeriesListResponseDto {
  data?: AsuraSeriesDto[] | null;
  meta?: AsuraSearchMetaDto | null;
  error?: string | null;
}

/** `GET /api/series/<slug>` — fiche série. */
export interface AsuraSeriesResponseDto {
  series?: AsuraSeriesDto | null;
  recommended_series?: AsuraSeriesDto[] | null;
  error?: string | null;
}

/** Une entrée de `GET /api/series/<slug>/chapters`. */
export interface AsuraChapterListEntryDto {
  id?: number | null;
  series_id?: number | null;
  number?: number | null;
  title?: string | null;
  slug?: string | null;
  page_count?: number | null;
  is_premium?: boolean | null;
  comments_enabled?: boolean | null;
  published_at?: string | null;
  created_at?: string | null;
  series_slug?: string | null;
}

/** `GET /api/series/<slug>/chapters`. */
export interface AsuraChapterListResponseDto {
  data?: AsuraChapterListEntryDto[] | null;
  error?: string | null;
}

/** Une page (image) d'un chapitre. */
export interface AsuraPageDto {
  url?: string | null;
  width?: number | null;
  height?: number | null;
}

/** Chapitre détaillé renvoyé par `GET /api/series/<slug>/chapters/<numéro>`. */
export interface AsuraChapterDto {
  id?: number | null;
  series_id?: number | null;
  number?: number | null;
  title?: string | null;
  slug?: string | null;
  /** ABSENT (`null`) sur un chapitre premium / accès anticipé. */
  pages?: AsuraPageDto[] | null;
  page_count?: number | null;
  is_premium?: boolean | null;
  early_access_until?: string | null;
  published_at?: string | null;
}

/** Enveloppe `data` de la réponse « pages d'un chapitre ». */
export interface AsuraChapterDataDto {
  /** Vide (`""`) même sur un chapitre verrouillé : jamais un signal fiable. */
  access_gate?: string | null;
  is_locked?: boolean | null;
  unlock_time?: string | null;
  chapter?: AsuraChapterDto | null;
  chapter_list?: AsuraChapterListEntryDto[] | null;
  series?: AsuraSeriesDto | null;
}

/** `GET /api/series/<slug>/chapters/<numéro>`. */
export interface AsuraChapterResponseDto {
  data?: AsuraChapterDataDto | null;
  error?: string | null;
}

/* ------------------------------------------------------------------ */
/* Entités normalisées (produites par les mappers purs)                */
/* ------------------------------------------------------------------ */

/** Tuile de liste (résultat de recherche ou section d'accueil). */
export interface AsuraSeriesTile {
  /** Slug nu de la série (identifiant stable utilisé comme `mangaId`). */
  mangaId: string;
  /** Titre d'affichage (jamais vide : repli sur le slug). */
  title: string;
  /** URL absolue `https://` de couverture (`""` si l'API n'en expose pas). */
  image: string;
}

/** Fiche série normalisée. */
export interface AsuraSeriesDetails {
  /** Slug demandé (recopié : l'API peut ne pas le réexposer). */
  mangaId: string;
  /** Titre principal. */
  title: string;
  /** Tous les titres connus (titre + `alt_titles`), dédoublonnés. */
  titles: string[];
  /** Couverture `https://`, `""` si absente. */
  image: string;
  /** Synopsis en texte brut (balises du champ `description` retirées). */
  description: string;
  /** Statut normalisé (`Ongoing`, `Completed`, `Hiatus`, `Cancelled`, `Unknown`). */
  status: string;
  /** Auteur, `""` si absent. */
  author: string;
  /** Dessinateur, `""` si absent. */
  artist: string;
  /** Genres (`genres[].name`), dédoublonnés. */
  tags: string[];
  /** Type affiché (`manhwa`, `manga`…), `""` si absent. */
  type: string;
  /** Note sur 10, `undefined` si absente. */
  rating: number | undefined;
}

/** Une entrée de `GET /api/series/<slug>/chapters` normalisée. */
export interface AsuraChapterEntry {
  /**
   * Identifiant de chapitre = NUMÉRO sous forme de chaîne (`"10"`, `"0"`,
   * `"100.5"` : l'API sert aussi des numéros décimaux, mesuré).
   */
  chapterId: string;
  /** Numéro numérique (tri, `chapNum`, `sortingIndex`). */
  chapNum: number;
  /** Libellé fourni par l'API, `""` si `title` est `null` (180 cas mesurés). */
  name: string;
  /** Date de publication, `undefined` si absente/invalide. */
  time: Date | undefined;
  /** Vrai si l'API marque le chapitre comme premium (`is_premium`). */
  isPremium: boolean;
}

/** Résultat d'une page de recherche / de section : tuiles + suite éventuelle. */
export interface AsuraSearchPage {
  items: AsuraSeriesTile[];
  /** Décalage de la page suivante, `undefined` si la dernière page est atteinte. */
  nextOffset: number | undefined;
}
