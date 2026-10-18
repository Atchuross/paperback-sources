/**
 * Bigsolo — helpers purs (Common).
 *
 * RÈGLE ABSOLUE : ce fichier ne référence JAMAIS le global `App` du runtime
 * Paperback. Il n'importe que les contrats de données, ce qui le rend
 * compilable et testable hors application (tests unitaires de la phase
 * suivante). Toute construction d'objet Paperback (`App.createXxx`) vit dans
 * `Bigsolo.ts`.
 */

import {
  BigsoloChapterEntry,
  BigsoloChapterPages,
  BigsoloCatalog,
  BigsoloSeriesItem,
} from "./data-contracts";

// Import de TYPES uniquement (`import type`) : il est entièrement effacé à la
// compilation, donc `Common.js` n'a AUCUNE dépendance runtime sur
// `@paperback/types` et reste importable/testable en Node pur.
import type { Request, Response, SourceInterceptor } from "@paperback/types";

/* ------------------------------------------------------------------ */
/* Constantes d'accès au site                                          */
/* ------------------------------------------------------------------ */

/** URL de base du site (les endpoints de données vivent sur le même hôte). */
export const BASE_URL = "https://bigsolo.org";

/** Catalogue complet : `GET /data/series` (≈721 Ko, aucune pagination). */
export const CATALOG_PATH = "/data/series";

/** Préfixe du CDN d'images (URLs absolues à utiliser telles quelles). */
export const CDN_IMAGE_PREFIX = "https://cdnic.bigsolo.org/files/";

/** Le site publie des traductions françaises. */
export const LANG_CODE = "fr";

/**
 * User-Agent navigateur OBLIGATOIRE : Cloudflare renvoie 403 pour toute
 * requête sans UA navigateur (fait vérifié en phase 1). On ne contourne rien,
 * on se contente de nous présenter comme le navigateur que nous sommes.
 */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * Clé canonique de l'en-tête (casse HTTP standard, telle qu'attendue par les
 * tests et lisible dans les journaux/outils).
 */
export const USER_AGENT_HEADER = "User-Agent";

/**
 * Clé minuscule : le runtime Paperback lit `headers["user-agent"]` pour
 * décider s'il doit injecter son User-Agent par défaut. On pose donc la même
 * valeur sous les deux casses afin qu'aucun agent générique ne vienne écraser
 * le nôtre (valeurs identiques -> aucun en-tête en double réel).
 */
export const USER_AGENT_HEADER_LOWER = "user-agent";

/**
 * Interceptor pur qui pose le User-Agent navigateur sur chaque requête.
 *
 * Cloudflare renvoie un HTTP 403 pour toute requête sans User-Agent
 * navigateur (fait vérifié en phase 1). On ne contourne rien : on se présente
 * simplement comme un navigateur, comme le fait le site lui-même.
 *
 * Volontairement sans référence au global `App` : ce helper est compilable et
 * testable hors application (voir `tests/run-tests.mjs`).
 */
export class BigsoloInterceptor implements SourceInterceptor {
  async interceptRequest(request: Request): Promise<Request> {
    // CORRECTIF D1/D2 — l'application valide le TYPE DE RETOUR de
    // `interceptRequest` : renvoyer une copie (`{ ...request, headers }`) fait
    // lever `MethodInvalidReturnTypeError [PaperbackError(303)]` … « JavaScript
    // method interceptRequest has an invalid return type » à CHAQUE requête
    // (recherche et chargement de page). On mute donc `request.headers` en
    // place et on renvoie le MÊME objet `Request` (aucun champ perdu : `url`,
    // `method`, `data`, `param`, `cookies` voyagent tels quels).
    const headers: Record<string, string> = request.headers ?? {};
    headers[USER_AGENT_HEADER] = BROWSER_USER_AGENT;
    headers[USER_AGENT_HEADER_LOWER] = BROWSER_USER_AGENT;
    request.headers = headers;
    return request;
  }

  async interceptResponse(response: Response): Promise<Response> {
    // Même exigence d'identité côté réponse : on renvoie l'objet reçu.
    return response;
  }
}

/** URL du catalogue complet. */
export function catalogUrl(): string {
  return `${BASE_URL}${CATALOG_PATH}`;
}

/**
 * URL des pages d'un chapitre. `mangaId` est le slug brut et `chapterId` la
 * clé littérale du chapitre : on ne convertit JAMAIS la clé en entier
 * (les clés décimales comme "127.5" doivent rester intactes dans l'URL).
 */
export function chapterPagesUrl(mangaId: string, chapterId: string): string {
  return `${BASE_URL}${CATALOG_PATH}/${encodeURIComponent(mangaId)}/${encodeURIComponent(chapterId)}`;
}

/** URL de partage web d'une fiche série. */
export function mangaShareUrl(mangaId: string): string {
  return `${BASE_URL}/manga/${encodeURIComponent(mangaId)}`;
}

/* ------------------------------------------------------------------ */
/* Normalisation / recherche                                           */
/* ------------------------------------------------------------------ */

/**
 * Normalise une chaîne pour la comparaison : minuscules, sans accents,
 * espaces réduits. Renvoie "" pour toute valeur non textuelle.
 */
export function normalize(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** Tous les titres exploitables d'une série (title, ja_title, alternatives). */
export function seriesTitles(item: BigsoloSeriesItem): string[] {
  const titles: string[] = [];
  pushNonEmpty(titles, item.title);
  pushNonEmpty(titles, item.ja_title);
  for (const alt of item.alternative_titles ?? []) pushNonEmpty(titles, alt);
  return titles;
}

/**
 * Vrai si la série correspond à la requête de titre. Le site filtre côté
 * client sur `title`, `ja_title` et `alternative_titles` (insensible à la
 * casse/accents) — on reproduit exactement ce comportement.
 */
export function matchesQuery(item: BigsoloSeriesItem, query: unknown): boolean {
  const needle = normalize(query);
  if (needle.length === 0) return true;
  return seriesTitles(item).some((title) => normalize(title).includes(needle));
}

/**
 * Vrai si la série satisfait les filtres de tags : tous les tags inclus
 * doivent être présents, aucun tag exclu ne doit être présent.
 */
export function matchesTags(
  item: BigsoloSeriesItem,
  includedTags: string[],
  excludedTags: string[],
): boolean {
  const tags = (item.tags ?? []).map((tag) => normalize(tag));
  const included = includedTags.map((tag) => normalize(tag)).filter((tag) => tag.length > 0);
  const excluded = excludedTags.map((tag) => normalize(tag)).filter((tag) => tag.length > 0);
  if (included.some((tag) => !tags.includes(tag))) return false;
  if (excluded.some((tag) => tags.includes(tag))) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Chapitres                                                           */
/* ------------------------------------------------------------------ */

/** Numéro numérique d'une clé de chapitre (`"127.5"` -> 127.5, `"x"` -> 0). */
export function chapterNumber(chapterId: string): number {
  const parsed = Number.parseFloat(chapterId);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Tri croissant des clés de chapitres. Comparaison numérique (les clés
 * décimales se placent correctement), puis comparaison littérale en secours
 * pour garantir un ordre déterministe en cas d'égalité numérique.
 */
export function compareChapterIds(a: string, b: string): number {
  const diff = chapterNumber(a) - chapterNumber(b);
  if (diff !== 0) return diff;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Convertit un `volume` textuel en nombre, ou `undefined` s'il est vide. */
export function volumeNumber(volume: unknown): number | undefined {
  if (typeof volume !== "string") return undefined;
  const trimmed = volume.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Convertit un timestamp Unix (secondes) en `Date`, ou `undefined`. */
export function timestampDate(timestamp: unknown): Date | undefined {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0) {
    return undefined;
  }
  return new Date(timestamp * 1000);
}

/** Libellé d'équipe(s) d'un chapitre (chaîne vide si aucune). */
export function chapterGroup(teams: unknown): string {
  if (!Array.isArray(teams)) return "";
  return teams.filter((team): team is string => typeof team === "string" && team.length > 0).join(", ");
}

/** Vrai si le chapitre est réservé à l'édition officielle (`licensed`). */
export function isLicensedChapter(chapter: BigsoloChapterEntry | undefined): boolean {
  return chapter?.licensed === true;
}

/* ------------------------------------------------------------------ */
/* Couvertures / tags / sous-titre                                     */
/* ------------------------------------------------------------------ */

/** Meilleure URL de couverture disponible (hq puis lq), ou "". */
export function pickCoverImage(item: BigsoloSeriesItem): string {
  const candidates: Array<string | undefined> = [
    item.cover?.url_hq,
    item.cover?.url_lq,
    ...(item.covers ?? []).flatMap((cover) => [cover.url_hq, cover.url_lq]),
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return "";
}

/** Toutes les couvertures connues (dédupliquées, non vides). */
export function pickCoverList(item: BigsoloSeriesItem): string[] {
  const covers = (item.covers ?? []).flatMap((cover) => [cover.url_hq, cover.url_lq]);
  const primary = item.cover?.url_hq ?? item.cover?.url_lq;
  if (primary) covers.unshift(primary);
  return dedupeStrings(covers);
}

/** Sections de tags pures (`{id, label, tags}`), sans passer par `App`. */
export function buildTagSections(item: BigsoloSeriesItem): Array<{
  id: string;
  label: string;
  tags: Array<{ id: string; label: string }>;
}> {
  const tags = dedupeStrings(item.tags ?? []).map((tag) => ({ id: tag, label: tag }));
  if (tags.length === 0) return [];
  return [{ id: "genres", label: "Genres", tags }];
}

/** Sous-titre affiché dans les résultats de recherche. */
export function buildSubtitle(item: BigsoloSeriesItem): string | undefined {
  const parts = dedupeStrings([
    item.status ?? "",
    item.release_year !== undefined ? String(item.release_year) : "",
  ]);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/* ------------------------------------------------------------------ */
/* Divers                                                              */
/* ------------------------------------------------------------------ */

/** Concatène tous les items du catalogue (séries + one-shots). */
export function allSeries(catalog: BigsoloCatalog): BigsoloSeriesItem[] {
  return [...(catalog.series ?? []), ...(catalog.os ?? [])];
}

/** Retire doublons et valeurs vides d'une liste de chaînes. */
export function dedupeStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Erreurs — messages explicites, sans aucun contournement             */
/* ------------------------------------------------------------------ */

/**
 * 403 : protection Cloudflare. On explique clairement la situation et on
 * indique qu'aucun contournement n'est tenté (pas de challenge résolu, pas
 * de rafale de requêtes).
 */
export function cloudflareError(url: string): Error {
  return new Error(
    `HTTP 403 : bigsolo.org est protégé par Cloudflare et a refusé la requête (${url}). ` +
      `La source envoie pourtant un User-Agent navigateur ; le site renforce peut-être sa protection. ` +
      `Aucun contournement de protection n'est effectué (pas de résolution de challenge, pas de rafale de requêtes). ` +
      `Réessaie plus tard depuis l'application.`,
  );
}

/** 404 : ressource introuvable. */
export function notFoundError(what: string): Error {
  return new Error(`Introuvable sur bigsolo.org : ${what}.`);
}

/** Autre statut HTTP inattendu. */
export function httpStatusError(status: number, url: string): Error {
  return new Error(`HTTP ${status} : réponse inattendue de bigsolo.org (${url}).`);
}

/** Erreur réseau / exception de transport. */
export function networkError(detail: string, url: string): Error {
  return new Error(`Erreur réseau en contactant bigsolo.org (${url}) : ${detail}`);
}

/** Réponse non-JSON (typiquement une page HTML Cloudflare). */
export function invalidJsonError(url: string): Error {
  return new Error(
    `Réponse non-JSON reçue de bigsolo.org (${url}). ` +
      `Le site a probablement renvoyé une page HTML (protection Cloudflare) au lieu des données attendues.`,
  );
}

/** Chapitre réservé à l'édition officielle : on ne simule JAMAIS la lecture. */
export function licensedError(chapterId: string): Error {
  return new Error(
    `Le chapitre ${chapterId} n'est pas lisible sur bigsolo.org : il est désormais disponible dans l'édition officielle.`,
  );
}

/** Chapitre sans aucune page exploitable. */
export function noPagesError(chapterId: string): Error {
  return new Error(`Aucune page n'a été trouvée pour le chapitre ${chapterId} sur bigsolo.org.`);
}

/** Extrait un code de statut HTTP d'une exception (axios, runtime, autre). */
export function httpStatusFromError(error: unknown): number | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const candidate = error as { status?: unknown; response?: { status?: unknown } };
  if (typeof candidate.status === "number") return candidate.status;
  if (candidate.response && typeof candidate.response.status === "number") {
    return candidate.response.status;
  }
  return undefined;
}

/** Message lisible d'une exception quelconque. */
export function errorMessageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error !== null && typeof error === "object") {
    const candidate = error as { message?: unknown };
    if (typeof candidate.message === "string") return candidate.message;
  }
  return String(error);
}

/**
 * Parse un JSON de façon défensive.
 *
 * - JSON valide -> objet/tableau/valeur tel quel ;
 * - chaîne vide (ou non textuelle) -> erreur explicite ;
 * - texte non-JSON (page HTML Cloudflare, erreur serveur…) -> erreur
 *   explicite, jamais une exception brute de `JSON.parse`.
 */
export function safeJson<T>(raw: unknown, context: string): T {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw invalidJsonError(context);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw invalidJsonError(context);
  }
}

/** Alias historique de `safeJson` (mêmes garanties). */
export function parseJson<T>(raw: string, url: string): T {
  return safeJson<T>(raw, url);
}

/** Vrai si le chapitre existe dans la fiche catalogue. */
export function hasChapter(item: BigsoloSeriesItem, chapterId: string): boolean {
  return Object.prototype.hasOwnProperty.call(item.chapters ?? {}, chapterId);
}

/** Récupère l'entrée de chapitre d'une fiche catalogue (ou `undefined`). */
export function getChapterEntry(
  item: BigsoloSeriesItem,
  chapterId: string,
): BigsoloChapterEntry | undefined {
  return (item.chapters ?? {})[chapterId];
}

/** Vrai si les pages d'un chapitre sont réservées à l'édition officielle. */
export function isLicensedPages(pages: BigsoloChapterPages | undefined): boolean {
  return pages?.licensed === true;
}

/** Filtre les pages d'un chapitre en ne gardant que des URLs absolues non vides. */
export function usablePages(pages: BigsoloChapterPages | undefined): string[] {
  return dedupeStrings(pages?.images ?? []).filter(
    (url) => url.startsWith("http://") || url.startsWith("https://"),
  );
}

/** Réduit une liste d'items à ses slugs (utile pour les logs/tests). */
export function slugsOf(items: BigsoloSeriesItem[]): string[] {
  return items.map((item) => item.slug).filter((slug) => typeof slug === "string" && slug.length > 0);
}

/* ------------------------------------------------------------------ */
/* Accueil (intent HOMEPAGE_SECTIONS)                                 */
/* ------------------------------------------------------------------ */

/**
 * Identifiants STABLES des sections d'accueil : ils traversent la frontière
 * application <-> source (`getHomePageSections` les publie,
 * `getViewMoreItems` les reçoit en retour) et ne doivent donc jamais changer.
 */
export const HOME_SECTION_LATEST = "latest-updates";
export const HOME_SECTION_RECO = "reco";

/** Taille d'une page « Voir plus » (le catalogue complet en fait ~108). */
export const HOME_PAGE_SIZE = 30;

/**
 * Date de dernière mise à jour d'une série : `last_chapter.timestamp` du
 * catalogue, avec repli sur le plus grand timestamp de la map `chapters`.
 * `0` quand aucune date exploitable n'est présente.
 */
export function lastUpdateTimestamp(item: BigsoloSeriesItem): number {
  const direct = item.last_chapter?.timestamp;
  if (typeof direct === "number" && Number.isFinite(direct) && direct > 0) return direct;
  let best = 0;
  for (const entry of Object.values(item.chapters ?? {})) {
    const candidate = entry?.timestamp;
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > best) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Séries triées de la plus récemment mise à jour à la plus ancienne.
 * Départage déterministe (titre normalisé puis slug) pour un ordre stable
 * entre deux catalogues identiques.
 */
export function sortByLastUpdate(items: BigsoloSeriesItem[]): BigsoloSeriesItem[] {
  return [...items].sort((a, b) => {
    const diff = lastUpdateTimestamp(b) - lastUpdateTimestamp(a);
    if (diff !== 0) return diff;
    const titleA = normalize(a.title ?? a.slug);
    const titleB = normalize(b.title ?? b.slug);
    if (titleA !== titleB) return titleA < titleB ? -1 : 1;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
}

/** Séries recommandées par le site (`reco`), dédoublonnées et exploitables. */
export function recoSeries(catalog: BigsoloCatalog): BigsoloSeriesItem[] {
  const out: BigsoloSeriesItem[] = [];
  const seen = new Set<string>();
  for (const item of catalog.reco ?? []) {
    if (!item || typeof item.slug !== "string" || item.slug.length === 0) continue;
    if (seen.has(item.slug)) continue;
    seen.add(item.slug);
    out.push(item);
  }
  return out;
}

/**
 * Page 0-indexée d'une liste. `nextPage` vaut `undefined` quand la liste est
 * épuisée : c'est ce qui pilote `containsMoreItems` côté application.
 */
export function pageSlice(
  items: BigsoloSeriesItem[],
  page: number,
  pageSize: number = HOME_PAGE_SIZE,
): { items: BigsoloSeriesItem[]; nextPage: number | undefined } {
  const safePage = Number.isInteger(page) && page > 0 ? page : 0;
  const start = safePage * pageSize;
  const slice = items.slice(start, start + pageSize);
  const nextPage = start + pageSize < items.length ? safePage + 1 : undefined;
  return { items: slice, nextPage };
}

/** Petite aide interne : n'ajoute que les chaînes non vides. */
function pushNonEmpty(target: string[], value: unknown): void {
  if (typeof value === "string" && value.trim().length > 0) target.push(value.trim());
}
