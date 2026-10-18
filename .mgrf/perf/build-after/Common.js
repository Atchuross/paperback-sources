"use strict";
/**
 * Fanfox — helpers purs (Common).
 *
 * RÈGLE ABSOLUE : ce fichier ne référence JAMAIS le global `App` du runtime
 * Paperback, et n'importe RIEN au runtime (les contrats `@paperback/types` sont
 * importés en `import type`, donc entièrement effacés à la compilation). Il
 * reste donc importable et testable en Node pur (`tmp/Fanfox/Common.js`) et ne
 * charge jamais `cheerio`.
 *
 * Contrainte mesurée le 2026-10-18 (harnais local, toolchain 0.8.7, cheerio
 * 1.2.0) : `new Source(cheerio)` reçoit en réalité `undefined` — le toolchain
 * fait `__importDefault(require("cheerio")).default` alors que cheerio 1.x
 * déclare `__esModule: true` sans export `default`. Un parseur qui appellerait
 * `this.cheerio(html)` lèverait donc `this.cheerio is not a function` dans
 * `paperback test`. Tous les parseurs ci-dessous sont donc **purs (texte)**.
 *
 * ------------------------------------------------------------------------
 * Déballage du « packer » — parseur PUR, SANS `eval` ni `new Function`
 * ------------------------------------------------------------------------
 * Les pages de fanfox.net embarquent des scripts au format « packer » de Dean
 * Edwards (`eval(function(p,a,c,k,e,d){…}('<charge>',<base>,<nb>,'<dict>'
 * .split('|'),0,{}))`). C'est le mécanisme PUBLIC du lecteur du site : le script
 * `chapter_h.js` du site fait lui-même `eval(msg)` sur la réponse de
 * `chapterfun.ashx` (mesuré le 2026-10-18). Il s'agit d'une obfuscation
 * triviale, PAS d'une cryptographie, PAS d'un contournement d'authentification
 * ni de protection d'accès : la page est publique et le corps est du JavaScript
 * que le navigateur doit exécuter.
 *
 * Sur un appareil (iOS/JS), on refuse d'exécuter du code distant
 * (`eval`/`Function` interdits par conception dans cette source) : la charge
 * utile est donc **déballée par un parseur de texte** (`findPackerCalls` /
 * `unpackPackerCall`), qui reproduit exactement l'algorithme public du packer
 * (`e(c)` = nom du jeton en base `a`, remplacement `\b<jeton>\b` de `c-1` à `0`).
 *
 * ------------------------------------------------------------------------
 * Referer — mesuré le 2026-10-18
 * ------------------------------------------------------------------------
 * Le CDN d'images (hôtes variables, observés dans `var pix`) répond **403 sans
 * Referer** et
 * **200 image/jpeg** avec un Referer dont l'hôte est `fanfox.net` (n'importe
 * quelle URL `fanfox.net`, y compris `https://fanfox.net/`). `FanfoxInterceptor`
 * pose donc un Referer statique `https://fanfox.net/` sur toute requête qui n'en
 * a pas déjà un, et le User-Agent navigateur sous les deux casses.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeJsStringLiteral = exports.packerTokenName = exports.chapterNumberOf = exports.parseSiteDateUtc = exports.mapWithConcurrency = exports.escapeRegExp = exports.isBlank = exports.dedupeByKey = exports.dedupeStrings = exports.imageTags = exports.anchorTags = exports.classText = exports.classHtml = exports.attributeOf = exports.stripTagsKeepLines = exports.stripTags = exports.decodeEntities = exports.resolveCdnUrl = exports.absoluteUrl = exports.chapterFunUrl = exports.chapterReaderUrl = exports.mangaShareUrl = exports.trendingUrl = exports.releasesUrl = exports.seriesUrl = exports.chapterPath = exports.searchUrl = exports.encodeQuery = exports.hasHeader = exports.FanfoxInterceptor = exports.DEFAULT_REFERER = exports.REFERER_HEADER_LOWER = exports.REFERER_HEADER = exports.USER_AGENT_HEADER_LOWER = exports.USER_AGENT_HEADER = exports.BROWSER_USER_AGENT = exports.TILE_COVER_CLASS_LIST1 = exports.TILE_TITLE_CLASS_LIST1 = exports.TILE_COVER_CLASS_LIST4 = exports.TILE_TITLE_CLASS_LIST4 = exports.HOME_SECTION_TRENDING = exports.HOME_SECTION_LATEST = exports.TRENDING_PATH = exports.RELEASES_PATH = exports.CHAPTER_PAGE_CONCURRENCY = exports.CHAPTER_FUN_FILE = exports.LANG_CODE = exports.SEARCH_PAGE_SIZE = exports.SEARCH_PATH = exports.BASE_URL = void 0;
exports.errorMessageOf = exports.httpStatusFromError = exports.noPagesError = exports.missingChapterIdError = exports.missingChapterKeyError = exports.chapterFunParseError = exports.emptyChapterFunError = exports.emptyBodyError = exports.networkError = exports.httpStatusError = exports.notFoundError = exports.accessDeniedError = exports.parseChapterImageResponse = exports.parseReaderMeta = exports.guidKeyOfScript = exports.inputValueById = exports.parseChapterList = exports.parseSeriesDetails = exports.parseMangaList1Tiles = exports.parseReleaseTiles = exports.parseSearchTiles = exports.parseTiles = exports.parseSearchResults = exports.mangaIdFromHref = exports.unpackPacked = exports.unpackPackedScripts = exports.unpackPackerCall = exports.findPackerCalls = void 0;
/* ------------------------------------------------------------------ */
/* Constantes d'accès au site                                          */
/* ------------------------------------------------------------------ */
/** URL de base. Aucune autre hôte n'est codée en dur (les CDN sont tournants). */
exports.BASE_URL = "https://fanfox.net";
/** Endpoint de recherche (HTML, 12 tuiles par page, `page` 1-indexé). */
exports.SEARCH_PATH = "/search";
/** Nombre de tuiles par page de recherche (mesuré : 12 sur `/search?title=naruto`). */
exports.SEARCH_PAGE_SIZE = 12;
/** Le site est anglophone. */
exports.LANG_CODE = "en";
/** Chemin de l'endpoint des pages de chapitre, relatif au dossier du chapitre. */
exports.CHAPTER_FUN_FILE = "chapterfun.ashx";
/**
 * Concurrence BORNÉE des appels `chapterfun.ashx` d'un même chapitre.
 *
 * Mesuré le 2026-10-18 (harnais `.mgrf/perf/harness.js`, `requestsPerSecond` du
 * manager modélisé) : la boucle séquentielle coûtait exactement `1 + imagecount`
 * intervalles de débit (18 172 ms pour 18 pages, 46 225 ms pour 46 pages à
 * 1 req/s). Les appels sont indépendants les uns des autres : les émettre par
 * vagues bornées ne change NI les URLs obtenues NI leur ordre (les résultats
 * sont replacés par index de page, jamais dans l'ordre d'arrivée), mais ramène
 * la durée à `(1 + imagecount) / requestsPerSecond`.
 *
 * Valeur volontairement MODÉRÉE (5 requêtes en vol au maximum, jamais une
 * rafale non bornée) : au plus 5 connexions simultanées vers fanfox.net.
 */
exports.CHAPTER_PAGE_CONCURRENCY = 5;
/**
 * Page publique « Lastest Updates » (lien « more » du bloc d'accueil) :
 * 21 tuiles `manga-list-4`, AUCUNE pagination (`?page=2` renvoie la même liste).
 */
exports.RELEASES_PATH = "/releases/";
/**
 * Page publique « Trending Manga » : 28 tuiles `manga-list-1` (2 listes de 14),
 * AUCUNE pagination mesurée.
 */
exports.TRENDING_PATH = "/trending/";
/** Sections d'accueil publiées par la source (identifiants stables). */
exports.HOME_SECTION_LATEST = "latest_updates";
exports.HOME_SECTION_TRENDING = "trending";
/** Classes des tuiles `manga-list-4` (`/search`, `/releases/`, accueil). */
exports.TILE_TITLE_CLASS_LIST4 = "manga-list-4-item-title";
exports.TILE_COVER_CLASS_LIST4 = "manga-list-4-cover";
/** Classes des tuiles `manga-list-1` (`/trending/`, bloc « Hot Manga Releases »). */
exports.TILE_TITLE_CLASS_LIST1 = "manga-list-1-item-title";
exports.TILE_COVER_CLASS_LIST1 = "manga-list-1-cover";
/** User-Agent navigateur (aucune rotation, aucun contournement de protection). */
exports.BROWSER_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
/** Clé canonique de l'en-tête (casse HTTP standard). */
exports.USER_AGENT_HEADER = "User-Agent";
/**
 * Clé minuscule : le runtime Paperback lit `headers["user-agent"]` pour décider
 * s'il doit injecter son User-Agent par défaut. On pose donc la même valeur sous
 * les deux casses (aucun en-tête réellement dupliqué).
 */
exports.USER_AGENT_HEADER_LOWER = "user-agent";
/** En-tête `Referer` — exigé par le CDN d'images et par `chapterfun.ashx`. */
exports.REFERER_HEADER = "Referer";
/** Même valeur sous la casse minuscule (le runtime lit les deux casses). */
exports.REFERER_HEADER_LOWER = "referer";
/** Referer par défaut : n'importe quelle URL `fanfox.net` satisfait le contrôle. */
exports.DEFAULT_REFERER = "https://fanfox.net/";
/**
 * Interceptor pur : User-Agent navigateur (deux casses) + Referer par défaut
 * (uniquement si la requête n'en porte pas déjà un).
 *
 * CORRECTIF (incident `t_cb49ff66`) : `interceptRequest` MUTE `request.headers`
 * en place et renvoie LE MÊME objet `Request` — renvoyer une copie fait lever
 * `MethodInvalidReturnTypeError [PaperbackError(303)]` à chaque requête.
 */
class FanfoxInterceptor {
    async interceptRequest(request) {
        const headers = request.headers ?? {};
        headers[exports.USER_AGENT_HEADER] = exports.BROWSER_USER_AGENT;
        headers[exports.USER_AGENT_HEADER_LOWER] = exports.BROWSER_USER_AGENT;
        if (!hasHeader(headers, exports.REFERER_HEADER)) {
            headers[exports.REFERER_HEADER] = exports.DEFAULT_REFERER;
            headers[exports.REFERER_HEADER_LOWER] = exports.DEFAULT_REFERER;
        }
        request.headers = headers;
        return request;
    }
    async interceptResponse(response) {
        return response;
    }
}
exports.FanfoxInterceptor = FanfoxInterceptor;
/** Vrai si l'en-tête est présent, quelle que soit sa casse. */
function hasHeader(headers, name) {
    if (headers === null || typeof headers !== "object")
        return false;
    const target = name.toLowerCase();
    for (const key of Object.keys(headers)) {
        if (key.toLowerCase() !== target)
            continue;
        const value = headers[key];
        if (typeof value === "string" && value.trim().length > 0)
            return true;
    }
    return false;
}
exports.hasHeader = hasHeader;
/* ------------------------------------------------------------------ */
/* Construction d'URL                                                  */
/* ------------------------------------------------------------------ */
/** Échappement d'une requête : le site attend `+` pour les espaces. */
function encodeQuery(query) {
    return encodeURIComponent(typeof query === "string" ? query : "").replace(/%20/g, "+");
}
exports.encodeQuery = encodeQuery;
/**
 * `GET /search?title=<q>&page=<n>` — `page` est 1-indexé (`page=1` = défaut).
 * Une page au-delà du dernier résultat renvoie 200 avec 0 tuile (jamais d'erreur).
 */
function searchUrl(query, page) {
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    return `${exports.BASE_URL}${exports.SEARCH_PATH}?title=${encodeQuery(query)}&page=${safePage}`;
}
exports.searchUrl = searchUrl;
/** Segments de chemin d'un `chapterId` (`vTBE/c1196`), chaque segment échappé. */
function chapterPath(chapterId) {
    const raw = typeof chapterId === "string" ? chapterId : "";
    return raw
        .split("/")
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0)
        .map((segment) => encodeURIComponent(segment))
        .join("/");
}
exports.chapterPath = chapterPath;
/** `GET /manga/<slug>/` — fiche série (et liste des chapitres, même page). */
function seriesUrl(mangaId) {
    return `${exports.BASE_URL}/manga/${encodeURIComponent(mangaId)}/`;
}
exports.seriesUrl = seriesUrl;
/** `GET /releases/` — dernières sorties (« Lastest Updates »), 21 tuiles. */
function releasesUrl() {
    return `${exports.BASE_URL}${exports.RELEASES_PATH}`;
}
exports.releasesUrl = releasesUrl;
/** `GET /trending/` — séries tendance, 28 tuiles. */
function trendingUrl() {
    return `${exports.BASE_URL}${exports.TRENDING_PATH}`;
}
exports.trendingUrl = trendingUrl;
/** Lien de partage web d'une fiche série. */
function mangaShareUrl(mangaId) {
    return seriesUrl(mangaId);
}
exports.mangaShareUrl = mangaShareUrl;
/** `GET /manga/<slug>/<chapterId>/<page>.html` — `page` 1-indexé. */
function chapterReaderUrl(mangaId, chapterId, page = 1) {
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    return `${seriesUrl(mangaId)}${chapterPath(chapterId)}/${safePage}.html`;
}
exports.chapterReaderUrl = chapterReaderUrl;
/**
 * `GET /manga/<slug>/<chapterId>/chapterfun.ashx?cid=<id>&page=<n>&key=<guidkey>`
 * — `cid` est l'identifiant numérique `var chapterid` de la page de lecture.
 */
function chapterFunUrl(mangaId, chapterId, chapterNumericId, page, guidKey) {
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const params = [
        `cid=${encodeURIComponent(chapterNumericId)}`,
        `page=${safePage}`,
        `key=${encodeURIComponent(guidKey)}`,
    ].join("&");
    return `${seriesUrl(mangaId)}${chapterPath(chapterId)}/${exports.CHAPTER_FUN_FILE}?${params}`;
}
exports.chapterFunUrl = chapterFunUrl;
/** Préfixe `BASE_URL` à un lien relatif ; laisse les URLs absolues intactes. */
function absoluteUrl(href) {
    const value = typeof href === "string" ? href.trim() : "";
    if (value.length === 0)
        return "";
    if (/^https?:\/\//i.test(value))
        return value;
    if (value.startsWith("//"))
        return `https:${value}`;
    return value.startsWith("/") ? `${exports.BASE_URL}${value}` : `${exports.BASE_URL}/${value}`;
}
exports.absoluteUrl = absoluteUrl;
/**
 * Reconstitue l'URL d'une image à partir du préfixe `var pix` et du chemin
 * `pvalue[0]` renvoyés par le site. Les deux sont généralement
 * protocole-relatifs (`//<hôte-cdn>/…`) : on préfixe alors `https:`.
 * Aucun hôte CDN n'est codé en dur.
 */
function resolveCdnUrl(hostBase, relative) {
    const base = typeof hostBase === "string" ? hostBase.trim() : "";
    const path = typeof relative === "string" ? relative.trim() : "";
    if (path.length === 0)
        return "";
    if (/^https?:\/\//i.test(path))
        return path;
    const joined = path.startsWith("//") ? path : `${base}${path}`;
    if (joined.startsWith("//"))
        return `https:${joined}`;
    if (/^https?:\/\//i.test(joined))
        return joined;
    // Ni absolu ni protocole-relatif : on ne peut pas reconstituer d'URL valide.
    return "";
}
exports.resolveCdnUrl = resolveCdnUrl;
/* ------------------------------------------------------------------ */
/* Helpers texte                                                       */
/* ------------------------------------------------------------------ */
/** Entités HTML usuelles (les entités numériques sont traitées à part). */
const NAMED_ENTITIES = {
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
function decodeEntities(value) {
    if (typeof value !== "string" || value.length === 0)
        return "";
    return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, code) => {
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
exports.decodeEntities = decodeEntities;
/** Retire les balises, décode les entités et normalise les espaces. */
function stripTags(html) {
    if (typeof html !== "string" || html.length === 0)
        return "";
    return decodeEntities(html.replace(/<[^>]*>/g, " "))
        .replace(/[\u00a0\s]+/g, " ")
        .trim();
}
exports.stripTags = stripTags;
/**
 * Comme `stripTags`, mais conserve les sauts de ligne du synopsis
 * (`\r\n\r\n` sépare les paragraphes) tout en écrasant les espaces multiples.
 */
function stripTagsKeepLines(html) {
    if (typeof html !== "string" || html.length === 0)
        return "";
    return decodeEntities(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, " "))
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t\u00a0\f]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
exports.stripTagsKeepLines = stripTagsKeepLines;
/** Valeur d'un attribut d'une balise ouvrante (`src`, `alt`, `href`, `title`…). */
function attributeOf(tag, name) {
    if (typeof tag !== "string" || tag.length === 0)
        return undefined;
    const doubleQuoted = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag);
    if (doubleQuoted)
        return decodeEntities(doubleQuoted[1]);
    const singleQuoted = new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i").exec(tag);
    if (singleQuoted)
        return decodeEntities(singleQuoted[1]);
    return undefined;
}
exports.attributeOf = attributeOf;
/**
 * Contenu HTML du premier élément `<tag class="… <className> …">`.
 * `""` si l'élément est absent. Ne gère pas les éléments imbriqués du même nom
 * (inutile ici : tous les conteneurs exploités sont des `<p>`/`<span>` feuilles
 * ou ne contiennent que des `<a>`/`<img>`).
 */
function classHtml(html, tag, className) {
    if (typeof html !== "string" || html.length === 0)
        return "";
    const re = new RegExp(`<${tag}\\b[^>]*\\bclass\\s*=\\s*"[^"]*\\b${escapeRegExp(className)}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
    const match = re.exec(html);
    return match ? match[1] : "";
}
exports.classHtml = classHtml;
/** Texte de l'élément `<tag class="… <className> …">` (balises retirées). */
function classText(html, tag, className) {
    return stripTags(classHtml(html, tag, className));
}
exports.classText = classText;
/** Toutes les balises `<a …>` d'un fragment, dans l'ordre du document. */
function anchorTags(fragment) {
    return (fragment ?? "").match(/<a\b[^>]*>/gi) ?? [];
}
exports.anchorTags = anchorTags;
/** Toutes les balises `<img …>` d'un fragment, dans l'ordre du document. */
function imageTags(fragment) {
    return (fragment ?? "").match(/<img\b[^>]*>/gi) ?? [];
}
exports.imageTags = imageTags;
/** Retire les doublons (et les valeurs vides) d'une liste de chaînes. */
function dedupeStrings(values) {
    const seen = new Set();
    const out = [];
    for (const value of values) {
        if (typeof value !== "string")
            continue;
        const trimmed = value.trim();
        if (trimmed.length === 0 || seen.has(trimmed))
            continue;
        seen.add(trimmed);
        out.push(trimmed);
    }
    return out;
}
exports.dedupeStrings = dedupeStrings;
/** Retire les doublons d'une liste d'objets d'après une clé textuelle. */
function dedupeByKey(items, keyOf) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
        const key = keyOf(item);
        if (key.length === 0 || seen.has(key))
            continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}
exports.dedupeByKey = dedupeByKey;
/** Vrai si le corps est vide ou composé d'espaces uniquement. */
function isBlank(value) {
    return typeof value !== "string" || value.trim().length === 0;
}
exports.isBlank = isBlank;
/** Échappe une chaîne pour l'utiliser comme littéral dans un `RegExp`. */
function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
exports.escapeRegExp = escapeRegExp;
/* ------------------------------------------------------------------ */
/* Exécution bornée (parallélisation contrôlée)                        */
/* ------------------------------------------------------------------ */
/**
 * Applique `worker` aux indices `0..count-1` avec AU PLUS `limit` tâches en vol
 * simultanément, et renvoie les résultats **dans l'ordre des indices** (jamais
 * dans l'ordre d'arrivée) : l'ordre de sortie est donc strictement celui de la
 * boucle séquentielle équivalente.
 *
 * Le pool reste BORNÉ (aucune rafale : le nombre de requêtes en vol ne dépasse
 * jamais `limit`), et la première erreur est propagée telle quelle — soit
 * exactement le comportement de la boucle `for` séquentielle.
 *
 * Fonction pure : aucun accès au global `App`, aucun import runtime ⇒ testable
 * en Node pur.
 */
async function mapWithConcurrency(count, limit, worker) {
    const total = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
    const inFlight = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1;
    const results = new Array(total);
    let next = 0;
    const run = async () => {
        for (;;) {
            const index = next;
            next += 1;
            if (index >= total)
                return;
            // Les tâches partagent le compteur `next` : chacune prend l'index suivant
            // tant qu'il en reste, ce qui borne naturellement les tâches en vol.
            results[index] = await worker(index);
        }
    };
    const runners = [];
    for (let started = 0; started < Math.min(inFlight, total); started += 1) {
        runners.push(run());
    }
    await Promise.all(runners);
    return results;
}
exports.mapWithConcurrency = mapWithConcurrency;
/* ------------------------------------------------------------------ */
/* Dates et numéros de chapitre                                        */
/* ------------------------------------------------------------------ */
/** Mois anglais du site (`Oct 16,2026`). */
const MONTHS = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
};
/**
 * Parse une date du site (`Oct 16,2026 `) **explicitement en UTC**.
 *
 * Mesuré : `new Date("Oct 16,2026")` est interprété dans le fuseau local et
 * donne `2026-10-15T22:00:00Z` en CEST, soit un décalage d'un jour.
 * Ici : `Date.UTC(2026, 9, 16)`.
 */
function parseSiteDateUtc(value) {
    if (typeof value !== "string")
        return undefined;
    const normalized = value.replace(/[\u00a0\s]+/g, " ").trim();
    const match = /^([A-Za-z]{3})[A-Za-z]*\.? (\d{1,2}), ?(\d{4})$/.exec(normalized);
    if (!match)
        return undefined;
    const month = MONTHS[match[1].toLowerCase()];
    if (month === undefined)
        return undefined;
    const day = Number.parseInt(match[2], 10);
    const year = Number.parseInt(match[3], 10);
    if (!Number.isFinite(day) || !Number.isFinite(year) || day < 1 || day > 31)
        return undefined;
    const date = new Date(Date.UTC(year, month, day));
    return Number.isNaN(date.getTime()) ? undefined : date;
}
exports.parseSiteDateUtc = parseSiteDateUtc;
/**
 * Numéro d'un libellé de chapitre (`Ch.1046.5`, `Vol.TBE Ch.1196`,
 * `Vol.01 Ch.001 - Romance Dawn`).
 *
 * Le numéro vient TOUJOURS du libellé du site, jamais du rang d'affichage.
 * Mesuré le 2026-10-18 : 861 des 1 232 libellés de `one_piece` portent un
 * sous-titre APRÈS le numéro (`Vol.01 Ch.001 - Romance Dawn`) — un simple
 * « nombre terminal » donnerait 0. On privilégie donc le motif explicite
 * `Ch.<num>` et on ne retombe sur le nombre terminal qu'en son absence.
 * `0` si aucun nombre exploitable.
 */
function chapterNumberOf(label) {
    if (typeof label !== "string")
        return 0;
    const normalized = label.replace(/[\u00a0\s]+/g, " ").trim();
    const tagged = /\bCh\.\s*(\d+(?:\.\d+)?)/i.exec(normalized);
    const candidate = tagged ? tagged[1] : (/(\d+(?:\.\d+)?)\s*$/.exec(normalized) ?? [])[1];
    if (!candidate)
        return 0;
    const parsed = Number.parseFloat(candidate);
    return Number.isFinite(parsed) ? parsed : 0;
}
exports.chapterNumberOf = chapterNumberOf;
/* ------------------------------------------------------------------ */
/* Déballage du packer (PUR — aucun eval, aucun new Function)          */
/* ------------------------------------------------------------------ */
/** Marqueur d'appel du packer de Dean Edwards. */
const PACKER_MARKER = "eval(function(p,a,c,k,e,d){";
/**
 * Nom du jeton `n` en base `base`, exactement comme la fonction `e` du packer :
 * `(n < base ? "" : e(n / base)) + (n % base > 35 ? fromCharCode(n % base + 29)
 * : (n % base).toString(36))`.
 */
function packerTokenName(value, base) {
    const safeBase = Number.isFinite(base) && base > 1 ? Math.floor(base) : 62;
    const remainder = value % safeBase;
    const head = value < safeBase ? "" : packerTokenName(Math.floor(value / safeBase), safeBase);
    const tail = remainder > 35 ? String.fromCharCode(remainder + 29) : remainder.toString(36);
    return head + tail;
}
exports.packerTokenName = packerTokenName;
/**
 * Décode une séquence d'échappement JS à la position `index` (qui pointe sur le
 * `\`) et renvoie le texte décodé + l'index suivant.
 */
function decodeEscapeAt(source, index) {
    const marker = source[index + 1];
    if (marker === undefined)
        return { text: "\\", next: index + 1 };
    switch (marker) {
        case "n":
            return { text: "\n", next: index + 2 };
        case "r":
            return { text: "\r", next: index + 2 };
        case "t":
            return { text: "\t", next: index + 2 };
        case "b":
            return { text: "\b", next: index + 2 };
        case "f":
            return { text: "\f", next: index + 2 };
        case "v":
            return { text: "\v", next: index + 2 };
        case "0":
            return { text: "\0", next: index + 2 };
        case "x": {
            const hex = source.slice(index + 2, index + 4);
            const code = /^[0-9a-fA-F]{2}$/.test(hex) ? Number.parseInt(hex, 16) : Number.NaN;
            return Number.isFinite(code)
                ? { text: String.fromCharCode(code), next: index + 4 }
                : { text: "x", next: index + 2 };
        }
        case "u": {
            const hex = source.slice(index + 2, index + 6);
            const code = /^[0-9a-fA-F]{4}$/.test(hex) ? Number.parseInt(hex, 16) : Number.NaN;
            return Number.isFinite(code)
                ? { text: String.fromCharCode(code), next: index + 6 }
                : { text: "u", next: index + 2 };
        }
        default:
            return { text: marker, next: index + 2 };
    }
}
/** Décode les séquences d'échappement d'un littéral de chaîne JS déjà extrait. */
function decodeJsStringLiteral(raw) {
    let out = "";
    let index = 0;
    while (index < raw.length) {
        const char = raw[index];
        if (char !== "\\") {
            out += char;
            index += 1;
            continue;
        }
        const decoded = decodeEscapeAt(raw, index);
        out += decoded.text;
        index = decoded.next;
    }
    return out;
}
exports.decodeJsStringLiteral = decodeJsStringLiteral;
/**
 * Localise tous les blocs `eval(function(p,a,c,k,e,d){…}('<charge>',base,count,
 * '<dict>'.split('|'),0,{}))` d'un texte et renvoie leurs arguments parsés.
 * Aucune exécution : lecture de texte uniquement.
 */
function findPackerCalls(source) {
    if (typeof source !== "string" || source.length === 0)
        return [];
    const calls = [];
    let cursor = 0;
    while (cursor < source.length) {
        const start = source.indexOf(PACKER_MARKER, cursor);
        if (start < 0)
            break;
        const callStart = source.indexOf("}(", start);
        if (callStart < 0)
            break;
        let index = callStart + 2;
        if (source[index] !== "'") {
            cursor = callStart + 2;
            continue;
        }
        index += 1;
        let payload = "";
        let closed = false;
        while (index < source.length) {
            if (source[index] === "\\") {
                const decoded = decodeEscapeAt(source, index);
                payload += decoded.text;
                index = decoded.next;
                continue;
            }
            if (source[index] === "'") {
                index += 1;
                closed = true;
                break;
            }
            payload += source[index];
            index += 1;
        }
        if (!closed)
            break;
        const tail = source.slice(index, index + 16384);
        const match = /^,(\d+),(\d+),'((?:[^'\\]|\\.)*)'\.split\('\|'\),0,\{\}\)/.exec(tail);
        if (!match) {
            cursor = index;
            continue;
        }
        calls.push({
            base: Number.parseInt(match[1], 10),
            count: Number.parseInt(match[2], 10),
            keys: match[3].split("|").map((key) => decodeJsStringLiteral(key)),
            payload,
        });
        cursor = index + match[0].length;
    }
    return calls;
}
exports.findPackerCalls = findPackerCalls;
/**
 * Déballe un appel du packer : remplace, de `count - 1` à `0`, le jeton
 * `packerTokenName(i, base)` par `keys[i]` (uniquement si la clé est non vide),
 * avec les mêmes bornes de mot (`\b`) que le packer d'origine.
 */
function unpackPackerCall(call) {
    if (!call || typeof call.payload !== "string")
        return "";
    let out = call.payload;
    const count = Number.isFinite(call.count) ? call.count : 0;
    for (let index = count - 1; index >= 0; index -= 1) {
        const replacement = call.keys[index];
        if (typeof replacement !== "string" || replacement.length === 0)
            continue;
        const token = escapeRegExp(packerTokenName(index, call.base));
        out = out.replace(new RegExp(`\\b${token}\\b`, "g"), () => replacement);
    }
    return out;
}
exports.unpackPackerCall = unpackPackerCall;
/** Déballe tous les blocs packés d'un texte (ordre du document). */
function unpackPackedScripts(source) {
    return findPackerCalls(source).map((call) => unpackPackerCall(call));
}
exports.unpackPackedScripts = unpackPackedScripts;
/**
 * Déballe le premier bloc packé d'un texte ; renvoie le texte d'origine s'il
 * n'y a aucun bloc packé (une réponse peut déjà être du JS clair).
 */
function unpackPacked(source) {
    const unpacked = unpackPackedScripts(source);
    return unpacked.length > 0 ? unpacked[0] : typeof source === "string" ? source : "";
}
exports.unpackPacked = unpackPacked;
/* ------------------------------------------------------------------ */
/* Parseurs publics (purs, testables hors runtime)                     */
/* ------------------------------------------------------------------ */
/**
 * `mangaId` (slug) d'un `href` de fiche : `/manga/<slug>/` ou
 * `https://fanfox.net/manga/<slug>/`. `undefined` pour tout autre lien
 * (chapitre `…/c001/1.html`, auteur, genre, recommandation d'une autre série).
 */
function mangaIdFromHref(href) {
    const value = typeof href === "string" ? href.trim() : "";
    if (value.length === 0)
        return undefined;
    const path = value
        .replace(/^https?:\/\/[^/]+/i, "")
        .replace(/[?#].*$/, "")
        .trim();
    const match = /^\/manga\/([^/]+)\/?$/.exec(path);
    if (!match)
        return undefined;
    try {
        return decodeURIComponent(match[1]);
    }
    catch {
        return match[1];
    }
}
exports.mangaIdFromHref = mangaIdFromHref;
/** Blocs `<li>…</li>` d'un fragment, à partir de `from`. */
function listItemBlocks(html, from = 0) {
    const blocks = [];
    const re = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
    re.lastIndex = Math.max(0, from);
    let match;
    while ((match = re.exec(html)) !== null)
        blocks.push(match[0]);
    return blocks;
}
/**
 * Analyse `/search?title=…&page=…` : tuiles dédoublonnées + page suivante.
 *
 * Une page pleine (`SEARCH_PAGE_SIZE` tuiles) annonce une suite ; une page
 * partielle — y compris une page au-delà du dernier résultat, qui répond 200
 * avec 0 tuile — la termine. Aucune erreur n'est levée pour une page vide.
 */
function parseSearchResults(html) {
    const items = parseSearchTiles(html);
    return { items, hasMore: items.length >= exports.SEARCH_PAGE_SIZE };
}
exports.parseSearchResults = parseSearchResults;
/**
 * Tuiles d'une page de listes `manga-list-*`.
 *
 * Un `<li>` est retenu si :
 *   - il contient `p.<titleClass>` dont le premier `<a href>` pointe vers une
 *     FICHE (`/manga/<slug>/`) — les liens de chapitre (« Latest Chapter »,
 *     `…/c001/1.html`) sont donc ignorés ;
 *   - sa couverture est une `<img>` portant `class="<coverClass>"` dans le MÊME
 *     `<li>` (la classe est portée par l'`<img>`, pas par un conteneur).
 *
 * Structure mesurée le 2026-10-18 : identique pour `/search` et `/releases/`
 * (`manga-list-4`) et pour `/trending/` (`manga-list-1`).
 */
function parseTiles(html, titleClass, coverClass) {
    if (typeof html !== "string" || html.length === 0)
        return [];
    const tiles = [];
    const coverPattern = new RegExp(`\\b${escapeRegExp(coverClass)}\\b`, "i");
    for (const block of listItemBlocks(html)) {
        const titleBlock = classHtml(block, "p", titleClass);
        if (titleBlock.length === 0)
            continue;
        const anchor = anchorTags(titleBlock)[0];
        if (!anchor)
            continue;
        const href = attributeOf(anchor, "href") ?? "";
        // Ignore les liens de chapitre (« Latest Chapter ») présents dans la tuile.
        const mangaId = mangaIdFromHref(href);
        if (!mangaId)
            continue;
        const cover = imageTags(block).find((tag) => coverPattern.test(attributeOf(tag, "class") ?? ""));
        const src = cover ? attributeOf(cover, "src") ?? "" : "";
        const titleAttr = attributeOf(anchor, "title") ?? "";
        const titleText = stripTags(titleBlock);
        const title = titleAttr.trim().length > 0 ? titleAttr.trim() : titleText;
        tiles.push({ mangaId, title: title.length > 0 ? title : mangaId, image: absoluteUrl(src) });
    }
    return dedupeByKey(tiles, (tile) => tile.mangaId);
}
exports.parseTiles = parseTiles;
/** Tuiles de `/search` : `p.manga-list-4-item-title > a[href="/manga/<slug>/"]`. */
function parseSearchTiles(html) {
    return parseTiles(html, exports.TILE_TITLE_CLASS_LIST4, exports.TILE_COVER_CLASS_LIST4);
}
exports.parseSearchTiles = parseSearchTiles;
/**
 * Tuiles de `/releases/` (« Lastest Updates ») — même structure `manga-list-4`
 * que `/search`, sans pagination.
 */
function parseReleaseTiles(html) {
    return parseTiles(html, exports.TILE_TITLE_CLASS_LIST4, exports.TILE_COVER_CLASS_LIST4);
}
exports.parseReleaseTiles = parseReleaseTiles;
/** Tuiles de `/trending/` : `p.manga-list-1-item-title` + `img.manga-list-1-cover`. */
function parseMangaList1Tiles(html) {
    return parseTiles(html, exports.TILE_TITLE_CLASS_LIST1, exports.TILE_COVER_CLASS_LIST1);
}
exports.parseMangaList1Tiles = parseMangaList1Tiles;
/**
 * Analyse `/manga/<slug>/` : titre, statut, auteur, tags, synopsis complet,
 * couverture (hôte variable, jamais codé en dur).
 */
function parseSeriesDetails(html, mangaId) {
    const title = classText(html, "span", "detail-info-right-title-font");
    const status = classText(html, "span", "detail-info-right-title-tip");
    // Auteur(s) : `p.detail-info-right-say > a[title="ODA Eiichiro"]`.
    const authorBlock = classHtml(html, "p", "detail-info-right-say");
    const authors = dedupeStrings(anchorTags(authorBlock).map((tag) => (attributeOf(tag, "title") ?? "").trim()));
    const author = authors.length > 0
        ? authors.join(", ")
        : stripTags(authorBlock).replace(/^Author:\s*/i, "").trim();
    const tagBlock = classHtml(html, "p", "detail-info-right-tag-list");
    const tags = dedupeStrings(anchorTags(tagBlock).map((tag) => {
        const title2 = attributeOf(tag, "title") ?? "";
        if (title2.trim().length > 0)
            return title2.trim();
        return "";
    }));
    // Le synopsis visible (`p.detail-info-right-content`) est TRONQUÉ puis suivi
    // d'un lien « more » : on lit `p.fullcontent`, le texte complet.
    const description = stripTagsKeepLines(classHtml(html, "p", "fullcontent"));
    const coverTag = imageTags(html).find((tag) => {
        const cls = attributeOf(tag, "class") ?? "";
        return /\bdetail-info-cover-img\b/i.test(cls);
    });
    const image = coverTag ? absoluteUrl(attributeOf(coverTag, "src") ?? "") : "";
    const resolvedTitle = title.length > 0 ? title : mangaId;
    return {
        mangaId,
        title: resolvedTitle,
        titles: dedupeStrings([resolvedTitle]),
        image,
        description,
        status,
        author,
        tags,
    };
}
exports.parseSeriesDetails = parseSeriesDetails;
/**
 * Analyse la liste des chapitres contenue dans la fiche série : UNION de
 * `div#list-1` (chapitres hors volume) et `div#list-2` (chapitres par volume),
 * restreinte au conteneur `div#chapterlist`.
 *
 * Les liens `/manga/…/1.html` présents ailleurs (bouton « Read Now » après le
 * synopsis, widgets de recommandation, « Latest Chapter ») ne sont PAS des
 * chapitres : ici chaque entrée doit (1) apparaître après `id="chapterlist"`,
 * (2) porter `p.title3` et (3) avoir un `href` de la forme
 * `/manga/<slug>/[<volume>/]c<num>/1.html`.
 */
function parseChapterList(html, mangaId) {
    if (typeof html !== "string" || html.length === 0)
        return [];
    const chapterListStart = html.indexOf('id="chapterlist"');
    if (chapterListStart < 0)
        return [];
    const slug = escapeRegExp(mangaId);
    // `attributeOf` renvoie la VALEUR de l'attribut (`/manga/<slug>/…/1.html`).
    const hrefRe = new RegExp(`^/manga/${slug}/(.+)/1\\.html$`, "i");
    const entries = [];
    for (const block of listItemBlocks(html, chapterListStart)) {
        if (!/class\s*=\s*"[^"]*\btitle3\b/i.test(block))
            continue;
        const anchor = anchorTags(block)[0];
        if (!anchor)
            continue;
        const match = hrefRe.exec(attributeOf(anchor, "href") ?? "");
        if (!match)
            continue;
        const chapterId = match[1].trim();
        if (!/^(?:[^\/]+\/)?c[0-9]+(?:\.[0-9]+)?$/i.test(chapterId))
            continue;
        const name = classText(block, "p", "title3") ||
            (attributeOf(anchor, "title") ?? "").replace(/^.*?\bCh\./i, "Ch.") ||
            chapterId;
        const time = parseSiteDateUtc(classText(block, "p", "title2"));
        const volume = volumeOf(chapterId, name);
        entries.push({
            chapterId,
            name,
            chapNum: chapterNumberOf(name),
            volume,
            time,
        });
    }
    return dedupeByKey(entries, (entry) => entry.chapterId).sort((a, b) => {
        const diff = a.chapNum - b.chapNum;
        if (diff !== 0)
            return diff;
        return a.chapterId < b.chapterId ? -1 : a.chapterId > b.chapterId ? 1 : 0;
    });
}
exports.parseChapterList = parseChapterList;
/** Volume numérique déclaré par le chemin (`v01`) ou le libellé (`Vol.01`). */
function volumeOf(chapterId, name) {
    const fromPath = /(?:^|\/)v(\d+)(?:\/|$)/i.exec(chapterId);
    if (fromPath) {
        const parsed = Number.parseInt(fromPath[1], 10);
        if (Number.isFinite(parsed))
            return parsed;
    }
    const fromName = /\bVol\.(\d+)\b/i.exec(name);
    if (fromName) {
        const parsed = Number.parseInt(fromName[1], 10);
        if (Number.isFinite(parsed))
            return parsed;
    }
    return undefined;
}
/** Valeur d'un `<input … id="<id>" … value="…">` (chaîne vide si absente). */
function inputValueById(html, id) {
    if (typeof html !== "string" || html.length === 0)
        return "";
    const tagRe = /<input\b[^>]*>/gi;
    let tag;
    while ((tag = tagRe.exec(html)) !== null) {
        if ((attributeOf(tag[0], "id") ?? "") !== id)
            continue;
        return (attributeOf(tag[0], "value") ?? "").trim();
    }
    return "";
}
exports.inputValueById = inputValueById;
/**
 * Extrait `guidkey` d'un script déjà déballé (`var guidkey=''+'d'+'7'+…;`).
 * Renvoie `""` si la clé n'est pas un hexadécimal d'au moins 16 caractères.
 */
function guidKeyOfScript(script) {
    if (typeof script !== "string" || script.length === 0)
        return "";
    const parts = /guidkey\s*=\s*((?:'[^']*'\s*\+?\s*)+)/.exec(script);
    if (!parts)
        return "";
    const joined = (parts[1].match(/'([^']*)'/g) ?? [])
        .map((quoted) => quoted.slice(1, -1))
        .join("");
    const candidate = joined.trim();
    return /^[0-9a-f]{16,}$/i.test(candidate) ? candidate.toLowerCase() : "";
}
exports.guidKeyOfScript = guidKeyOfScript;
/**
 * Analyse la page de lecture : `var comicid`, `var chapterid`, `var imagecount`
 * et la clé `guidkey`.
 *
 * `#dm5_key` est un `<input value="">` VIDE : la valeur est écrite par un script
 * packé situé juste après (mesuré : 1 bloc). On déballe ce script en pur
 * (aucun `eval`) et on concatène les fragments `'d'+'7'+'a'…`.
 * Si l'input portait malgré tout une valeur non vide, elle fait foi.
 */
function parseReaderMeta(html) {
    const text = typeof html === "string" ? html : "";
    const comicId = firstCapture(/\bvar\s+comicid\s*=\s*(\d+)/, text) ?? "";
    const chapterNumericId = firstCapture(/\bvar\s+chapterid\s*=\s*(\d+)/, text) ?? "";
    const imageCountRaw = firstCapture(/\bvar\s+imagecount\s*=\s*(\d+)/, text);
    const imageCount = imageCountRaw ? Number.parseInt(imageCountRaw, 10) : 0;
    const fromInput = inputValueById(text, "dm5_key");
    const fromScripts = unpackPackedScripts(text)
        .map((script) => guidKeyOfScript(script))
        .find((key) => key.length > 0);
    const directKey = /guidkey\s*=\s*'([0-9a-f]{16,})'/i.exec(text);
    const guidKey = /^[0-9a-f]{16,}$/i.test(fromInput) && fromInput.length > 0
        ? fromInput.toLowerCase()
        : fromScripts ?? (directKey ? directKey[1].toLowerCase() : "");
    return {
        comicId,
        chapterNumericId,
        imageCount: Number.isFinite(imageCount) && imageCount > 0 ? imageCount : 0,
        guidKey,
    };
}
exports.parseReaderMeta = parseReaderMeta;
/**
 * Analyse la réponse de `chapterfun.ashx` : `var pix = "<hôte+base>"` et
 * `pvalue=[ "<relatif>", … ]`.
 *
 * ⚠️ Seul `pvalue[0]` est fiable : mesuré le 2026-10-18 sur `one_piece/vTBE/
 * c1196` (imagecount 18), `page=18` renvoie `[d037]` alors que `page=17` renvoie
 * `[d017, d037]` — le 2ᵉ élément n'est pas systématiquement la page suivante.
 * L'appelant fait donc UNE requête par page et prend `pvalue[0]`.
 */
function parseChapterImageResponse(body) {
    const unpacked = unpackPackedScripts(body).join("\n") || (typeof body === "string" ? body : "");
    const hostBase = firstCapture(/\bvar\s+pix\s*=\s*"([^"]*)"/, unpacked) ?? firstCapture(/\bpix\s*=\s*"([^"]*)"/, unpacked) ?? "";
    const arrayBody = firstCapture(/\bpvalue\s*=\s*\[([\s\S]*?)\]/, unpacked) ?? "";
    const relative = (arrayBody.match(/"([^"]*)"/g) ?? [])
        .map((quoted) => quoted.slice(1, -1))
        .map((value) => value.trim())
        .find((value) => value.length > 0) ?? "";
    return {
        hostBase: hostBase.trim(),
        relative,
        url: resolveCdnUrl(hostBase, relative),
    };
}
exports.parseChapterImageResponse = parseChapterImageResponse;
/** Premier groupe capturé d'une expression régulière, `undefined` si absente. */
function firstCapture(re, text) {
    if (typeof text !== "string" || text.length === 0)
        return undefined;
    const match = re.exec(text);
    return match ? match[1] : undefined;
}
/* ------------------------------------------------------------------ */
/* Erreurs — messages explicites, sans aucun contournement             */
/* ------------------------------------------------------------------ */
/** 403 : contrôle d'accès du site (CDN ou page). Aucun contournement tenté. */
function accessDeniedError(url) {
    return new Error(`HTTP 403 : fanfox.net a refusé la requête (${url}). ` +
        `La source envoie pourtant un User-Agent navigateur et un Referer fanfox.net ; le site renforce peut-être sa protection. ` +
        `Aucun contournement de protection n'est effectué (pas de résolution de challenge, pas de rotation d'IP, pas de rafale de requêtes). ` +
        `Réessaie plus tard depuis l'application.`);
}
exports.accessDeniedError = accessDeniedError;
/** 404 : ressource introuvable. */
function notFoundError(what) {
    return new Error(`Introuvable sur fanfox.net : ${what}.`);
}
exports.notFoundError = notFoundError;
/** Autre statut HTTP inattendu. */
function httpStatusError(status, url) {
    return new Error(`HTTP ${status} : réponse inattendue de fanfox.net (${url}).`);
}
exports.httpStatusError = httpStatusError;
/** Erreur réseau / exception de transport. */
function networkError(detail, url) {
    return new Error(`Erreur réseau en contactant fanfox.net (${url}) : ${detail}`);
}
exports.networkError = networkError;
/** Corps vide sur une page HTML : on refuse d'analyser une réponse sans contenu. */
function emptyBodyError(url) {
    return new Error(`Réponse vide reçue de fanfox.net (${url}) : aucun HTML exploitable. ` +
        `Le site a peut-être renvoyé une page de blocage ou une erreur silencieuse.`);
}
exports.emptyBodyError = emptyBodyError;
/**
 * Corps vide sur `chapterfun.ashx` : c'est un ÉCHEC explicite (mesuré : l'endpoint
 * peut répondre 200 avec un corps vide) et JAMAIS un chapitre sans pages.
 */
function emptyChapterFunError(url, page) {
    return new Error(`Réponse vide de chapterfun.ashx pour la page ${page} (${url}) : ` +
        `l'endpoint exige un en-tête Referer d'hôte fanfox.net. ` +
        `Ce n'est pas un chapitre vide — aucune page n'est inventée.`);
}
exports.emptyChapterFunError = emptyChapterFunError;
/** La réponse de `chapterfun.ashx` n'a pas fourni d'URL d'image exploitable. */
function chapterFunParseError(chapterId, page, url) {
    return new Error(`Réponse inattendue de chapterfun.ashx pour la page ${page} du chapitre ${chapterId} (${url}) : ` +
        `aucune URL d'image (var pix / pvalue[0]) n'a pu être extraite.`);
}
exports.chapterFunParseError = chapterFunParseError;
/** La page de lecture n'expose pas la clé `guidkey` : chapitre illisible. */
function missingChapterKeyError(chapterId, url) {
    return new Error(`Clé de lecture (guidkey) introuvable pour le chapitre ${chapterId} sur fanfox.net (${url}). ` +
        `Le format du lecteur a peut-être changé ; aucune page n'est inventée.`);
}
exports.missingChapterKeyError = missingChapterKeyError;
/** La page de lecture n'annonce aucun identifiant numérique de chapitre. */
function missingChapterIdError(chapterId, url) {
    return new Error(`Identifiant numérique de chapitre (var chapterid) introuvable pour ${chapterId} sur fanfox.net (${url}).`);
}
exports.missingChapterIdError = missingChapterIdError;
/** Chapitre sans aucune page exploitable. */
function noPagesError(chapterId) {
    return new Error(`Aucune page n'a été trouvée pour le chapitre ${chapterId} sur fanfox.net.`);
}
exports.noPagesError = noPagesError;
/** Extrait un code de statut HTTP d'une exception (axios, runtime, autre). */
function httpStatusFromError(error) {
    if (error === null || typeof error !== "object")
        return undefined;
    const candidate = error;
    if (typeof candidate.status === "number")
        return candidate.status;
    if (candidate.response && typeof candidate.response.status === "number") {
        return candidate.response.status;
    }
    return undefined;
}
exports.httpStatusFromError = httpStatusFromError;
/** Message lisible d'une exception quelconque. */
function errorMessageOf(error) {
    if (typeof error === "string")
        return error;
    if (error !== null && typeof error === "object") {
        const candidate = error;
        if (typeof candidate.message === "string")
            return candidate.message;
    }
    return String(error);
}
exports.errorMessageOf = errorMessageOf;
