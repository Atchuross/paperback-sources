/**
 * WeebCentral — helpers purs (Common).
 *
 * RÈGLE ABSOLUE : ce fichier ne référence JAMAIS le global `App` du runtime
 * Paperback, et n'importe RIEN au runtime (les contrats `@paperback/types` sont
 * importés en `import type`, donc entièrement effacés à la compilation). Il
 * reste donc importable et testable en Node pur (`tmp/WeebCentral/Common.js`).
 *
 * Contrainte mesurée le 2026-10-18 (harnais local, toolchain 0.8.7, cheerio
 * 1.2.0) : `new Source(cheerio)` reçoit en réalité `undefined` — le toolchain
 * fait `__importDefault(require("cheerio")).default` alors que cheerio 1.x
 * déclare `__esModule: true` sans export `default`. Un parseur qui appellerait
 * `this.cheerio(html)` lèverait donc `this.cheerio is not a function` dans
 * `paperback test`. Les parseurs ci-dessous sont donc **purs (texte)** : ils
 * prennent le HTML brut et rendent des entités typées, ce qui fonctionne à
 * l'identique dans le harnais, dans la suite locale et dans l'application.
 */

import type { Request, Response, SourceInterceptor } from "@paperback/types";

import { WCChapterEntry, WCSearchPage, WCSeriesDetails, WCSeriesTile } from "./data-contracts";

/* ------------------------------------------------------------------ */
/* Constantes d'accès au site                                          */
/* ------------------------------------------------------------------ */

/** URL de base (les fragments de données vivent sur le même hôte). */
export const BASE_URL = "https://weebcentral.com";

/** Endpoint de recherche (renvoie un fragment HTML, pas du JSON). */
export const SEARCH_PATH = "/search/data";

/** Section d'accueil unique publiée par la source. */
export const HOME_SECTION_LATEST = "latest-updates";

/** Taille de page du endpoint de recherche (`limit=32`, vérifié). */
export const SEARCH_PAGE_SIZE = 32;

/** Le site est anglophone. */
export const LANG_CODE = "en";

/**
 * User-Agent navigateur : le site est derrière Cloudflare et sert normalement
 * les mêmes contenus, mais on se présente comme le navigateur que nous sommes
 * (aucun contournement : ni résolution de challenge, ni rotation d'IP).
 */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Clé canonique de l'en-tête (casse HTTP standard). */
export const USER_AGENT_HEADER = "User-Agent";

/**
 * Clé minuscule : le runtime Paperback lit `headers["user-agent"]` pour
 * décider s'il doit injecter son User-Agent par défaut. On pose donc la même
 * valeur sous les deux casses (aucun en-tête en double réel).
 */
export const USER_AGENT_HEADER_LOWER = "user-agent";

/**
 * Interceptor pur qui pose le User-Agent navigateur sur chaque requête.
 *
 * CORRECTIF D1/D2 (incident `t_cb49ff66`) : `interceptRequest` MUTE
 * `request.headers` en place et renvoie LE MÊME objet `Request` — renvoyer une
 * copie fait lever `MethodInvalidReturnTypeError [PaperbackError(303)]` à
 * chaque requête.
 */
export class WeebCentralInterceptor implements SourceInterceptor {
  async interceptRequest(request: Request): Promise<Request> {
    const headers: Record<string, string> = request.headers ?? {};
    headers[USER_AGENT_HEADER] = BROWSER_USER_AGENT;
    headers[USER_AGENT_HEADER_LOWER] = BROWSER_USER_AGENT;
    request.headers = headers;
    return request;
  }

  async interceptResponse(response: Response): Promise<Response> {
    return response;
  }
}

/* ------------------------------------------------------------------ */
/* Construction d'URL                                                  */
/* ------------------------------------------------------------------ */

/** Échappement d'une requête de recherche : le site attend des `+` pour les espaces. */
export function encodeQuery(query: string): string {
  return encodeURIComponent(query).replace(/%20/g, "+");
}

/**
 * `GET /search/data` — fragment HTML paginé par `limit`/`offset`.
 * `offset` est un entier >= 0 (borné ici, jamais de valeur négative).
 */
export function searchUrl(query: string, offset: number): string {
  const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
  const params = [
    "author=",
    `text=${encodeQuery(query ?? "")}`,
    "sort=Best+Match",
    "order=Descending",
    "official=Any",
    "anime=Any",
    "adult=Any",
    `display_mode=${encodeURIComponent("Full Display")}`,
    `limit=${SEARCH_PAGE_SIZE}`,
    `offset=${safeOffset}`,
  ];
  return `${BASE_URL}${SEARCH_PATH}?${params.join("&")}`;
}

/** `GET /series/<ULID>` — le slug est inutile, l'ULID suffit (vérifié). */
export function seriesUrl(mangaId: string): string {
  return `${BASE_URL}/series/${encodeURIComponent(mangaId)}`;
}

/** `GET /series/<ULID>/full-chapter-list` — fragment HTML des chapitres. */
export function chapterListUrl(mangaId: string): string {
  return `${seriesUrl(mangaId)}/full-chapter-list`;
}

/** `GET /chapters/<ULID>/images` — fragment HTML des pages du chapitre. */
export function chapterImagesUrl(chapterId: string): string {
  return `${BASE_URL}/chapters/${encodeURIComponent(chapterId)}/images`;
}

/** `GET /latest-updates/<page>` — fragment HTML de la section d'accueil (page 1-indexée). */
export function latestUpdatesUrl(page: number): string {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  return `${BASE_URL}/${HOME_SECTION_LATEST}/${safePage}`;
}

/** Lien de partage web d'une fiche série. */
export function mangaShareUrl(mangaId: string): string {
  return seriesUrl(mangaId);
}

/** Préfixe `BASE_URL` à un lien relatif ; laisse les URLs absolues intactes. */
export function absoluteUrl(href: string): string {
  const value = typeof href === "string" ? href.trim() : "";
  if (value.length === 0) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  return value.startsWith("/") ? `${BASE_URL}${value}` : `${BASE_URL}/${value}`;
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

/** Décode les entités HTML (nommées, décimales et hexadécimales). */
export function decodeEntities(value: string): string {
  if (typeof value !== "string" || value.length === 0) return "";
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) {
      const codePoint = Number.parseInt(code.slice(2), 16);
      return Number.isFinite(codePoint) && codePoint > 0 ? String.fromCodePoint(codePoint) : match;
    }
    if (code.startsWith("#")) {
      const codePoint = Number.parseInt(code.slice(1), 10);
      return Number.isFinite(codePoint) && codePoint > 0 ? String.fromCodePoint(codePoint) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Retire les balises, décode les entités et normalise les espaces. */
export function stripTags(html: string): string {
  if (typeof html !== "string" || html.length === 0) return "";
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/[\u00a0\s]+/g, " ")
    .trim();
}

/** Valeur d'un attribut d'une balise ouvrante (`src`, `alt`, `href`, `content`…). */
export function attributeOf(tag: string, name: string): string | undefined {
  if (typeof tag !== "string" || tag.length === 0) return undefined;
  const doubleQuoted = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag);
  if (doubleQuoted) return decodeEntities(doubleQuoted[1]);
  const singleQuoted = new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i").exec(tag);
  if (singleQuoted) return decodeEntities(singleQuoted[1]);
  return undefined;
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

/** Retire les doublons d'une liste d'objets d'après une clé textuelle. */
export function dedupeByKey<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Date ISO 8601 d'un `<time datetime="…">` ; `undefined` si absente/invalide. */
export function parseSiteDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Nombre terminal d'un libellé de chapitre.
 *
 * Le préfixe n'est PAS toujours « Chapter » (vérifié : « Chapter 1196 »,
 * « Mag Version 241 », « Episode 109 », « Chapter 108.2 ») : on prend donc le
 * DERNIER nombre du libellé, `0` s'il n'y en a aucun. Le numéro n'est jamais
 * déduit du rang ou de l'ordre d'affichage du site.
 */
export function chapterNumberOf(label: unknown): number {
  if (typeof label !== "string") return 0;
  const match = /(\d+(?:\.\d+)?)\s*$/.exec(label.replace(/[\u00a0\s]+/g, " ").trim());
  if (!match) return 0;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}

/* ------------------------------------------------------------------ */
/* Extraction bas niveau (fragments HTML)                              */
/* ------------------------------------------------------------------ */

/** ULID placé après `/series/` dans un lien. */
const SERIES_HREF = /\bhref="([^"]*\/series\/([0-9A-Za-z]{26})(?:[/"'?#]|$)[^"]*)"/i;
/** ULID placé après `/chapters/` dans un lien. */
const CHAPTER_HREF = /\bhref="([^"]*\/chapters\/([0-9A-Za-z]{26})(?:[/"'?#]|$)[^"]*)"/i;

/** Première balise `<img>` du fragment dont le `src` est une URL absolue http(s). */
function firstAbsoluteImageTag(fragment: string): string | undefined {
  const re = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(fragment)) !== null) {
    const src = attributeOf(match[0], "src") ?? "";
    if (/^https?:\/\//i.test(src)) return match[0];
  }
  return undefined;
}

/** Titre de repli à partir du slug (`-` -> espaces). */
export function slugToTitle(slug: string): string {
  if (typeof slug !== "string") return "";
  return decodeEntities(slug.replace(/-/g, " ")).trim();
}

/**
 * Découpe un fragment en tuiles (`<article class="bg-base-100…">` pour
 * `/latest-updates`, `<article class="bg-base-300…">` pour `/search/data`).
 * Les blocs internes (`hidden lg:block`, `lg:hidden`) ne sont pas des tuiles :
 * ils sont inclus dans le bloc de leur tuile et dédoublonnés par ULID.
 */
function splitTiles(fragment: string): string[] {
  const re = /<article\b[^>]*class="(?:bg-base-100|bg-base-300)\b/gi;
  const starts: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(fragment)) !== null) starts.push(match.index);
  const blocks: string[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    const from = starts[index];
    const to = index + 1 < starts.length ? starts[index + 1] : fragment.length;
    blocks.push(fragment.slice(from, to));
  }
  return blocks;
}

/**
 * Analyse une liste de tuiles (recherche ou accueil). Chaque tuile expose un
 * lien `/series/<ULID>/<Slug>`, une couverture `<img src>` absolue et un titre
 * (`alt` de la couverture sans le suffixe « cover », sinon `div` tronqué,
 * sinon le slug). Les doublons d'ULID sont éliminés.
 */
export function parseTiles(fragment: string): WCSeriesTile[] {
  if (typeof fragment !== "string" || fragment.length === 0) return [];
  const tiles: WCSeriesTile[] = [];
  for (const block of splitTiles(fragment)) {
    const href = SERIES_HREF.exec(block);
    if (!href) continue;
    const mangaId = href[2];
    const imageTag = firstAbsoluteImageTag(block);
    const image = imageTag ? attributeOf(imageTag, "src") ?? "" : "";
    const alt = imageTag ? attributeOf(imageTag, "alt") ?? "" : "";
    const title = tileTitle(alt, block, href[1]);
    tiles.push({ mangaId, title, image });
  }
  return dedupeByKey(tiles, (tile) => tile.mangaId);
}

/** Titre d'une tuile : `alt` (sans « cover »), sinon `div` tronqué, sinon slug. */
function tileTitle(alt: string, block: string, href: string): string {
  const fromAlt = alt.replace(/\s*cover$/i, "").trim();
  if (fromAlt.length > 0) return fromAlt;

  const truncated = /<div\b[^>]*class="[^"]*truncate[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
  if (truncated) {
    const text = stripTags(truncated[1]);
    if (text.length > 0) return text;
  }

  const slug = /\/series\/[0-9A-Za-z]{26}\/([^"'?#]+)/.exec(href);
  return slug ? slugToTitle(slug[1]) : "";
}

/* ------------------------------------------------------------------ */
/* Parseurs publics (purs, testables hors runtime)                     */
/* ------------------------------------------------------------------ */

/** Analyse `/search/data` : tuiles dédoublonnées + page suivante possible. */
export function parseSearchResults(fragment: string): WCSearchPage {
  const items = parseTiles(fragment);
  const noResults = /No results found/i.test(fragment ?? "");
  // Une page pleine (32 tuiles) annonce une suite ; une page partielle ou une
  // réponse « No results found » la termine. Aucune rafale : le site n'est
  // jamais interrogé en aveugle.
  const hasMore = !noResults && items.length >= SEARCH_PAGE_SIZE;
  return { items, hasMore };
}

/** Analyse `/latest-updates/<page>` (mêmes tuiles que la recherche). */
export function parseLatestUpdates(fragment: string): WCSeriesTile[] {
  return parseTiles(fragment);
}

/** Analyse `/series/<ULID>` : titre(s), couverture, synopsis, statut, auteur, année, tags. */
export function parseSeriesDetails(html: string, mangaId: string): WCSeriesDetails {
  const headings: string[] = [];
  const h1Re = /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi;
  let h1: RegExpExecArray | null;
  while ((h1 = h1Re.exec(html)) !== null) {
    const text = stripTags(h1[1]);
    if (text.length > 0) headings.push(text);
  }

  const details: Record<string, string[]> = {};
  const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let li: RegExpExecArray | null;
  while ((li = liRe.exec(html)) !== null) {
    const block = li[1];
    const strong = /<strong\b[^>]*>([\s\S]*?)<\/strong>/i.exec(block);
    if (!strong) continue;
    const label = normalizeLabel(stripTags(strong[1]));
    if (label.length === 0) continue;
    const values = detailValues(block, strong[1]);
    if (values.length === 0) continue;
    details[label] = dedupeStrings([...(details[label] ?? []), ...values]);
  }

  const titles = dedupeStrings([...headings, ...(details["associated name(s)"] ?? [])]);
  const title = titles[0] ?? "";
  const image = metaContent(html, "og:image") ?? "";
  const description = firstParagraph(html, "Description");
  const status = firstOf(details, ["status"]);
  const author = (details["author(s)"] ?? []).join(", ");
  const year = yearOf(firstOf(details, ["released", "year"]));
  const tags = dedupeStrings(details["tags(s)"] ?? details["tag(s)"] ?? []);

  return {
    mangaId,
    title: title.length > 0 ? title : mangaId,
    titles: titles.length > 0 ? titles : [mangaId],
    image,
    description,
    status,
    author,
    year,
    tags,
  };
}

/** Libellé normalisé : minuscules, sans « : » final ni espaces parasites. */
function normalizeLabel(label: string): string {
  return label.replace(/[:：]\s*$/, "").trim().toLowerCase();
}

/** Valeurs textuelles d'une ligne `<li><strong>Label</strong> …</li>`. */
function detailValues(block: string, labelHtml: string): string[] {
  const afterLabel = block.slice(block.indexOf(labelHtml) + labelHtml.length);

  // 1) Liens (`Author(s)`, `Tags(s)`, `Status`, `Type`…).
  const anchors: string[] = [];
  const anchorRe = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  let anchor: RegExpExecArray | null;
  while ((anchor = anchorRe.exec(afterLabel)) !== null) {
    const text = cleanValue(stripTags(anchor[1]));
    if (text.length > 0) anchors.push(text);
  }
  if (anchors.length > 0) return anchors;

  // 2) `<span>` (`Released:` -> 2021).
  const spans: string[] = [];
  const spanRe = /<span\b[^>]*>([\s\S]*?)<\/span>/gi;
  let span: RegExpExecArray | null;
  while ((span = spanRe.exec(afterLabel)) !== null) {
    const text = cleanValue(stripTags(span[1]));
    if (text.length > 0) spans.push(text);
  }
  if (spans.length > 0) return spans;

  // 3) Texte brut restant.
  const raw = cleanValue(stripTags(afterLabel));
  return raw.length > 0 ? [raw] : [];
}

/** Retire les virgules/espaces parasites d'une valeur de liste. */
function cleanValue(value: string): string {
  return value.replace(/^[\s,;·]+/, "").replace(/[\s,;·]+$/, "").trim();
}

/** Première valeur présente parmi plusieurs libellés possibles. */
function firstOf(details: Record<string, string[]>, labels: string[]): string {
  for (const label of labels) {
    const values = details[label];
    if (values && values.length > 0) return values[0];
  }
  return "";
}

/** Année à 4 chiffres d'une valeur `Released:`. */
function yearOf(value: string): number | undefined {
  const match = /(1[89]\d{2}|20\d{2})/.exec(value ?? "");
  if (!match) return undefined;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Contenu d'un `<meta property="…">` (ex. `og:image`). */
export function metaContent(html: string, property: string): string | undefined {
  const metaRe = /<meta\b[^>]*>/gi;
  let meta: RegExpExecArray | null;
  while ((meta = metaRe.exec(html)) !== null) {
    const tag = meta[0];
    const key = attributeOf(tag, "property") ?? attributeOf(tag, "name") ?? "";
    if (key.toLowerCase() === property.toLowerCase()) {
      const content = attributeOf(tag, "content");
      if (content && content.trim().length > 0) return content.trim();
    }
  }
  return undefined;
}

/** Paragraphe `<p>` d'une ligne `<strong>Label</strong>` (ex. `Description`). */
function firstParagraph(html: string, label: string): string {
  const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let li: RegExpExecArray | null;
  while ((li = liRe.exec(html)) !== null) {
    const strong = /<strong\b[^>]*>([\s\S]*?)<\/strong>/i.exec(li[1]);
    if (!strong) continue;
    if (normalizeLabel(stripTags(strong[1])) !== label.toLowerCase()) continue;
    const paragraph = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(li[1]);
    if (paragraph) {
      const text = stripTags(paragraph[1]);
      if (text.length > 0) return text;
    }
  }
  return "";
}

/**
 * Analyse `/series/<ULID>/full-chapter-list`.
 * `chapterId` = ULID du lien (jamais le numéro), `name` = libellé complet,
 * `chapNum` = nombre terminal du libellé, `time` = date ISO de `<time>`.
 * Tri par `chapNum` croissant, départage déterministe par `chapterId`.
 */
export function parseChapterList(fragment: string): WCChapterEntry[] {
  const entries: WCChapterEntry[] = [];
  const anchorRe = /<a\b[^>]*href="([^"]*\/chapters\/([0-9A-Za-z]{26})(?:[/"'?#]|$)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let anchor: RegExpExecArray | null;
  while ((anchor = anchorRe.exec(fragment)) !== null) {
    const chapterId = anchor[2];
    const block = anchor[3];
    const name = chapterName(block, chapterId);
    const timeTag = /<time\b[^>]*>/i.exec(block);
    const time = timeTag ? parseSiteDate(attributeOf(timeTag[0], "datetime")) : undefined;
    entries.push({ chapterId, name, chapNum: chapterNumberOf(name), time });
  }

  return dedupeByKey(entries, (entry) => entry.chapterId).sort((a, b) => {
    const diff = a.chapNum - b.chapNum;
    if (diff !== 0) return diff;
    return a.chapterId < b.chapterId ? -1 : a.chapterId > b.chapterId ? 1 : 0;
  });
}

/** Libellé d'un chapitre : premier `<span>` du bloc `span.grow`, sinon repli. */
function chapterName(block: string, chapterId: string): string {
  const grow = /<span\b[^>]*class="[^"]*grow[^"]*"[^>]*>\s*<span\b[^>]*>([\s\S]*?)<\/span>/i.exec(block);
  if (grow) {
    const text = stripTags(grow[1]);
    if (text.length > 0) return text;
  }
  const emptyClass = /<span\b[^>]*class=""[^>]*>([\s\S]*?)<\/span>/i.exec(block);
  if (emptyClass) {
    const text = stripTags(emptyClass[1]);
    if (text.length > 0) return text;
  }
  return chapterId;
}

/**
 * Analyse `/chapters/<ULID>/images` : URLs absolues http(s) des `<img>` de
 * `#chapter-images`, dans l'ordre du document, dédoublonnées. Repli si la
 * section est absente : `<img>` dont le `src` contient `/manga/`.
 * Seul l'attribut `src` est lu : `onerror="/static/images/broken_image.jpg"`
 * n'est PAS une page.
 */
export function parseChapterImages(fragment: string): string[] {
  if (typeof fragment !== "string" || fragment.length === 0) return [];

  let scope = fragment;
  let scoped = false;
  const idIndex = fragment.search(/id="chapter-images"/i);
  if (idIndex >= 0) {
    const start = fragment.lastIndexOf("<section", idIndex);
    const end = fragment.indexOf("</section>", idIndex);
    scope = fragment.slice(start >= 0 ? start : idIndex, end >= 0 ? end : fragment.length);
    scoped = true;
  }

  const pages: string[] = [];
  const imgRe = /<img\b[^>]*>/gi;
  let img: RegExpExecArray | null;
  while ((img = imgRe.exec(scope)) !== null) {
    const src = attributeOf(img[0], "src") ?? "";
    if (!/^https?:\/\//i.test(src)) continue;
    if (!scoped && !/\/manga\//i.test(src)) continue;
    pages.push(src);
  }
  return dedupeStrings(pages);
}

/* ------------------------------------------------------------------ */
/* Erreurs — messages explicites, sans aucun contournement             */
/* ------------------------------------------------------------------ */

/** 403 : contrôle d'accès du site. Aucun contournement n'est tenté. */
export function accessDeniedError(url: string): Error {
  return new Error(
    `HTTP 403 : weebcentral.com a refusé la requête (${url}). ` +
      `La source envoie pourtant un User-Agent navigateur ; le site renforce peut-être sa protection. ` +
      `Aucun contournement de protection n'est effectué (pas de résolution de challenge, pas de rotation d'IP, pas de rafale de requêtes). ` +
      `Réessaie plus tard depuis l'application.`,
  );
}

/** 404 : ressource introuvable. */
export function notFoundError(what: string): Error {
  return new Error(`Introuvable sur weebcentral.com : ${what}.`);
}

/** Autre statut HTTP inattendu. */
export function httpStatusError(status: number, url: string): Error {
  return new Error(`HTTP ${status} : réponse inattendue de weebcentral.com (${url}).`);
}

/** Erreur réseau / exception de transport. */
export function networkError(detail: string, url: string): Error {
  return new Error(`Erreur réseau en contactant weebcentral.com (${url}) : ${detail}`);
}

/** Corps vide : on refuse d'analyser une réponse sans contenu. */
export function emptyBodyError(url: string): Error {
  return new Error(
    `Réponse vide reçue de weebcentral.com (${url}) : aucun HTML exploitable. ` +
      `Le site a peut-être renvoyé une page de blocage ou une erreur silencieuse.`,
  );
}

/** Chapitre sans aucune page exploitable. */
export function noPagesError(chapterId: string): Error {
  return new Error(`Aucune page n'a été trouvée pour le chapitre ${chapterId} sur weebcentral.com.`);
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
