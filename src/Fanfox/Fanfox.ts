/**
 * Fanfox — source Paperback 0.8 pour https://fanfox.net
 *
 * Couche données complète :
 *   - sections d'accueil `GET /releases/` (« Lastest Updates », 21 tuiles) et
 *     `GET /trending/` (« Trending Manga », 28 tuiles), publiées via l'intent
 *     `HOMEPAGE_SECTIONS` (aucune pagination côté site) ;
 *   - recherche paginée `GET /search?title=<q>&page=<n>` (HTML, 12 tuiles/page) ;
 *   - fiche série `GET /manga/<slug>/` (titre, couverture, statut, auteur, tags,
 *     synopsis COMPLET via `p.fullcontent`) ;
 *   - liste des chapitres : dans la MÊME page, union de `div#list-1` et
 *     `div#list-2` (`div#chapterlist`) — liste complète, aucune pagination ;
 *   - pages de chapitre : `GET /manga/<slug>/<chapterId>/1.html` (imagecount +
 *     clé `guidkey` déballée en pur), puis les appels
 *     `chapterfun.ashx?cid=…&page=<n>&key=…` (un par page) émis par vagues
 *     BORNÉES (5 en vol au maximum, `requestsPerSecond: 4`) ; l'URL d'image est
 *     reconstruite depuis `var pix` + `pvalue[0]` ⇒ aucun hôte CDN codé en dur,
 *     aucune déduction d'URL ;
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
  chapterFunUrl,
  chapterFunParseError,
  chapterReaderUrl,
  CHAPTER_PAGE_CONCURRENCY,
  emptyBodyError,
  emptyChapterFunError,
  errorMessageOf,
  FanfoxInterceptor,
  HOME_SECTION_LATEST,
  HOME_SECTION_TRENDING,
  httpStatusError,
  httpStatusFromError,
  isBlank,
  LANG_CODE,
  mangaShareUrl,
  mapWithConcurrency,
  missingChapterIdError,
  missingChapterKeyError,
  networkError,
  noPagesError,
  notFoundError,
  parseChapterImageResponse,
  parseChapterList,
  parseMangaList1Tiles,
  parseReaderMeta,
  parseReleaseTiles,
  parseSearchResults,
  parseSeriesDetails,
  releasesUrl,
  searchUrl,
  seriesUrl,
  trendingUrl,
} from "./Common";
import { FChapterEntry, FSeriesTile } from "./data-contracts";

export const FanfoxInfo: SourceInfo = {
  version: "1.0.6",
  name: "Fanfox",
  icon: "icon.png",
  author: "bigsolo-paperback08",
  description: "Source Paperback 0.8 pour fanfox.net (lecture manga, anglais).",
  contentRating: ContentRating.EVERYONE,
  websiteBaseURL: BASE_URL,
  language: LANG_CODE,
  // `MANGA_CHAPTERS` : fiches, listes de chapitres et pages de chapitre.
  // `HOMEPAGE_SECTIONS` : la source publie deux sections d'accueil
  //   (`getHomePageSections` / `getViewMoreItems`, cf. plus bas). Sans cet
  //   intent, l'application n'appelait jamais la méthode d'accueil : Fanfox
  //   n'apparaissait donc PAS sur l'écran d'accueil.
  // `MANGA_TRACKING` reste VOLONTAIREMENT absent, et ne doit PAS être ajouté :
  //   il implique l'interface `MangaProgressProviding` (`getMangaProgress`,
  //   `getMangaProgressManagementForm`, `processChapterReadActionQueue`), qui
  //   n'est pas implémentée ici ⇒ erreurs JavaScript à l'ouverture des fiches
  //   manga et des chapitres dans l'application (incident `t_810bda32`).
  intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS,
};

/** Interceptor public (implémentation pure dans `Common.ts`). */
export { FanfoxInterceptor };

export class Fanfox extends Source {
  requestManager: RequestManager = App.createRequestManager({
    interceptor: new FanfoxInterceptor(),
    // 4 req/s (au lieu de 1) : reste MODÉRÉ et documenté. C'est la seule valeur
    // augmentée ; combinée à `CHAPTER_PAGE_CONCURRENCY` (5 requêtes en vol au
    // maximum, jamais une rafale non bornée), elle ramène l'ouverture d'un
    // chapitre de `1 + imagecount` SECONDES à `(1 + imagecount) / 4` secondes,
    // sans changer les URLs produites.
    requestsPerSecond: 4,
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
  /* Accueil (intent HOMEPAGE_SECTIONS)                               */
  /* ---------------------------------------------------------------- */

  /**
   * Sections de l'écran d'accueil, construites depuis DEUX pages PUBLIQUES
   * mesurées le 2026-10-18 (aucune donnée inventée, aucun contournement) :
   *   • `/releases/` — « Lastest Updates » du site (21 tuiles `manga-list-4`) ;
   *   • `/trending/` — « Trending Manga » (28 tuiles `manga-list-1`).
   *
   * Aucune de ces deux pages n'est paginée : mesuré, `/releases/?page=2`
   * renvoie EXACTEMENT la même liste que `/releases/`. Les sections sont donc
   * publiées avec `containsMoreItems: false` et `getViewMoreItems` ne renvoie
   * jamais d'items supplémentaires (voir plus bas).
   *
   * Robustesse : une page en échec (réseau, statut, corps vide, structure
   * changée) n'invalide pas l'autre section ; elle est simplement non publiée.
   * Une section VIDE n'est jamais transmise à l'application (le harnais officiel
   * rejette `section[x] has no items`). Si AUCUNE section ne peut être
   * construite, une erreur explicite est levée — avec les deux URLs et les
   * motifs d'échec — plutôt que d'afficher un accueil silencieusement vide.
   *
   * IMPORTANT (règle native) : sections et items sont construits par les
   * fabriques du runtime (`App.createHomeSection`, `App.createPartialSourceManga`).
   * Aucun objet JavaScript brut n'est transmis à une API native.
   */
  async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
    const problems: string[] = [];

    const latest = await this.homeTiles(releasesUrl(), parseReleaseTiles, problems);
    if (latest.length > 0) {
      sectionCallback(
        App.createHomeSection({
          id: HOME_SECTION_LATEST,
          title: "Dernières sorties",
          type: HomeSectionType.singleRowNormal,
          items: latest.map((tile) => this.toPartialSourceManga(tile)),
          containsMoreItems: false,
        }),
      );
    }

    const trending = await this.homeTiles(trendingUrl(), parseMangaList1Tiles, problems);
    if (trending.length > 0) {
      sectionCallback(
        App.createHomeSection({
          id: HOME_SECTION_TRENDING,
          title: "Tendances",
          type: HomeSectionType.singleRowLarge,
          items: trending.map((tile) => this.toPartialSourceManga(tile)),
          containsMoreItems: false,
        }),
      );
    }

    if (latest.length === 0 && trending.length === 0) {
      throw new Error(
        `Fanfox : aucune section d'accueil n'a pu être construite (${problems.join(" | ")}).`,
      );
    }
  }

  /**
   * « Voir plus » d'une section d'accueil.
   *
   * Le site n'offre AUCUNE pagination sur les pages exploitées (`/releases/`,
   * `/trending/`) : les sections sont donc publiées avec
   * `containsMoreItems: false` et il n'existe pas de page suivante à renvoyer.
   * On répond une liste vide SANS lever d'erreur (ni pour un identifiant de
   * section inconnu) : aucune boucle de pagination ne peut s'installer.
   */
  async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
    void homepageSectionId;
    void metadata;
    return App.createPagedResults({ results: [], metadata: undefined });
  }

  /**
   * Tuiles d'une page publique destinée à l'accueil. Un échec est consigné dans
   * `problems` et traité comme une liste vide : les autres sections restent
   * publiées (aucune exception ne remonte à l'application pour une seule page
   * indisponible).
   */
  private async homeTiles(
    url: string,
    parse: (html: string) => FSeriesTile[],
    problems: string[],
  ): Promise<FSeriesTile[]> {
    try {
      const html = await this.fetchText(url, emptyBodyError);
      return parse(html);
    } catch (error) {
      problems.push(`${url} : ${errorMessageOf(error)}`);
      return [];
    }
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
   *   2. appels `chapterfun.ashx?cid=<chapterid>&page=<n>&key=<guidkey>` pour
   *      `n = 1..imagecount`, émis par VAGUES BORNÉES
   *      (`CHAPTER_PAGE_CONCURRENCY` en vol au maximum), puis `pvalue[0]` +
   *      `var pix` ⇒ URL absolue.
   *
   * PERFORMANCE (mesuré le 2026-10-18) : le coût était de `1 + imagecount`
   * requêtes SÉQUENTIELLES, donc `1 + imagecount` intervalles de débit — 18 172 ms
   * pour 18 pages et 46 225 ms pour 46 pages à `requestsPerSecond: 1`. Les
   * résultats sont désormais replacés PAR INDEX de page (jamais dans l'ordre
   * d'arrivée) : la liste produite est identique, dans le même ordre, à celle de
   * la boucle séquentielle (comparaison de listes, `.mgrf/perf/compare.js`).
   *
   * LIMITE CONNUE — un appel PAR PAGE reste la règle : mesuré le 2026-10-18 sur
   * `one_piece/vTBE/c1196` (18 p.) et `bleach/v00/c000` (46 p.), `pvalue[1]`
   * correspondait à la page suivante dans les 62 couples vérifiables
   * (`.mgrf/perf/probe-pairs.js`). La piste « demi-requêtes + rattrapage »
   * (appeler les seules pages impaires) n'est PAS retenue pour autant : la
   * preuve ne porte que sur 2 chapitres, un désaccord éventuel serait SILENCIEUX
   * (URL valide désignant la mauvaise page) et l'objectif de performance est
   * déjà atteint sans elle. AUCUNE reconstruction ni déduction d'URL n'est
   * faite : la numérotation des fichiers du CDN n'est pas contiguë (mesuré :
   * `d017.jpg` → `d037.jpg` en fin de `vTBE/c1196`, `m45.jpg` → `ma5.jpg` en fin
   * de `v00/c000`).
   */
  async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
    const readerUrl = chapterReaderUrl(mangaId, chapterId, 1);
    const readerHtml = await this.fetchText(readerUrl, emptyBodyError);
    const meta = parseReaderMeta(readerHtml);

    if (meta.imageCount <= 0) throw noPagesError(chapterId);
    if (meta.chapterNumericId.length === 0) throw missingChapterIdError(chapterId, readerUrl);
    if (meta.guidKey.length === 0) throw missingChapterKeyError(chapterId, readerUrl);

    const pages = await mapWithConcurrency(
      meta.imageCount,
      CHAPTER_PAGE_CONCURRENCY,
      async (index) => {
        const page = index + 1;
        const url = chapterFunUrl(mangaId, chapterId, meta.chapterNumericId, page, meta.guidKey);
        // Un corps vide n'est PAS un chapitre vide : erreur explicite (Referer).
        const body = await this.fetchText(url, (target) => emptyChapterFunError(target, page));
        const image = parseChapterImageResponse(body);
        if (image.url.length === 0) throw chapterFunParseError(chapterId, page, url);
        return image.url;
      },
    );

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
