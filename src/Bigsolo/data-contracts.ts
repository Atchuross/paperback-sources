/**
 * Bigsolo — contrats de données (formes JSON réelles de bigsolo.org).
 *
 * Ces interfaces décrivent uniquement les structures renvoyées par les
 * endpoints publics du site (relevées en phase 1, tâche `t_fe49dead`) :
 *   - GET /data/series                     -> BigsoloCatalog
 *   - GET /data/series/{slug}/{chapitre}   -> BigsoloChapterPages
 *
 * Aucune référence au runtime Paperback (`App`) ici : ce fichier reste
 * importable et compilable hors application (tests unitaires).
 */

/** Couverture (objet `cover` / élément de `covers[]`). */
export interface BigsoloCover {
  url_hq?: string;
  url_lq?: string;
  volume?: string;
  licensed?: boolean;
}

/** Équipe de traduction attachée à une série. */
export interface BigsoloTeam {
  id: string;
  active?: boolean;
}

/** Provenance du chapitre (ex. `{ service: "imgchest", id: "vj4jal56348" }`). */
export interface BigsoloChapterSource {
  service?: string;
  id?: string;
}

/** Une entrée de la map `chapters` d'une série (clé = numéro littéral). */
export interface BigsoloChapterEntry {
  title?: string;
  volume?: string;
  timestamp?: number;
  licensed?: boolean;
  teams?: string[];
  source?: BigsoloChapterSource;
}

/** Dernier chapitre publié (`last_chapter`). */
export interface BigsoloLastChapter {
  number?: number | string;
  title?: string;
  volume?: string;
  timestamp?: number;
  licensed?: boolean;
  teams?: string[];
}

/** Un item de série / one-shot du catalogue `/data/series`. */
export interface BigsoloSeriesItem {
  key?: string | number;
  slug: string;
  title?: string;
  description?: string;
  artist?: string;
  author?: string;
  demographic?: string;
  magazine?: string;
  release_year?: number;
  tags?: string[];
  ja_title?: string;
  alternative_titles?: string[];
  teams?: BigsoloTeam[];
  status?: string;
  release_rhythm?: string;
  covers?: BigsoloCover[];
  episodes?: unknown[];
  anime?: unknown;
  /** Map `numéro littéral -> entrée` (clés décimales possibles : "127.5"). */
  chapters?: Record<string, BigsoloChapterEntry>;
  cover?: BigsoloCover;
  last_chapter?: BigsoloLastChapter;
  /** `true` pour un one-shot. */
  os?: boolean;
  hidden?: boolean;
}

/** Racine du catalogue `/data/series`. */
export interface BigsoloCatalog {
  series?: BigsoloSeriesItem[];
  os?: BigsoloSeriesItem[];
  reco?: BigsoloSeriesItem[];
  slugs?: string[];
}

/** Réponse de `/data/series/{slug}/{chapitre}` (pages du chapitre). */
export interface BigsoloChapterPages {
  number?: string;
  title?: string;
  volume?: string;
  timestamp?: number;
  licensed?: boolean;
  teams?: string[];
  source?: BigsoloChapterSource;
  cover?: BigsoloCover;
  images?: string[];
}
