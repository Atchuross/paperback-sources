/**
 * AsuraScans — helpers PURS (Common).
 *
 * RÈGLE ABSOLUE : ce fichier ne référence JAMAIS le global `App` du runtime
 * Paperback et n'importe rien au runtime (`@paperback/types` est importé en
 * `import type`, donc entièrement effacé à la compilation). Il reste donc
 * importable et testable en Node pur (`tmp/AsuraScans/Common.js`), ce dont la
 * suite locale `src/AsuraScans/AsuraScans.test.js` a besoin.
 *
 * Contrainte mesurée sur les sources existantes : `new Source(cheerio)` reçoit
 * en réalité `undefined` dans le harnais, et l'implémentation est API-only.
 * Aucune fonction ici n'utilise `this.cheerio` ni ne parse une page HTML :
 * tout vient du JSON de `https://api.asurascans.com`.
 *
 * Seul le champ texte `description` (qui arrive en HTML `<p>…</p>`) est
 * normalisé : retrait des balises par balayage de caractères (pas de sélecteur,
 * pas de parsing de document, aucune requête HTML).
 */

import type { Request, Response, SourceInterceptor } from "@paperback/types";

import type {
  AsuraChapterEntry,
  AsuraSearchPage,
  AsuraSeriesDetails,
  AsuraSeriesTile,
} from "./data-contracts";

/* ------------------------------------------------------------------ */
/* Constantes d'accès au site et à l'API                              */
/* ------------------------------------------------------------------ */

/** Hôte public (partage, redirections 302 du site). */
export const SITE_BASE_URL = "https://asurascans.com";

/** Hôte de l'API JSON — seule source de données de cette source. */
export const API_BASE_URL = "https://api.asurascans.com";

/** Préfixe des routes API. */
export const API_SERIES_PATH = "/api/series";

/** Hôte du CDN d'images : l'interceptor ne le touche JAMAIS. */
export const CDN_HOST = "cdn.asurascans.com";

/** Le site est anglophone. */
export const LANG_CODE = "en";

/** Taille de page de la recherche (`limit=20`, mesuré). */
export const SEARCH_PAGE_SIZE = 20;

/** Identifiants de sections d'accueil (aussi utilisés par `getViewMoreItems`). */
export const HOME_SECTION_TRENDING = "trending";
export const HOME_SECTION_POPULAR = "popular";
export const HOME_SECTION_LATEST = "latest-updates";

/**
 * Sections d'accueil : chacune est une valeur de tri de l'API
 * (`sort=trending|popular|latest`), mesurée en 200 avec des contenus distincts.
 */
export const HOME_SECTIONS: ReadonlyArray<{ id: string; title: string; sort: string }> = [
  { id: HOME_SECTION_TRENDING, title: "Trending", sort: "trending" },
  { id: HOME_SECTION_POPULAR, title: "Popular", sort: "popular" },
  { id: HOME_SECTION_LATEST, title: "Latest Updates", sort: "latest" },
];

/** Tri API associé à une section d'accueil (`undefined` si l'id est inconnu). */
export function sortForSection(sectionId: string): string | undefined {
  const section = HOME_SECTIONS.find((candidate) => candidate.id === sectionId);
  return section ? section.sort : undefined;
}

/**
 * User-Agent navigateur : `api.asurascans.com` est derrière Cloudflare et
 * répond 403 à un UA non navigateur (mesuré). On se présente comme le
 * navigateur que nous sommes — aucun contournement, aucune résolution de
 * challenge, aucune rotation d'IP.
 */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Clé canonique de l'en-tête. */
export const USER_AGENT_HEADER = "User-Agent";

/**
 * Clé minuscule : le runtime Paperback lit `headers["user-agent"]` pour
 * décider s'il injecte son propre User-Agent. On pose la même valeur sous les
 * deux casses (aucun en-tête dupliqué au niveau HTTP).
 */
export const USER_AGENT_HEADER_LOWER = "user-agent";

/** `Accept` attendu par l'hôte API (JSON). */
export const API_ACCEPT = "application/json, text/plain, */*";

/** `Accept` attendu par l'hôte du site (documents HTML). */
export const SITE_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

/** Hôtes qui reçoivent l'ensemble d'en-têtes navigateur. */
export const BROWSER_HEADER_HOSTS: ReadonlyArray<string> = [
  "asurascans.com",
  "www.asurascans.com",
  "api.asurascans.com",
];

/* ------------------------------------------------------------------ */
/* Interceptor                                                        */
/* ------------------------------------------------------------------ */

/** Nom d'hôte d'une URL absolue (`""` si l'URL n'est pas http(s)). */
export function hostOf(url: string): string {
  if (typeof url !== "string") return "";
  const match = /^https?:\/\/([^/?#]*)/i.exec(url);
  if (!match) return "";
  const authority = match[1];
  const at = authority.lastIndexOf("@");
  const host = (at >= 0 ? authority.slice(at + 1) : authority).split(":")[0];
  return host.toLowerCase();
}

/**
 * Interceptor pur : pose les en-têtes navigateur exigés par Cloudflare.
 *
 * CORRECTIF connu (incident `t_cb49ff66`) : `interceptRequest` MUTE
 * `request.headers` en place et renvoie LE MÊME objet `Request`. Renvoyer une
 * copie fait lever `MethodInvalidReturnTypeError [PBError(303)]` à chaque
 * requête.
 *
 * ⚠ `cdn.asurascans.com` n'est JAMAIS modifié : une en-tête `Accept` HTML sur
 * une requête d'image peut casser le contenu servi (mesuré : les images
 * répondent 200 sans Referer ni en-têtes particuliers).
 */
export class AsuraScansInterceptor implements SourceInterceptor {
  async interceptRequest(request: Request): Promise<Request> {
    const host = hostOf(typeof request.url === "string" ? request.url : "");

    // Aucune modification pour le CDN d'images.
    if (host === CDN_HOST) return request;

    const headers: Record<string, string> = request.headers ?? {};
    headers[USER_AGENT_HEADER] = BROWSER_USER_AGENT;
    headers[USER_AGENT_HEADER_LOWER] = BROWSER_USER_AGENT;

    if (BROWSER_HEADER_HOSTS.indexOf(host) >= 0) {
      headers["Accept-Language"] = "en-US,en;q=0.9";
      headers["Sec-Fetch-Dest"] = "document";
      headers["Sec-Fetch-Mode"] = "navigate";
      headers["Sec-Fetch-Site"] = "none";
      headers["Upgrade-Insecure-Requests"] = "1";
      headers["Accept"] = host === "api.asurascans.com" ? API_ACCEPT : SITE_ACCEPT;
    }

    request.headers = headers;
    return request;
  }

  async interceptResponse(response: Response): Promise<Response> {
    return response;
  }
}

/* ------------------------------------------------------------------ */
/* Validation des identifiants                                        */
/* ------------------------------------------------------------------ */

/**
 * `mangaId` = slug nu de la série (`solo-leveling`) : l'API accepte le slug
 * avec ou sans le suffixe public `-f212c582` (réponses identiques, mesuré).
 * Refus si vide, si ce n'est pas une chaîne ou si elle contient un séparateur
 * d'URL (aucune injection de chemin possible).
 */
export function sanitizeMangaId(mangaId: unknown): string {
  const raw = typeof mangaId === "string" ? mangaId.trim() : "";
  if (raw.length === 0) throw invalidMangaIdError();
  if (/[/\\?#]/.test(raw)) throw invalidMangaIdError(raw);
  return raw;
}

/**
 * Forme normale d'un numéro de chapitre : entier ou décimal pointé, positif ou
 * nul (`"10"`, `"0"`, `"100.5"`), sans zéro superflu, sans signe et sans
 * exposant.
 *
 * MESURÉ : l'API indexe les chapitres par NUMÉRO et sert aussi des numéros
 * DÉCIMAUX — `solo-farming-in-the-tower` publie un chapitre `number: 100.5`
 * (id 167240, 1 page), et `GET /api/series/solo-farming-in-the-tower/chapters/100.5`
 * répond 200. Les écarter perdrait du contenu réellement lisible.
 *
 * Le travail reste STRICTEMENT textuel (aucune conversion numérique) : pas
 * d'exposant (`1e3` est refusé) et pas de `-0` possible en sortie.
 * `undefined` si la valeur n'est pas un numéro de chapitre exploitable.
 */
export function normalizeChapterNumber(chapterId: unknown): string | undefined {
  const raw =
    typeof chapterId === "string"
      ? chapterId.trim()
      : typeof chapterId === "number" && Number.isFinite(chapterId)
        ? String(chapterId)
        : "";
  if (!/^\d+(\.\d+)?$/.test(raw)) return undefined;

  const dot = raw.indexOf(".");
  const integerPart = dot < 0 ? raw : raw.slice(0, dot);
  const fractionPart = dot < 0 ? "" : raw.slice(dot + 1);

  // `010` -> `10`, `0` -> `0` (on garde toujours un chiffre entier).
  const integerDigits = integerPart.replace(/^0+(?=\d)/, "");
  // `100.50` -> `100.5`, `10.00` -> `10` (les zéros de fin ne portent rien).
  const fractionDigits = fractionPart.replace(/0+$/, "");

  return fractionDigits.length > 0 ? `${integerDigits}.${fractionDigits}` : integerDigits;
}

/**
 * `chapterId` = NUMÉRO de chapitre sous forme de chaîne (`"10"`, `"0"`,
 * `"100.5"`). L'API est indexée par numéro (`/chapters/10` -> 200,
 * `/chapters/999` -> 404, `/chapters/100.5` -> 200), donc on n'accepte qu'un
 * entier ou un décimal pointé >= 0, en écriture décimale (jamais d'exposant).
 */
export function sanitizeChapterId(chapterId: unknown): string {
  const normalized = normalizeChapterNumber(chapterId);
  if (normalized === undefined) throw invalidChapterIdError(String(chapterId));
  return normalized;
}

/* ------------------------------------------------------------------ */
/* Construction d'URL                                                  */
/* ------------------------------------------------------------------ */

/** Entier >= 0 borné (jamais de valeur négative ou non finie dans une URL). */
export function safeOffset(offset: unknown): number {
  if (typeof offset !== "number" || !Number.isFinite(offset) || offset <= 0) return 0;
  return Math.floor(offset);
}

/** `GET /api/series?search=<q>&limit=20&offset=<O>` (pagination par offset). */
export function searchUrl(query: string, offset: number): string {
  const params = [
    `search=${encodeURIComponent(typeof query === "string" ? query : "")}`,
    `limit=${SEARCH_PAGE_SIZE}`,
    `offset=${safeOffset(offset)}`,
  ];
  return `${API_BASE_URL}${API_SERIES_PATH}?${params.join("&")}`;
}

/** `GET /api/series?limit=20&sort=<tri>&offset=<O>` (section d'accueil). */
export function homeSectionUrl(sort: string, offset: number): string {
  const params = [`limit=${SEARCH_PAGE_SIZE}`, `sort=${encodeURIComponent(sort)}`, `offset=${safeOffset(offset)}`];
  return `${API_BASE_URL}${API_SERIES_PATH}?${params.join("&")}`;
}

/** `GET /api/series/<slug>` — fiche série. */
export function seriesUrl(mangaId: string): string {
  return `${API_BASE_URL}${API_SERIES_PATH}/${encodeURIComponent(sanitizeMangaId(mangaId))}`;
}

/** `GET /api/series/<slug>/chapters` — liste des chapitres. */
export function chapterListUrl(mangaId: string): string {
  return `${seriesUrl(mangaId)}/chapters`;
}

/** `GET /api/series/<slug>/chapters/<numéro>` — pages d'un chapitre. */
export function chapterPagesUrl(mangaId: string, chapterId: string): string {
  const safeChapter = sanitizeChapterId(chapterId);
  return `${seriesUrl(mangaId)}/chapters/${safeChapter}`;
}

/**
 * Lien de partage web d'une fiche : `https://asurascans.com/comics/<slug>`.
 * Le site redirige en 302 vers l'URL suffixée (`-f212c582`) : aucune constante
 * de suffixe n'est donc maintenue ici.
 */
export function mangaShareUrl(mangaId: string): string {
  return `${SITE_BASE_URL}/comics/${encodeURIComponent(sanitizeMangaId(mangaId))}`;
}

/* ------------------------------------------------------------------ */
/* Accès défensif au JSON                                             */
/* ------------------------------------------------------------------ */

/** Objet JSON (jamais un tableau, jamais `null`). */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** Tableau JSON (`[]` si la valeur n'en est pas un). */
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Chaîne non vide après `trim` (`undefined` sinon). */
export function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Nombre fini (`undefined` sinon). */
export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Corps de réponse : le runtime peut livrer `response.data` en CHAÎNE ou déjà
 * PARSÉ (objet). On accepte les deux, et on refuse explicitement le reste.
 */
export function parseJsonBody(raw: unknown, url: string): unknown {
  if (typeof raw === "string") {
    if (isBlank(raw)) throw emptyBodyError(url);
    try {
      return JSON.parse(raw) as unknown;
    } catch (error) {
      throw invalidJsonError(errorMessageOf(error), url);
    }
  }
  if (raw === null || raw === undefined) throw emptyBodyError(url);
  if (typeof raw === "object") return raw;
  throw invalidJsonError(`charge de type « ${typeof raw} » (JSON attendu)`, url);
}

/**
 * Une réponse 2xx peut porter `{"error":"…"}` sans `data` : on la traduit en
 * « introuvable » plutôt que de laisser passer une coquille vide.
 */
export function rejectApiError(payload: unknown, url: string): void {
  const root = asRecord(payload);
  if (!root) return;
  const error = asString(root.error);
  if (!error) return;
  const hasData = root.data !== undefined && root.data !== null;
  if (hasData) return;
  throw notFoundError(`${error} (${url})`);
}

/* ------------------------------------------------------------------ */
/* Helpers texte                                                       */
/* ------------------------------------------------------------------ */

/** Entités HTML usuelles (les entités numériques sont traitées à part). */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

/** Décode une entité (`amp`, `#39`, `#x27`) ; `undefined` si inconnue. */
function decodeEntity(entity: string): string | undefined {
  if (entity.length === 0) return undefined;
  if (entity.charAt(0) === "#") {
    const hex = entity.charAt(1) === "x" || entity.charAt(1) === "X";
    const digits = hex ? entity.slice(2) : entity.slice(1);
    if (!/^[0-9a-fA-F]+$/.test(digits)) return undefined;
    const codePoint = Number.parseInt(digits, hex ? 16 : 10);
    if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return undefined;
    return String.fromCodePoint(codePoint);
  }
  return NAMED_ENTITIES[entity.toLowerCase()];
}

/** Décode les entités HTML nommées, décimales et hexadécimales (balayage). */
export function decodeEntities(value: string): string {
  if (typeof value !== "string") return "";
  if (value.indexOf("&") < 0) return value;

  let out = "";
  let index = 0;
  while (index < value.length) {
    const char = value.charAt(index);
    if (char !== "&") {
      out += char;
      index += 1;
      continue;
    }
    const end = value.indexOf(";", index + 1);
    if (end < 0 || end - index > 12) {
      out += char;
      index += 1;
      continue;
    }
    const decoded = decodeEntity(value.slice(index + 1, end));
    if (decoded === undefined) {
      out += char;
      index += 1;
      continue;
    }
    out += decoded;
    index = end + 1;
  }
  return out;
}

/** Normalise les espaces (y compris insécables) d'un texte déjà extrait. */
export function collapseWhitespace(value: string): string {
  return value.replace(/[\s\u00a0]+/g, " ").trim();
}

/** Balises de bloc : elles séparent des mots, contrairement aux balises en ligne. */
const BLOCK_TAGS: Record<string, true> = {
  p: true,
  br: true,
  div: true,
  li: true,
  ul: true,
  ol: true,
  tr: true,
  td: true,
  th: true,
  table: true,
  section: true,
  article: true,
  blockquote: true,
  h1: true,
  h2: true,
  h3: true,
  h4: true,
  h5: true,
  h6: true,
};

/** Vrai si la balise (contenu entre `<` et `>`) est une balise de bloc. */
function isBlockTag(tag: string): boolean {
  let name = "";
  for (let index = 0; index < tag.length; index += 1) {
    const char = tag.charAt(index);
    if (char === "/" || char === " " || char === "\t" || char === "\n" || char === "\r") continue;
    const code = char.toLowerCase();
    if ((code >= "a" && code <= "z") || (code >= "0" && code <= "9")) {
      name += code;
      continue;
    }
    break;
  }
  return BLOCK_TAGS[name] === true;
}

/**
 * Texte brut d'une valeur qui arrive balisée (champ `description` de l'API).
 * Balayage de caractères : tout ce qui se trouve entre `<` et `>` est retiré
 * (une balise de bloc devient une espace, pour ne pas coller deux phrases), puis
 * les entités sont décodées. Aucun sélecteur, aucun parseur de document.
 */
export function toPlainText(value: unknown): string {
  if (typeof value !== "string") return "";
  if (value.length === 0) return "";

  let out = "";
  let index = 0;
  while (index < value.length) {
    const char = value.charAt(index);
    if (char === "<") {
      const end = value.indexOf(">", index + 1);
      if (end < 0) break; // balise non fermée : on s'arrête là
      if (isBlockTag(value.slice(index + 1, end))) out += " ";
      index = end + 1;
      continue;
    }
    out += char;
    index += 1;
  }
  return collapseWhitespace(decodeEntities(out));
}

/** Titre de repli à partir d'un slug (`solo-leveling` -> `Solo Leveling`). */
export function slugToTitle(slug: string): string {
  if (typeof slug !== "string" || slug.length === 0) return "";
  return slug
    .split(/[-_]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Retire les doublons (et les valeurs vides) d'une liste de chaînes. */
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
/* Dates                                                              */
/* ------------------------------------------------------------------ */

/** Date ISO de l'API (`2026-11-13T21:51:58.335745Z`), `undefined` si invalide. */
export function parseIsoDate(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** Horodatage lisible en UTC : `YYYY-MM-DD HH:mm UTC` (`""` si invalide). */
export function formatUtcTimestamp(value: unknown): string {
  const date = parseIsoDate(value);
  if (!date) return "";
  const pad = (part: number, width = 2): string => String(part).padStart(width, "0");
  return (
    `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
  );
}

/* ------------------------------------------------------------------ */
/* Mappers JSON -> entités                                            */
/* ------------------------------------------------------------------ */

/** Statuts connus de l'API -> libellés attendus par l'application. */
const STATUS_LABELS: Record<string, string> = {
  ongoing: "Ongoing",
  completed: "Completed",
  hiatus: "Hiatus",
  "on hold": "Hiatus",
  dropped: "Cancelled",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  upcoming: "Upcoming",
};

/** Statut normalisé (`Unknown` si absent ou non textuel). */
export function mapStatus(value: unknown): string {
  const raw = asString(value);
  if (!raw) return "Unknown";
  const known = STATUS_LABELS[raw.toLowerCase()];
  if (known) return known;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** URL d'image `https://` absolue (`""` si la valeur n'est pas exploitable). */
export function normalizeImageUrl(value: unknown): string {
  const raw = asString(value);
  if (!raw) return "";
  if (raw.indexOf("//") === 0) return `https:${raw}`;
  if (raw.toLowerCase().indexOf("http://") === 0) return `https://${raw.slice("http://".length)}`;
  if (raw.toLowerCase().indexOf("https://") === 0) return raw;
  if (raw.charAt(0) === "/") return `${SITE_BASE_URL}${raw}`;
  return "";
}

/** Une série de liste (recherche, accueil) -> tuile ; `undefined` si sans slug. */
export function toSeriesTile(value: unknown): AsuraSeriesTile | undefined {
  const dto = asRecord(value);
  if (!dto) return undefined;
  const slug = asString(dto.slug);
  if (!slug) return undefined;
  const title = asString(dto.title);
  return {
    mangaId: slug,
    title: title ?? slugToTitle(slug),
    image: normalizeImageUrl(dto.cover),
  };
}

/**
 * Une page de `GET /api/series?…` (recherche ou section d'accueil).
 * `nextOffset` n'est renseigné que si l'API annonce une suite (`meta.has_more`)
 * ou s'il reste des résultats (`offset + items < meta.total`) — le paramètre
 * `page` de l'API est ignoré (mesuré), la pagination est `limit`/`offset`.
 */
export function toSearchPage(payload: unknown, offset: number): AsuraSearchPage {
  const root = asRecord(payload);
  const data = asArray(root ? root.data : undefined);

  const seen = new Set<string>();
  const items: AsuraSeriesTile[] = [];
  for (const entry of data) {
    const tile = toSeriesTile(entry);
    if (!tile || seen.has(tile.mangaId)) continue;
    seen.add(tile.mangaId);
    items.push(tile);
  }

  const meta = asRecord(root ? root.meta : undefined);
  const total = asNumber(meta ? meta.total : undefined) ?? 0;
  const hasMoreFlag = meta ? meta.has_more === true : false;
  const hasMore = hasMoreFlag || (total > 0 && safeOffset(offset) + items.length < total);

  return {
    items,
    nextOffset: hasMore && items.length > 0 ? safeOffset(offset) + SEARCH_PAGE_SIZE : undefined,
  };
}

/** `GET /api/series/<slug>` -> fiche normalisée. */
export function toSeriesDetails(payload: unknown, mangaId: string): AsuraSeriesDetails {
  const root = asRecord(payload);
  const series = asRecord(root ? root.series : undefined);
  if (!series) {
    throw malformedResponseError(`fiche de « ${mangaId} » : champ « series » absent de la réponse`);
  }

  const title = asString(series.title);
  const slug = asString(series.slug) ?? mangaId;
  const alternativeTitles = asArray(series.alt_titles).map((entry) => asString(entry));
  const titles = dedupeStrings([title ?? slugToTitle(slug), ...alternativeTitles]);
  const tags = dedupeStrings(asArray(series.genres).map((genre) => asString(asRecord(genre)?.name)));

  return {
    mangaId,
    title: title ?? slugToTitle(slug),
    titles: titles.length > 0 ? titles : [mangaId],
    image: normalizeImageUrl(series.cover),
    description: toPlainText(series.description),
    status: mapStatus(series.status),
    author: asString(series.author) ?? "",
    artist: asString(series.artist) ?? "",
    tags,
    type: asString(series.type) ?? "",
    rating: asNumber(series.rating),
  };
}

/**
 * `GET /api/series/<slug>/chapters` -> entrées normalisées.
 * `chapterId` est le NUMÉRO en chaîne (seule clé acceptée par l'API des pages),
 * l'ordre renvoyé est décroissant sur le numéro, doublons écartés.
 *
 * Les numéros DÉCIMAUX sont conservés (`100.5` est un chapitre réel et gratuit,
 * mesuré sur `solo-farming-in-the-tower`) ; seuls les numéros absents, négatifs
 * ou non numériques sont écartés.
 */
export function toChapterEntries(payload: unknown): AsuraChapterEntry[] {
  const root = asRecord(payload);
  const data = asArray(root ? root.data : undefined);

  const seen = new Set<string>();
  const entries: AsuraChapterEntry[] = [];
  for (const value of data) {
    const dto = asRecord(value);
    if (!dto) continue;
    const number = asNumber(dto.number);
    if (number === undefined || number < 0) continue;
    const chapterId = normalizeChapterNumber(number);
    if (chapterId === undefined) continue;
    if (seen.has(chapterId)) continue;
    seen.add(chapterId);
    entries.push({
      chapterId,
      chapNum: number,
      name: asString(dto.title) ?? "",
      time: parseIsoDate(dto.published_at),
      isPremium: dto.is_premium === true,
    });
  }

  return entries.sort((a, b) => b.chapNum - a.chapNum);
}

/** Contexte d'un chapitre inaccessible (premium / accès anticipé). */
export interface PremiumAccessContext {
  mangaId: string;
  chapterId: string;
  isPremium: boolean;
  isLocked: boolean;
  pageCount: number | undefined;
  unlockTime: string | undefined;
  earlyAccessUntil: string | undefined;
}

/**
 * `GET /api/series/<slug>/chapters/<numéro>` -> URLs d'images `https://`.
 *
 * Signaux premium MESURÉS : `chapter.is_premium === true`, `data.is_locked ===
 * true`, ou `chapter.pages` absent/vide. `data.access_gate` est une chaîne
 * VIDE même sur le cas verrouillé : ce n'est pas un signal.
 *
 * Un chapitre inaccessible lève une erreur explicite (date d'ouverture +
 * mention « réservé aux abonnés ») : aucune page inventée, aucune
 * authentification, aucun contournement.
 */
export function toChapterPages(payload: unknown, mangaId: string, chapterId: string): string[] {
  const root = asRecord(payload);
  const data = asRecord(root ? root.data : undefined);
  const chapter = asRecord(data ? data.chapter : undefined);
  if (!data || !chapter) throw chapterNotFoundError(mangaId, chapterId);

  const isPremium = chapter.is_premium === true;
  const isLocked = data.is_locked === true;
  const pages = dedupeStrings(
    asArray(chapter.pages).map((page) => normalizeImageUrl(asRecord(page)?.url)),
  );

  if (isPremium || isLocked || pages.length === 0) {
    throw premiumAccessError({
      mangaId,
      chapterId,
      isPremium,
      isLocked,
      pageCount: asNumber(chapter.page_count) ?? pages.length,
      unlockTime: asString(data.unlock_time),
      earlyAccessUntil: asString(chapter.early_access_until),
    });
  }

  return pages;
}

/* ------------------------------------------------------------------ */
/* Erreurs — messages explicites, sans aucun contournement             */
/* ------------------------------------------------------------------ */

/** Identifiant de série absent ou mal formé (aucune requête émise). */
export function invalidMangaIdError(value?: string): Error {
  const detail = value === undefined ? "" : ` (« ${value} »)`;
  return new Error(
    `Identifiant de série invalide${detail} : AsuraScans attend le slug de la série ` +
      `(ex. « solo-leveling »). Aucune requête n'a été envoyée.`,
  );
}

/** Identifiant de chapitre non numérique (aucune requête émise). */
export function invalidChapterIdError(value: string): Error {
  return new Error(
    `Identifiant de chapitre invalide (« ${value} ») : AsuraScans attend le NUMÉRO du chapitre ` +
      `en chiffres, entier ou décimal pointé (ex. « 10 », « 0 », « 100.5 »). Aucune requête n'a été envoyée.`,
  );
}

/** 403 : protection Cloudflare. Aucun contournement n'est tenté. */
export function accessDeniedError(url: string): Error {
  return new Error(
    `HTTP 403 : asurascans.com a refusé la requête (${url}). ` +
      `Le site est protégé par Cloudflare et attend un navigateur standard ; la source envoie pourtant ` +
      `un User-Agent navigateur et les en-têtes Sec-Fetch. Aucun contournement de protection n'est effectué ` +
      `(pas de résolution de challenge, pas de rotation d'IP, pas de rafale de requêtes). Réessaie plus tard.`,
  );
}

/** 404 : ressource introuvable. */
export function notFoundError(what: string): Error {
  return new Error(`Introuvable sur asurascans.com : ${what}.`);
}

/** Série inconnue (404 sur `/api/series/<slug>` ou `{"data":[]}` sur `/chapters`). */
export function seriesNotFoundError(mangaId: string): Error {
  return new Error(
    `Série introuvable sur asurascans.com : « ${mangaId} » (l'API ne connaît pas ce slug). ` +
      `Vérifie l'identifiant de la série ou retrouve-la par la recherche.`,
  );
}

/** Chapitre inconnu pour une série donnée. */
export function chapterNotFoundError(mangaId: string, chapterId: string): Error {
  return new Error(
    `Chapitre introuvable sur asurascans.com : chapitre « ${chapterId} » de la série « ${mangaId} ». ` +
      `L'API indexe les chapitres par NUMÉRO ; vérifie la liste des chapitres de la série.`,
  );
}

/** Liste de chapitres vide alors que la série existe. */
export function emptyChapterListError(mangaId: string): Error {
  return new Error(
    `Aucun chapitre publié pour « ${mangaId} » sur asurascans.com : l'API a renvoyé une liste vide ` +
      `alors que la fiche de la série existe. Réessaie plus tard.`,
  );
}

/** Autre statut HTTP inattendu. */
export function httpStatusError(status: number, url: string): Error {
  return new Error(`HTTP ${status} : réponse inattendue de api.asurascans.com (${url}).`);
}

/** Exception de transport (réseau, DNS, TLS, timeout). */
export function networkError(detail: string, url: string): Error {
  return new Error(`Erreur réseau en contactant api.asurascans.com (${url}) : ${detail}`);
}

/** Corps de réponse vide : on refuse d'analyser une réponse sans contenu. */
export function emptyBodyError(url: string): Error {
  return new Error(
    `Réponse vide reçue de api.asurascans.com (${url}) : aucun JSON exploitable. ` +
      `Le site a peut-être renvoyé une page de blocage Cloudflare ou une erreur silencieuse.`,
  );
}

/** JSON invalidable : corps non textuel ou syntaxe invalide. */
export function invalidJsonError(detail: string, url: string): Error {
  return new Error(`JSON invalide reçu de api.asurascans.com (${url}) : ${detail}.`);
}

/** Charge JSON valide mais inexploitable (structure inattendue). */
export function malformedResponseError(detail: string): Error {
  return new Error(`Réponse API inexploitable (api.asurascans.com) : ${detail}.`);
}

/** Chapitre premium / accès anticipé : erreur explicite, date annoncée. */
export function premiumAccessError(context: PremiumAccessContext): Error {
  const date = formatUtcTimestamp(context.unlockTime ?? context.earlyAccessUntil);
  const availability =
    date.length > 0 ? `ouverture prévue le ${date}` : `date d'ouverture non communiquée par l'API`;

  return new Error(
    `Chapitre ${context.chapterId} de « ${context.mangaId} » indisponible : réservé aux abonnés / ` +
      `accès anticipé sur asurascans.com (${availability}). ` +
      `Signaux de l'API : is_premium=${String(context.isPremium)}, is_locked=${String(context.isLocked)}, ` +
      `pages=${String(context.pageCount ?? 0)}. ` +
      `Aucune page n'est inventée, aucun accès authentifié, aucun contournement : réessaie après la date d'ouverture.`,
  );
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

/** Vrai si le corps est vide ou composé d'espaces uniquement. */
export function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

/**
 * Vrai si l'erreur vient d'un 404 (ou d'une réponse `{"error":…}`) traduit par
 * `notFoundError`. Permet aux appelants d'affiner le message (« série
 * introuvable », « chapitre introuvable ») sans ré-analyser la réponse.
 */
export function isNotFoundError(error: unknown): boolean {
  return errorMessageOf(error).indexOf("Introuvable sur asurascans.com") === 0;
}
