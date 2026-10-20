/**
 * WeebCentral — source Paperback 0.8 pour https://weebcentral.com
 *
 * Couche données complète :
 *   - recherche paginée `GET /search/data?…&limit=32&offset=<O>` (fragment HTML) ;
 *   - fiche série `GET /series/<ULID>` (titre, couverture, synopsis, statut,
 *     auteur, année, tags) ;
 *   - liste des chapitres `GET /series/<ULID>/full-chapter-list` (ULID de
 *     chapitre + libellé + date) ;
 *   - pages de chapitre `GET /chapters/<ULID>/images` (hôte d'images variable :
 *     aucun hôte codé en dur) ;
 *   - section d'accueil `Latest Updates` (`GET /latest-updates/<page>`) ;
 *   - User-Agent navigateur posé par un `SourceInterceptor` sur TOUTES les
 *     requêtes (mutation en place, identité du `Request` conservée) ;
 *   - erreurs 403 / 404 / autres / corps vide traduites explicitement, sans
 *     aucun contournement de protection.
 *
 * API Paperback 0.8 uniquement : Source / SourceInfo / SourceIntents /
 * RequestManager / SourceInterceptor / PagedResults / HomeSection.
 */

import {
  Chapter,
  ChapterDetails,
  ContentRating,
  HomeSection,
  HomeSectionType,
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
  chapterImagesUrl,
  chapterListUrl,
  emptyBodyError,
  errorMessageOf,
  HOME_SECTION_LATEST,
  httpStatusError,
  httpStatusFromError,
  isBlank,
  LANG_CODE,
  latestUpdatesUrl,
  mangaShareUrl,
  networkError,
  noPagesError,
  notFoundError,
  parseChapterImages,
  parseChapterList,
  parseLatestUpdates,
  parseSearchResults,
  parseSeriesDetails,
  SEARCH_PAGE_SIZE,
  seriesUrl,
  searchUrl,
  WeebCentralInterceptor,
} from "./Common";
import { WCChapterEntry, WCSeriesTile } from "./data-contracts";

export const WeebCentralInfo: SourceInfo = {
  version: "1.0.1",
  name: "WeebCentral",
  icon: "icon.png",
  author: "ATC's Extensions",
  description: "Source Paperback 0.8 pour weebcentral.com (lecture manga, anglais).",
  contentRating: ContentRating.EVERYONE,
  websiteBaseURL: BASE_URL,
  language: LANG_CODE,
  // MANGA_CHAPTERS : fiches, listes de chapitres et pages.
  // HOMEPAGE_SECTIONS : section « Latest Updates » (`getHomePageSections` /
  //   `getViewMoreItems`) — sans cet intent, rien ne serait affiché sur l'accueil.
  // `MANGA_TRACKING` reste VOLONTAIREMENT absent : il implique l'interface
  // `MangaProgressProviding` (`getMangaProgress`, `getMangaProgressManagementForm`,
  // `processChapterReadActionQueue`), absente de cette classe (incident
  // `t_810bda32` sur Bigsolo : erreurs JS à l'ouverture des fiches).
  intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS,
};

/** Interceptor public (implémentation pure dans `Common.ts`). */
export { WeebCentralInterceptor };

export class WeebCentral extends Source {
  requestManager: RequestManager = App.createRequestManager({
    interceptor: new WeebCentralInterceptor(),
    requestsPerSecond: 1,
    requestTimeout: 30000,
  });

  constructor(cheerio: CheerioAPI) {
    super(cheerio);
  }

  get baseUrl(): string {
    return BASE_URL;
  }

  /* ---------------------------------------------------------------- */
  /* Recherche                                                        */
  /* ---------------------------------------------------------------- */

  async getSearchResults(query: SearchRequest, metadata: unknown | undefined): Promise<PagedResults> {
    const offset = offsetOf(metadata);
    const title = typeof query?.title === "string" ? query.title : "";

    // Les tags (`includedTags` / `excludedTags`) ne sont PAS supportés : le
    // endpoint observé `/search/data` n'expose aucun paramètre de tag (seuls
    // les endpoints HTML `/search?included_tag=…` en ont) et mapper les tags
    // « au hasard » produirait des résultats faux. Voir le rapport.
    const html = await this.fetchHtml(searchUrl(title, offset));
    const page = parseSearchResults(html);

    return App.createPagedResults({
      results: page.items.map((tile) => this.toPartialSourceManga(tile)),
      metadata: page.hasMore ? { offset: offset + SEARCH_PAGE_SIZE } : undefined,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Accueil (intent HOMEPAGE_SECTIONS)                               */
  /* ---------------------------------------------------------------- */

  private toPartialSourceManga(tile: WCSeriesTile): PartialSourceManga {
    return App.createPartialSourceManga({
      mangaId: tile.mangaId,
      title: tile.title,
      image: tile.image,
    });
  }

  /**
   * Une seule section : « Latest Updates » (`/latest-updates/1`).
   * `/hot-series` a été écarté : mesuré le 2026-10-18, il renvoie 10 liens
   * SANS couverture (tuiles inexploitables). Une section vide n'est jamais
   * publiée : le harnais officiel rejette toute section sans items
   * (`section[x] has no items`).
   */
  async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
    const html = await this.fetchHtml(latestUpdatesUrl(1));
    const items = parseLatestUpdates(html);
    if (items.length === 0) return;

    sectionCallback(
      App.createHomeSection({
        id: HOME_SECTION_LATEST,
        title: "Latest Updates",
        type: HomeSectionType.singleRowNormal,
        items: items.map((tile) => this.toPartialSourceManga(tile)),
        containsMoreItems: true,
      }),
    );
  }

  /** « Voir plus » de « Latest Updates » : pages 1-indexées du site. */
  async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
    if (homepageSectionId !== HOME_SECTION_LATEST) {
      // Identifiant inconnu : aucune suite d'items, sans lever d'erreur.
      return App.createPagedResults({ results: [], metadata: undefined });
    }

    const requested = typeof metadata?.page === "number" && metadata.page > 0 ? metadata.page : 1;
    const page = Math.floor(requested);
    const html = await this.fetchHtml(latestUpdatesUrl(page));
    const items = parseLatestUpdates(html);

    return App.createPagedResults({
      results: items.map((tile) => this.toPartialSourceManga(tile)),
      metadata: items.length > 0 ? { page: page + 1 } : undefined,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Fiche manga                                                      */
  /* ---------------------------------------------------------------- */

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const html = await this.fetchHtml(seriesUrl(mangaId));
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

  async getChapters(mangaId: string): Promise<Chapter[]> {
    const html = await this.fetchHtml(chapterListUrl(mangaId));
    return parseChapterList(html).map((entry) => this.toChapter(entry));
  }

  private toChapter(entry: WCChapterEntry): Chapter {
    return App.createChapter({
      id: entry.chapterId,
      chapNum: entry.chapNum,
      name: entry.name,
      time: entry.time,
      langCode: LANG_CODE,
      sortingIndex: entry.chapNum,
    });
  }

  async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
    // `chapterId` est un ULID de chapitre : aucune conversion numérique, il est
    // transmis tel quel dans l'URL.
    const html = await this.fetchHtml(chapterImagesUrl(chapterId));
    const pages = parseChapterImages(html);
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
   * navigateur) et renvoie le corps HTML. `retry = 1` : au plus un nouvel
   * essai, jamais de rafale.
   *
   * Les statuts 403 / 404 / autres sont traduits explicitement en couvrant les
   * DEUX comportements possibles du runtime : exception de transport (le
   * runtime Node polyfillé lève via axios) OU réponse portant un statut
   * non-2xx. La simple présence du script `challenge-platform` n'est PAS un
   * signal de blocage (le HTML normal du site le contient, vérifié le
   * 2026-10-18) ; seul un corps vide est refusé.
   */
  private async fetchHtml(url: string): Promise<string> {
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
    if (isBlank(raw)) throw emptyBodyError(url);
    return raw;
  }
}

/** Décalage de pagination demandé par l'application (`offset` entier >= 0). */
function offsetOf(metadata: unknown): number {
  if (metadata === null || typeof metadata !== "object") return 0;
  const candidate = (metadata as { offset?: unknown }).offset;
  if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate <= 0) return 0;
  return Math.floor(candidate);
}
