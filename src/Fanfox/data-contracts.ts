/**
 * Fanfox — contrats de données (formes réellement observées le 2026-10-18).
 *
 * Ces interfaces décrivent uniquement les entités extraites du HTML / du JS
 * public de `https://fanfox.net`, relevées par requêtes réelles (UA navigateur,
 * ≥ 1 s entre requêtes) dans ce workspace :
 *   - GET /releases/                                     -> HTML (21 tuiles « Lastest Updates »)
 *   - GET /trending/                                     -> HTML (28 tuiles « Trending Manga »)
 *   - GET /search?title=<q>&page=<n>                     -> HTML (12 tuiles / page)
 *   - GET /manga/<slug>/                                 -> HTML (fiche + chapitres)
 *   - GET /manga/<slug>/<chapterId>/1.html                -> HTML (lecteur, imagecount)
 *   - GET /manga/<slug>/<chapterId>/chapterfun.ashx?…     -> JS packé (pix + pvalue)
 *   - GET <cdn>/…/<page>.jpg?token=…&ttl=…                -> image (Referer requis)
 *
 * Aucune référence au runtime Paperback (`App`) ici : ce fichier reste
 * importable et compilable hors application (tests unitaires).
 */

/** Tuile de résultat de recherche (`p.manga-list-4-item-title`). */
export interface FSeriesTile {
  /** Slug de série (ex. `one_piece`) — identifiant stable utilisé comme `mangaId`. */
  mangaId: string;
  /** Titre d'affichage (jamais vide : repli sur le slug). */
  title: string;
  /** URL absolue de couverture (`""` si la tuile n'en expose pas). */
  image: string;
}

/** Résultat d'une page de recherche : tuiles + présence d'une page suivante. */
export interface FSearchPage {
  items: FSeriesTile[];
  hasMore: boolean;
}

/** Fiche série analysée depuis `/manga/<slug>/`. */
export interface FSeriesDetails {
  /** Slug demandé (recopié tel quel : la page ne le réexpose pas sous forme d'ID). */
  mangaId: string;
  /** Titre principal (`span.detail-info-right-title-font`). */
  title: string;
  /** Tous les titres connus (ici le titre principal), dédoublonnés. */
  titles: string[];
  /** Couverture absolue (`img.detail-info-cover-img[src]`), `""` si absente. */
  image: string;
  /** Synopsis complet (`p.fullcontent`, PAS `p.detail-info-right-content` tronqué). */
  description: string;
  /** Statut affiché (ex. `"Ongoing"`), `""` si absent. */
  status: string;
  /** Auteur(s) (`p.detail-info-right-say > a`), `""` si absent. */
  author: string;
  /** Tags (`p.detail-info-right-tag-list > a[title]`), dédoublonnés. */
  tags: string[];
}

/** Une entrée de la liste des chapitres (`div#chapterlist`). */
export interface FChapterEntry {
  /**
   * Segments de chemin après le slug, tels que lus dans le `href`
   * (`vTBE/c1196`, `v01/c001`, `c1024.5`) — JAMAIS un numéro arrondi ni l'URL
   * complète. Reconstruction : `/manga/<mangaId>/<chapterId>/1.html`.
   */
  chapterId: string;
  /** Libellé affiché (`p.title3`, ex. `"Ch.1046.5"`, `"Vol.TBE Ch.1196"`). */
  name: string;
  /** Nombre terminal du libellé (décimales incluses) ; `0` si introuvable. */
  chapNum: number;
  /** Volume numérique si le chapitre en déclare un (ex. `v01` -> 1), sinon `undefined`. */
  volume: number | undefined;
  /** Date de publication (`p.title2`) parsée explicitement en UTC. */
  time: Date | undefined;
}

/** Variables du lecteur extraites de `/manga/<slug>/<chapterId>/1.html`. */
export interface FReaderMeta {
  /** `var comicid` (identifiant interne de la série), `""` si absent. */
  comicId: string;
  /** `var chapterid` — identifiant numérique exigé par `chapterfun.ashx?cid=`. */
  chapterNumericId: string;
  /** `var imagecount` — nombre de pages (0 si absent/illisible). */
  imageCount: number;
  /** Clé `guidkey` (hex) écrite par le script packé dans `#dm5_key`, `""` si absente. */
  guidKey: string;
}

/** Réponse déballée de `chapterfun.ashx?cid=…&page=…&key=…`. */
export interface FChapterImage {
  /** Préfixe `var pix` (protocole-relatif, ex. `//<hôte-cdn>/store/…`). */
  hostBase: string;
  /** `pvalue[0]` (chemin + query `token`/`ttl`) — seul élément fiable. */
  relative: string;
  /** URL absolue reconstruite (`https:…`), `""` si non reconstructible. */
  url: string;
}

/** Un bloc d'appel du « packer » `eval(function(p,a,c,k,e,d){…}(…))`. */
export interface PackerCall {
  /** Base de numérotation des jetons (`a`). */
  base: number;
  /** Nombre de jetons (`c`). */
  count: number;
  /** Dictionnaire (`k`) : `keys[i]` remplace le jeton `i`. */
  keys: string[];
  /** Charge utile (`p`) déjà dé-échappée. */
  payload: string;
}
