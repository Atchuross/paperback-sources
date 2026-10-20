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
  allSeries,
  BASE_URL,
  BigsoloInterceptor,
  buildSubtitle,
  buildTagSections,
  catalogUrl,
  chapterGroup,
  chapterNumber,
  chapterPagesUrl,
  cloudflareError,
  compareChapterIds,
  errorMessageOf,
  getChapterEntry,
  hasChapter,
  HOME_SECTION_LATEST,
  HOME_SECTION_RECO,
  httpStatusError,
  httpStatusFromError,
  isLicensedChapter,
  isLicensedPages,
  LANG_CODE,
  licensedError,
  mangaShareUrl,
  matchesQuery,
  matchesTags,
  networkError,
  notFoundError,
  noPagesError,
  pageSlice,
  parseJson,
  pickCoverImage,
  pickCoverList,
  recoSeries,
  seriesTitles,
  sortByLastUpdate,
  timestampDate,
  usablePages,
  volumeNumber,
} from "./Common";
import { BigsoloCatalog, BigsoloChapterPages, BigsoloSeriesItem } from "./data-contracts";

/**
 * Bigsolo — source Paperback 0.8 pour https://bigsolo.org
 *
 * Couche données complète (phase 2, tâche (b)+(c)) :
 *   - catalogue `/data/series` (mis en cache mémoire, une requête par instance) ;
 *   - recherche / filtres 100 % côté client (le site ne pagine pas) ;
 *   - fiche manga, liste des chapitres (clés littérales, décimales incluses) ;
 *   - pages de chapitre via `/data/series/{slug}/{chapitre}` ;
 *   - User-Agent navigateur posé par un `SourceInterceptor` sur TOUTES les requêtes ;
 *   - gestion explicite des erreurs 403 (Cloudflare) / 404 / autres, sans aucun
 *     contournement de protection.
 *
 * API Paperback 0.8 uniquement : Source / SourceInfo / RequestManager /
 * SourceInterceptor / PagedResults. Aucun symbole de l'API 0.9.
 */
export const BigsoloInfo: SourceInfo = {
  // Dépôt NEUF (2026-10-18) : contenu identique à la Bigsolo validée, numéro
  // incrémenté pour que l'application l'installe comme une source neuve.
  version: "0.2.2",
  name: "Bigsolo",
  icon: "icon.png",
  author: "ATC's Extensions",
  description: "Source Paperback 0.8 pour bigsolo.org (MVP phase 2).",
  contentRating: ContentRating.EVERYONE,
  websiteBaseURL: BASE_URL,
  language: LANG_CODE,
  // MANGA_CHAPTERS : fiches, listes de chapitres et pages.
  // HOMEPAGE_SECTIONS : la source publie des sections d'accueil
  //   (`getHomePageSections` / `getViewMoreItems`) ; sans cet intent,
  //   l'application n'affichait rien pour Bigsolo sur l'écran d'accueil.
  // `MANGA_TRACKING` reste VOLONTAIREMENT absent : il implique l'interface
  // `MangaProgressProviding` (`getMangaProgress`,
  // `getMangaProgressManagementForm`, `processChapterReadActionQueue`),
  // absente de la classe `Bigsolo` : déclarer cet intent faisait appeler par
  // l'application des méthodes inexistantes → erreur JavaScript à l'ouverture
  // d'une fiche manga / d'un chapitre.
  intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS,
};

/**
 * Interceptor qui pose le User-Agent navigateur sur chaque requête.
 *
 * Implémentation PURE extraite dans `Common.ts` (`BigsoloInterceptor`) afin
 * d'être testable hors runtime Paperback : ce module ne fait que l'instancier.
 */
export { BigsoloInterceptor };

export class Bigsolo extends Source {
  requestManager: RequestManager = App.createRequestManager({
    interceptor: new BigsoloInterceptor(),
    requestsPerSecond: 1,
    requestTimeout: 30000,
  });

  /** Cache mémoire du catalogue : une seule requête `/data/series` par instance. */
  private catalog?: BigsoloCatalog;
  private catalogRequest?: Promise<BigsoloCatalog>;

  constructor(cheerio: CheerioAPI) {
    super(cheerio);
  }

  get baseUrl(): string {
    return BASE_URL;
  }

  /* ---------------------------------------------------------------- */
  /* Catalogue / recherche                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Catalogue complet, mis en cache en mémoire. Le `Promise` partagé garantit
   * qu'une seule requête réseau est émise même si plusieurs appels concurrents
   * arrivent avant que la première ne se termine.
   */
  private async getCatalog(): Promise<BigsoloCatalog> {
    if (this.catalog) return this.catalog;
    if (!this.catalogRequest) {
      this.catalogRequest = this.fetchJson<BigsoloCatalog>(catalogUrl()).then((catalog) => {
        this.catalog = catalog;
        return catalog;
      });
    }
    return this.catalogRequest;
  }

  /** Retrouve l'item de catalogue correspondant au slug (= `mangaId`). */
  private async findSeries(mangaId: string): Promise<BigsoloSeriesItem> {
    const catalog = await this.getCatalog();
    const item = allSeries(catalog).find((candidate) => candidate.slug === mangaId);
    if (!item) throw notFoundError(`la série « ${mangaId} »`);
    return item;
  }

  async getSearchResults(query: SearchRequest, metadata: unknown | undefined): Promise<PagedResults> {
    void metadata;
    const catalog = await this.getCatalog();
    const items = allSeries(catalog);

    const includedTags = (query?.includedTags ?? []).map((tag) => tag.id);
    const excludedTags = (query?.excludedTags ?? []).map((tag) => tag.id);
    const title = query?.title;

    const results = items
      .filter((item) => matchesQuery(item, title))
      .filter((item) => matchesTags(item, includedTags, excludedTags))
      .map((item) => this.toPartialSourceManga(item));

    // Le site ne pagine pas : tout le catalogue est filtré côté client.
    return App.createPagedResults({ results, metadata: undefined });
  }

  /* ---------------------------------------------------------------- */
  /* Accueil (intent HOMEPAGE_SECTIONS)                               */
  /* ---------------------------------------------------------------- */

  /**
   * Tuile de liste (`PartialSourceManga`), partagée par la recherche et les
   * sections d'accueil.
   */
  private toPartialSourceManga(item: BigsoloSeriesItem): PartialSourceManga {
    return App.createPartialSourceManga({
      mangaId: item.slug,
      title: item.title ?? item.slug,
      image: pickCoverImage(item),
      subtitle: buildSubtitle(item),
    });
  }

  /**
   * Sections de l'écran d'accueil (intent `HOMEPAGE_SECTIONS`).
   *
   * Elles sont construites à partir du catalogue DÉJÀ EN CACHE
   * (`/data/series`, une seule requête par instance) : aucune requête
   * supplémentaire n'est émise pour l'accueil.
   *
   * Une section vide n'est jamais transmise à l'application : le harnais
   * officiel rejette toute section sans items (`section[x] has no items`).
   */
  async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
    const catalog = await this.getCatalog();

    const latest = sortByLastUpdate(allSeries(catalog));
    if (latest.length > 0) {
      const firstPage = pageSlice(latest, 0);
      sectionCallback(
        App.createHomeSection({
          id: HOME_SECTION_LATEST,
          title: "Dernières mises à jour",
          type: HomeSectionType.singleRowNormal,
          items: firstPage.items.map((item) => this.toPartialSourceManga(item)),
          containsMoreItems: firstPage.nextPage !== undefined,
        }),
      );
    }

    const reco = recoSeries(catalog);
    if (reco.length > 0) {
      sectionCallback(
        App.createHomeSection({
          id: HOME_SECTION_RECO,
          title: "Recommandations",
          type: HomeSectionType.singleRowLarge,
          items: reco.map((item) => this.toPartialSourceManga(item)),
          containsMoreItems: false,
        }),
      );
    }
  }

  /**
   * « Voir plus » d'une section d'accueil : pages suivantes de
   * `HOME_SECTION_LATEST`, toujours depuis le catalogue en cache.
   *
   * `metadata` est initialement `null` (l'interface `getHomePageSections`
   * renvoie `void`) : la première demande porte donc sur la page 1, puis la
   * pagination se poursuit avec la valeur que l'on renvoie ici.
   */
  async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
    if (homepageSectionId !== HOME_SECTION_LATEST) {
      // Section non paginée (« Recommandations ») ou identifiant inconnu :
      // aucune suite d'items, sans lever d'erreur.
      return App.createPagedResults({ results: [], metadata: undefined });
    }

    const catalog = await this.getCatalog();
    const latest = sortByLastUpdate(allSeries(catalog));
    const requestedPage = typeof metadata?.page === "number" ? metadata.page : 1;
    const page = pageSlice(latest, requestedPage);

    return App.createPagedResults({
      results: page.items.map((item) => this.toPartialSourceManga(item)),
      metadata: page.nextPage !== undefined ? { page: page.nextPage } : undefined,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Fiche manga                                                      */
  /* ---------------------------------------------------------------- */

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const item = await this.findSeries(mangaId);
    const tagSections: TagSection[] = buildTagSections(item).map((section) =>
      App.createTagSection(section),
    );

    return App.createSourceManga({
      id: mangaId,
      mangaInfo: App.createMangaInfo({
        image: pickCoverImage(item),
        titles: seriesTitles(item).length > 0 ? seriesTitles(item) : [mangaId],
        desc: item.description ?? "",
        status: item.status ?? "",
        author: item.author ?? "",
        artist: item.artist ?? "",
        tags: tagSections,
        covers: pickCoverList(item),
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
    const item = await this.findSeries(mangaId);
    const chapters = item.chapters ?? {};

    return Object.keys(chapters)
      .sort(compareChapterIds)
      .map((chapterId) => {
        const entry = chapters[chapterId] ?? {};
        return App.createChapter({
          id: chapterId,
          chapNum: chapterNumber(chapterId),
          name: entry.title ?? chapterId,
          volume: volumeNumber(entry.volume),
          group: chapterGroup(entry.teams),
          time: timestampDate(entry.timestamp),
          langCode: LANG_CODE,
          sortingIndex: chapterNumber(chapterId),
        });
      });
  }

  async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
    const item = await this.findSeries(mangaId);

    // Chapitre marqué `licensed` dans la fiche : on refuse explicitement,
    // sans jamais simuler une lecture.
    if (hasChapter(item, chapterId) && isLicensedChapter(getChapterEntry(item, chapterId))) {
      throw licensedError(chapterId);
    }

    const pagesData = await this.fetchJson<BigsoloChapterPages>(chapterPagesUrl(mangaId, chapterId));

    // Le endpoint lui-même peut signaler un chapitre sous licence.
    if (isLicensedPages(pagesData)) throw licensedError(chapterId);

    const pages = usablePages(pagesData);
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
   * Émet une requête GET (via le RequestManager, donc avec le User-Agent
   * navigateur) et renvoie le JSON parsé. `retry = 1` : au plus un nouvel
   * essai, jamais de rafale.
   *
   * Les statuts 403 / 404 / autres sont traduits en erreurs explicites, en
   * couvrant les deux comportements possibles du runtime : une exception de
   * transport (le runtime Node polyfillé lève via axios) OU une réponse
   * portant un statut non-2xx. Aucun contournement de protection.
   */
  private async fetchJson<T>(url: string): Promise<T> {
    let response: Response;
    try {
      response = await this.requestManager.schedule(
        App.createRequest({ url, method: "GET" }),
        1,
      );
    } catch (error) {
      const status = httpStatusFromError(error);
      if (status === 403) throw cloudflareError(url);
      if (status === 404) throw notFoundError(url);
      if (typeof status === "number" && status > 0) throw httpStatusError(status, url);
      throw networkError(errorMessageOf(error), url);
    }

    if (response.status === 403) throw cloudflareError(url);
    if (response.status === 404) throw notFoundError(url);
    if (response.status < 200 || response.status >= 300) {
      throw httpStatusError(response.status, url);
    }

    const raw = typeof response.data === "string" ? response.data : "";
    return parseJson<T>(raw, url);
  }
}
