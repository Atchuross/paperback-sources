/**
 * AsuraScans — source Paperback 0.8 pour https://asurascans.com
 *
 * Implémentation API-first : TOUTES les données viennent de
 * `https://api.asurascans.com` (JSON). Aucun parsing HTML, aucun `cheerio` :
 *   - recherche paginée `GET /api/series?search=<q>&limit=20&offset=<O>` ;
 *   - sections d'accueil `GET /api/series?limit=20&sort=trending|popular|latest` ;
 *   - fiche série `GET /api/series/<slug>` ;
 *   - liste des chapitres `GET /api/series/<slug>/chapters` ;
 *   - pages de chapitre `GET /api/series/<slug>/chapters/<numéro>`.
 *
 * Identifiants :
 *   - `mangaId` = SLUG NU de la série (`solo-leveling`) — accepté par toutes les
 *     routes API, avec ou sans le suffixe public `-f212c582` ;
 *   - `chapterId` = NUMÉRO de chapitre en chaîne, entier OU décimal pointé
 *     (`"10"`, `"0"`, `"100.5"`) — l'API est indexée par numéro, pas par
 *     identifiant, et publie aussi des numéros décimaux (mesuré).
 *
 * Chapitres premium / accès anticipé : détectés (`is_premium`, `is_locked`,
 * `pages` vide) et signalés par une erreur explicite avec la date d'ouverture.
 * Aucune page inventée, aucune authentification, aucun contournement de
 * Cloudflare.
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
  AsuraScansInterceptor,
  chapterListUrl,
  chapterNotFoundError,
  chapterPagesUrl,
  emptyChapterListError,
  errorMessageOf,
  HOME_SECTIONS,
  homeSectionUrl,
  httpStatusError,
  httpStatusFromError,
  isNotFoundError,
  LANG_CODE,
  mangaShareUrl,
  networkError,
  notFoundError,
  parseJsonBody,
  rejectApiError,
  safeOffset,
  sanitizeChapterId,
  sanitizeMangaId,
  searchUrl,
  seriesNotFoundError,
  seriesUrl,
  SITE_BASE_URL,
  sortForSection,
  toChapterEntries,
  toChapterPages,
  toSearchPage,
  toSeriesDetails,
} from "./Common";
import { AsuraChapterEntry, AsuraSeriesTile } from "./data-contracts";

export const AsuraScansInfo: SourceInfo = {
  version: "1.0.0",
  name: "AsuraScans",
  icon: "icon.png",
  author: "ATC's Extensions",
  description:
    "Source Paperback 0.8 pour asurascans.com (manhwa en anglais) : API JSON officielle du site, recherche, fiches, chapitres et sections d'accueil.",
  // `EVERYONE` : comme les autres sources du dépôt. Un classement plus restrictif
  // masquerait la source aux profils sans réglage de visibilité.
  contentRating: ContentRating.EVERYONE,
  websiteBaseURL: SITE_BASE_URL,
  language: LANG_CODE,
  // MANGA_CHAPTERS : fiches, listes de chapitres et pages.
  // HOMEPAGE_SECTIONS : « Trending », « Popular », « Latest Updates »
  //   (`getHomePageSections` / `getViewMoreItems`) — sans cet intent, rien ne
  //   serait affiché sur l'accueil de l'application.
  // `MANGA_TRACKING` reste VOLONTAIREMENT absent : il implique l'interface
  // `MangaProgressProviding`, absente de cette classe (incident `t_810bda32`
  // sur Bigsolo : erreurs JS à l'ouverture des fiches).
  intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS,
};

/** Interceptor public (implémentation pure dans `Common.ts`). */
export { AsuraScansInterceptor };

export class AsuraScans extends Source {
  requestManager: RequestManager = App.createRequestManager({
    interceptor: new AsuraScansInterceptor(),
    requestsPerSecond: 1,
    requestTimeout: 30000,
  });

  constructor(cheerio: CheerioAPI) {
    super(cheerio);
  }

  get baseUrl(): string {
    return SITE_BASE_URL;
  }

  /* ---------------------------------------------------------------- */
  /* Recherche                                                        */
  /* ---------------------------------------------------------------- */

  async getSearchResults(query: SearchRequest, metadata: unknown | undefined): Promise<PagedResults> {
    const offset = offsetOf(metadata);
    const title = typeof query?.title === "string" ? query.title : "";

    // Les tags (`includedTags` / `excludedTags`) ne sont PAS supportés : l'API
    // `GET /api/series` n'expose aucun filtre de genre mesurable et mapper les
    // tags « au hasard » produirait des résultats faux.
    const payload = await this.fetchJson(searchUrl(title, offset));
    const page = toSearchPage(payload, offset);

    return App.createPagedResults({
      results: page.items.map((tile) => this.toPartialSourceManga(tile)),
      metadata: page.nextOffset === undefined ? undefined : { offset: page.nextOffset },
    });
  }

  /* ---------------------------------------------------------------- */
  /* Accueil (intent HOMEPAGE_SECTIONS)                               */
  /* ---------------------------------------------------------------- */

  private toPartialSourceManga(tile: AsuraSeriesTile): PartialSourceManga {
    return App.createPartialSourceManga({
      mangaId: tile.mangaId,
      title: tile.title,
      image: tile.image,
    });
  }

  /**
   * Trois sections issues du tri de l'API (contenus distincts, mesurés).
   * Une section vide n'est JAMAIS publiée : le harnais officiel rejette toute
   * section sans items (`section[x] has no items`).
   */
  async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
    for (const section of HOME_SECTIONS) {
      const payload = await this.fetchJson(homeSectionUrl(section.sort, 0));
      const page = toSearchPage(payload, 0);
      if (page.items.length === 0) continue;

      sectionCallback(
        App.createHomeSection({
          id: section.id,
          title: section.title,
          type: HomeSectionType.singleRowNormal,
          items: page.items.map((tile) => this.toPartialSourceManga(tile)),
          containsMoreItems: page.nextOffset !== undefined,
        }),
      );
    }
  }

  /** « Voir plus » d'une section : même tri, pagination `limit`/`offset`. */
  async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
    const sort = sortForSection(homepageSectionId);
    if (!sort) {
      // Identifiant inconnu : aucune suite d'items, sans lever d'erreur.
      return App.createPagedResults({ results: [], metadata: undefined });
    }

    const offset = offsetOf(metadata);
    const payload = await this.fetchJson(homeSectionUrl(sort, offset));
    const page = toSearchPage(payload, offset);

    return App.createPagedResults({
      results: page.items.map((tile) => this.toPartialSourceManga(tile)),
      metadata: page.nextOffset === undefined ? undefined : { offset: page.nextOffset },
    });
  }

  /* ---------------------------------------------------------------- */
  /* Fiche manga                                                      */
  /* ---------------------------------------------------------------- */

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const slug = sanitizeMangaId(mangaId);

    let payload: unknown;
    try {
      payload = await this.fetchJson(seriesUrl(slug));
    } catch (error) {
      if (isNotFoundError(error)) throw seriesNotFoundError(slug);
      throw error;
    }

    const details = toSeriesDetails(payload, slug);

    const tagSections: TagSection[] =
      details.tags.length > 0
        ? [
            App.createTagSection({
              id: "genres",
              label: "Genres",
              tags: details.tags.map((tag) => ({ id: tag, label: tag })),
            }),
          ]
        : [];

    const additionalInfo: Record<string, string> = {};
    if (details.type.length > 0) additionalInfo["Type"] = details.type;
    if (details.rating !== undefined) additionalInfo["Note"] = `${details.rating.toFixed(2)}/10`;

    return App.createSourceManga({
      id: mangaId,
      mangaInfo: App.createMangaInfo({
        image: details.image,
        titles: details.titles,
        desc: details.description,
        status: details.status,
        author: details.author,
        artist: details.artist,
        tags: tagSections,
        covers: details.image.length > 0 ? [details.image] : [],
        ...(Object.keys(additionalInfo).length > 0 ? { additionalInfo } : {}),
      }),
    });
  }

  getMangaShareUrl(mangaId: string): string {
    try {
      return mangaShareUrl(mangaId);
    } catch {
      // Identifiant inexploitable : on renvoie au moins le site, jamais une URL cassée.
      return SITE_BASE_URL;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Chapitres                                                        */
  /* ---------------------------------------------------------------- */

  async getChapters(mangaId: string): Promise<Chapter[]> {
    const slug = sanitizeMangaId(mangaId);
    const payload = await this.fetchJson(chapterListUrl(slug));
    const entries = toChapterEntries(payload);

    if (entries.length === 0) {
      // MESURÉ : un slug INCONNU renvoie 200 `{"data":[]}` sur `/chapters`
      // (pas 404). On tranche par la fiche série avant de conclure.
      try {
        await this.fetchJson(seriesUrl(slug));
      } catch (error) {
        if (isNotFoundError(error)) throw seriesNotFoundError(slug);
        throw error;
      }
      throw emptyChapterListError(slug);
    }

    return entries.map((entry) => this.toChapter(entry));
  }

  private toChapter(entry: AsuraChapterEntry): Chapter {
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
    const slug = sanitizeMangaId(mangaId);
    const chapter = sanitizeChapterId(chapterId);

    let payload: unknown;
    try {
      payload = await this.fetchJson(chapterPagesUrl(slug, chapter));
    } catch (error) {
      if (isNotFoundError(error)) throw chapterNotFoundError(slug, chapter);
      throw error;
    }

    const pages = toChapterPages(payload, slug, chapter);

    return App.createChapterDetails({
      id: chapter,
      mangaId,
      pages,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Couche requêtes / erreurs                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Émet une requête GET via le `RequestManager` (donc avec les en-têtes
   * navigateur de l'interceptor) et renvoie la charge JSON.
   *
   * Les statuts 403 / 404 / autres sont traduits explicitement en couvrant les
   * DEUX comportements possibles du runtime : exception de transport (le runtime
   * Node polyfillé lève via axios) OU réponse portant un statut non-2xx.
   * `response.data` peut arriver en chaîne OU déjà parsé : `parseJsonBody`
   * accepte les deux.
   */
  private async fetchJson(url: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.requestManager.schedule(App.createRequest({ url, method: "GET" }), 1);
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

    const payload = parseJsonBody(response.data, url);
    rejectApiError(payload, url);
    return payload;
  }
}

/** Décalage de pagination demandé par l'application (`offset` entier >= 0). */
function offsetOf(metadata: unknown): number {
  if (metadata === null || typeof metadata !== "object") return 0;
  return safeOffset((metadata as { offset?: unknown }).offset);
}
