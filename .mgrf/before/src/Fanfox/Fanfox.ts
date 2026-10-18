/**
 * Fanfox — source Paperback 0.8 pour https://fanfox.net
 *
 * Couche données complète :
 *   - recherche paginée `GET /search?title=<q>&page=<n>` (HTML, 12 tuiles/page) ;
 *   - fiche série `GET /manga/<slug>/` (titre, couverture, statut, auteur, tags,
 *     synopsis COMPLET via `p.fullcontent`) ;
 *   - liste des chapitres : dans la MÊME page, union de `div#list-1` et
 *     `div#list-2` (`div#chapterlist`) — liste complète, aucune pagination ;
 *   - pages de chapitre : `GET /manga/<slug>/<chapterId>/1.html` (imagecount +
 *     clé `guidkey` déballée en pur), puis UN appel
 *     `chapterfun.ashx?cid=…&page=<n>&key=…` par page ; l'URL d'image est
 *     reconstruite depuis `var pix` + `pvalue[0]` ⇒ aucun hôte CDN codé en dur ;
 *   - User-Agent navigateur + `Referer: https://fanfox.net/` posés par
 *     `FanfoxInterceptor` (le CDN répond 403 sans Referer d'hôte fanfox.net) ;
 *   - erreurs 403 / 404 / autres / corps vide traduites explicitement, sans
 *     aucun contournement de protection.
 *
 * API Paperback 0.8 uniquement : Source / SourceInfo / SourceIntents /
 * RequestManager / SourceInterceptor / PagedResults.
 */

import {
  Chapter,
  ChapterDetails,
  ContentRating,
  PagedResults,
  PartialSourceManga,
  RequestManager,
  Response,
  SearchRequest,
  Source,
  SourceInfo,
  SourceIntents,
  SourceManga,
  TagSection,
} from "@paperback/types";

import { CheerioAPI } from "cheerio";

import {
  accessDeniedError,
  BASE_URL,
  chapterFunUrl,
  chapterFunParseError,
  chapterReaderUrl,
  emptyBodyError,
  emptyChapterFunError,
  errorMessageOf,
  FanfoxInterceptor,
  httpStatusError,
  httpStatusFromError,
  isBlank,
  LANG_CODE,
  mangaShareUrl,
  missingChapterIdError,
  missingChapterKeyError,
  networkError,
  noPagesError,
  notFoundError,
  parseChapterImageResponse,
  parseChapterList,
  parseReaderMeta,
  parseSearchResults,
  parseSeriesDetails,
  searchUrl,
  seriesUrl,
} from "./Common";
import { FChapterEntry, FSeriesTile } from "./data-contracts";

export const FanfoxInfo: SourceInfo = {
  version: "1.0.4",
  name: "Fanfox",
  icon: "icon.png",
  author: "bigsolo-paperback08",
  description: "Source Paperback 0.8 pour fanfox.net (lecture manga, anglais).",
  contentRating: ContentRating.EVERYONE,
  websiteBaseURL: BASE_URL,
  language: LANG_CODE,
  // `intents` = MANGA_CHAPTERS SEUL, volontairement.
  //
  // • `HOMEPAGE_SECTIONS` est ABSENT : aucune section d'accueil n'est demandée
  //   pour cette source. Sans cet intent, l'application n'appelle jamais la
  //   méthode d'accueil et il n'y a donc aucune section vide à produire (le
  //   harnais officiel rejette toute section sans items).
  // • `MANGA_TRACKING` est ABSENT, et ne doit PAS être ajouté : il implique
  //   l'interface `MangaProgressProviding` (`getMangaProgress`,
  //   `getMangaProgressManagementForm`, `processChapterReadActionQueue`), qui
  //   n'est pas implémentée ici ⇒ erreurs JS à l'ouverture des fiches manga et
  //   des chapitres dans l'application (incident `t_810bda32` sur Bigsolo).
  intents: SourceIntents.MANGA_CHAPTERS,
};

/** Interceptor public (implémentation pure dans `Common.ts`). */
export { FanfoxInterceptor };

export class Fanfox extends Source {
  requestManager: RequestManager = App.createRequestManager({
    interceptor: new FanfoxInterceptor(),
    requestsPerSecond: 1,
    requestTimeout: 30000,
  });

  /** Résultat exact de la tentative de pose du cookie d'âge (diagnostic). */
  private adultCookieDiag = "non exécuté";

  constructor(cheerio: CheerioAPI) {
    super(cheerio);

    // Cookie d'âge « isAdult=1 » (séries classées 18+), posé via le magasin de
    // cookies OFFICIEL du RequestManager (API 0.8 : `RequestManager.cookieStore`
    // -> `addCookie`). N'altère NI l'objet `Request` NI ses en-têtes.
    // On renseigne `created`/`expires` comme le fait le site (cookie de 1 jour) :
    // un cookie sans date peut être rejeté.
    try {
      const store = this.requestManager?.cookieStore;
      if (!store) {
        this.adultCookieDiag = "magasin de cookies ABSENT";
      } else {
        const now = new Date();
        // IMPORTANT : le cookie doit être construit par `App.createCookie` pour
        // porter le type attendu par le natif. Un objet JavaScript brut fait lever
        // « Argument does not match Objective-C Class » (même cause que le crash
        // antérieur, où un objet brut était assigné à `request.cookies`).
        const result: unknown = store.addCookie(
          App.createCookie({
            name: "isAdult",
            value: "1",
            domain: "fanfox.net",
            path: "/",
            created: now,
            expires: new Date(now.getTime() + 24 * 3600 * 1000),
          }),
        );
        const ret =
          result && typeof (result as { then?: unknown }).then === "function"
            ? "retour = promesse"
            : `retour = ${typeof result}`;
        this.adultCookieDiag = `addCookie appelé SANS erreur (${ret})`;
      }
    } catch (error) {
      const message =
        error && typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : String(error);
      this.adultCookieDiag = `addCookie a LEVÉ : ${message}`;
    }
  }

  get baseUrl(): string {
    return BASE_URL;
  }

  /* ---------------------------------------------------------------- */
  /* Recherche                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * `GET /search?title=<q>&page=<n>` — `page` 1-indexé.
   *
   * Le site n'a qu'une pagination de résultats : chaque page expose 12 tuiles.
   * Une page au-delà du dernier résultat répond 200 avec 0 tuile (mesuré) : on
   * renvoie alors une liste vide SANS lever d'erreur et sans metadata de suite.
   *
   * Les tags (`includedTags` / `excludedTags`) ne sont pas supportés par cet
   * endpoint (`/search?title=…` uniquement) : ils sont ignorés plutôt que
   * traduits au hasard en paramètres qui produiraient des résultats faux.
   */
  async getSearchResults(query: SearchRequest, metadata: unknown | undefined): Promise<PagedResults> {
    const page = pageOf(metadata);
    const title = typeof query?.title === "string" ? query.title : "";

    const html = await this.fetchText(searchUrl(title, page), emptyBodyError);
    const parsed = parseSearchResults(html);

    return App.createPagedResults({
      results: parsed.items.map((tile) => this.toPartialSourceManga(tile)),
      metadata: parsed.hasMore ? { page: page + 1 } : undefined,
    });
  }

  private toPartialSourceManga(tile: FSeriesTile): PartialSourceManga {
    return App.createPartialSourceManga({
      mangaId: tile.mangaId,
      title: tile.title,
      image: tile.image,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Fiche manga                                                      */
  /* ---------------------------------------------------------------- */

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const html = await this.fetchText(seriesUrl(mangaId), emptyBodyError);
    const details = parseSeriesDetails(html, mangaId);

    const tagSections: TagSection[] =
      details.tags.length > 0
        ? [
            App.createTagSection({
              id: "tags",
              label: "Tags",
              tags: details.tags.map((tag) => ({ id: tag, label: tag })),
            }),
          ]
        : [];

    return App.createSourceManga({
      id: mangaId,
      mangaInfo: App.createMangaInfo({
        image: details.image,
        titles: details.titles,
        desc: details.description,
        // Statut transmis BRUT (`Ongoing`, `Completed`…) : le site n'expose pas
        // d'énumération Paperback, aucun mapping n'est inventé.
        status: details.status,
        author: details.author,
        artist: "",
        tags: tagSections,
        covers: details.image.length > 0 ? [details.image] : [],
      }),
    });
  }

  getMangaShareUrl(mangaId: string): string {
    return mangaShareUrl(mangaId);
  }

  /* ---------------------------------------------------------------- */
  /* Chapitres                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * La liste COMPLÈTE des chapitres est dans la page de la fiche (union de
   * `div#list-1` et `div#list-2`, aucune pagination — mesuré : 1 232 entrées
   * pour `one_piece`). Aucun endpoint séparé n'est appelé.
   */
  async getChapters(mangaId: string): Promise<Chapter[]> {
    const html = await this.fetchText(seriesUrl(mangaId), emptyBodyError);
    const entries = parseChapterList(html, mangaId);

    // Diagnostic (étape 2b) : si la fiche est bloquée par l'écran d'avertissement
    // 18+ du site et qu'aucun chapitre n'est extrait, on remonte un message qui
    // indique si l'application fournit ou non son magasin de cookies.
    if (entries.length === 0 && /id="checkAdult"|under-aged viewers/i.test(html)) {
      const store = this.requestManager?.cookieStore;
      throw new Error(
        `Fiche 18+ sur fanfox.net : l'écran d'avertissement d'âge est affiché et le ` +
          `cookie « isAdult=1 » n'a pas été pris en compte. Diagnostic : magasin de ` +
          `cookies fourni par l'application = ${store ? "PRÉSENT" : "ABSENT"} ; ` +
          `résultat de l'ajout = ${this.adultCookieDiag}.`,
      );
    }

    return entries.map((entry) => this.toChapter(entry));
  }

  private toChapter(entry: FChapterEntry): Chapter {
    return App.createChapter({
      // `chapterId` = segments de chemin après le slug (`vTBE/c1196`,
      // `c1024.5`) : jamais un numéro arrondi, jamais une URL complète.
      id: entry.chapterId,
      chapNum: entry.chapNum,
      volume: entry.volume,
      name: entry.name,
      time: entry.time,
      langCode: LANG_CODE,
      sortingIndex: entry.chapNum,
    });
  }

  /**
   * Pages d'un chapitre :
   *   1. page de lecture `…/<chapterId>/1.html` ⇒ `chapterid` + `imagecount` +
   *      clé `guidkey` (déballée en pur, sans `eval`) ;
   *   2. UN appel `chapterfun.ashx?cid=<chapterid>&page=<n>&key=<guidkey>` par
   *      page `n = 1..imagecount`, puis `pvalue[0]` + `var pix` ⇒ URL absolue.
   *
   * LIMITE CONNUE : coût = `1 + imagecount` requêtes à 1 req/s (≈ `imagecount`
   * secondes pour ouvrir un chapitre ; 18 mesuré pour `one_piece/vTBE/c1196`).
   * Un seul élément de `pvalue` est fiable (`[0]`) : `page=17` renvoie
   * `[d017, d037]` alors que `page=18` renvoie `[d037]`. D'où un appel par page,
   * dans l'ordre, plutôt qu'un seul appel + déduction des pages suivantes.
   */
  async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
    const readerUrl = chapterReaderUrl(mangaId, chapterId, 1);
    const readerHtml = await this.fetchText(readerUrl, emptyBodyError);
    const meta = parseReaderMeta(readerHtml);

    if (meta.imageCount <= 0) throw noPagesError(chapterId);
    if (meta.chapterNumericId.length === 0) throw missingChapterIdError(chapterId, readerUrl);
    if (meta.guidKey.length === 0) throw missingChapterKeyError(chapterId, readerUrl);

    const pages: string[] = [];
    for (let page = 1; page <= meta.imageCount; page += 1) {
      const url = chapterFunUrl(mangaId, chapterId, meta.chapterNumericId, page, meta.guidKey);
      // Un corps vide n'est PAS un chapitre vide : erreur explicite (Referer).
      const body = await this.fetchText(url, (target) => emptyChapterFunError(target, page));
      const image = parseChapterImageResponse(body);
      if (image.url.length === 0) throw chapterFunParseError(chapterId, page, url);
      pages.push(image.url);
    }

    if (pages.length === 0) throw noPagesError(chapterId);

    return App.createChapterDetails({
      id: chapterId,
      mangaId,
      pages,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Couche requêtes / erreurs                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Émet une requête GET via le `RequestManager` (donc avec le User-Agent
   * navigateur et le Referer fanfox.net posés par l'interceptor) et renvoie le
   * corps texte. `retry = 1` : au plus un nouvel essai, jamais de rafale.
   *
   * Les statuts 403 / 404 / autres sont traduits en couvrant les DEUX
   * comportements possibles du runtime (polyfill Node) : exception de transport
   * levée par axios OU réponse portant un statut non-2xx.
   * `emptyError` choisit le message d'un corps vide (page HTML vs
   * `chapterfun.ashx`, où un corps vide signale un Referer manquant).
   */
  private async fetchText(url: string, emptyError: (url: string) => Error): Promise<string> {
    let response: Response;
    try {
      response = await this.requestManager.schedule(
        App.createRequest({ url, method: "GET" }),
        1,
      );
    } catch (error) {
      const status = httpStatusFromError(error);
      if (status === 403) throw accessDeniedError(url);
      if (status === 404) throw notFoundError(url);
      if (typeof status === "number" && status > 0) throw httpStatusError(status, url);
      throw networkError(errorMessageOf(error), url);
    }

    if (response.status === 403) throw accessDeniedError(url);
    if (response.status === 404) throw notFoundError(url);
    if (response.status < 200 || response.status >= 300) {
      throw httpStatusError(response.status, url);
    }

    const raw = typeof response.data === "string" ? response.data : "";
    if (isBlank(raw)) throw emptyError(url);
    return raw;
  }
}

/** Page de résultats demandée par l'application (`page` entier >= 1, 1-indexé). */
function pageOf(metadata: unknown): number {
  if (metadata === null || typeof metadata !== "object") return 1;
  const candidate = (metadata as { page?: unknown }).page;
  if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate <= 0) return 1;
  return Math.floor(candidate);
}
