// REVUE INDÉPENDANTE (round 1, lentille artefact) — vérification par exécution.
//
// 1) Implémentation SÉQUENTIELLE de référence, écrite ici (boucle for), en
//    réutilisant UNIQUEMENT les helpers publics de Common.ts (aucun code du
//    worker) : c'est l'algorithme de 1.0.5.
// 2) Implémentation LIVRÉE : source.Fanfox#getChapterDetails (build courant).
// 3) Comparaison stricte des listes (ordre inclus), mêmes chapitres, même débit.
// 4) Statut HTTP des images : TOUTES pour le chapitre court, échantillon pour le long.
//
// Usage : node <ce fichier>  (cwd = /Users/atc/paperback-repo-fresh)

const path = require("node:path");
const repo = process.cwd();
const axios = require(path.join(repo, "node_modules", "axios"));
require(path.join(repo, "node_modules", "@paperback", "runtime-polyfills"));
const cheerio = require(path.join(repo, "node_modules", "cheerio"));

const common = require(path.join(repo, "tmp", "Fanfox", "Common.js"));
const source = require(path.join(repo, "tmp", "Fanfox", "Fanfox.js"));

const RPS = 4; // débit modélisé identique des deux côtés
const CASES = [
  { tag: "court-18", slug: "one_piece", chapter: "vTBE/c1196", expect: 18, checkAllImages: true },
  { tag: "long-46", slug: "bleach", chapter: "v00/c000", expect: 46, checkAllImages: false },
];

const IMAGE_HEADERS = {
  "User-Agent": common.BROWSER_USER_AGENT,
  Referer: common.DEFAULT_REFERER,
};

function limiter(manager, requestsPerSecond) {
  const intervalMs = requestsPerSecond > 0 ? 1000 / requestsPerSecond : 0;
  const stats = { dispatched: 0, maxInFlight: 0, inFlight: 0 };
  let nextSlot = 0;
  return {
    stats,
    manager: {
      requestsPerSecond: manager.requestsPerSecond,
      requestTimeout: manager.requestTimeout,
      cookieStore: manager.cookieStore,
      getDefaultUserAgent: () => manager.getDefaultUserAgent(),
      schedule: async (request, retryCount) => {
        const now = Date.now();
        const slot = Math.max(now, nextSlot);
        nextSlot = slot + intervalMs;
        if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
        stats.dispatched += 1;
        stats.inFlight += 1;
        stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
        try {
          return await manager.schedule(request, retryCount);
        } finally {
          stats.inFlight -= 1;
        }
      },
    },
  };
}

// --- Référence séquentielle (1.0.5) : boucle for sur les pages, pvalue[0]. ---
async function sequentialPages(instance, slug, chapter) {
  const readerUrl = common.chapterReaderUrl(slug, chapter, 1);
  const html = await instance.fetchTextPublic(readerUrl);
  const meta = common.parseReaderMeta(html);
  const pages = [];
  for (let page = 1; page <= meta.imageCount; page += 1) {
    const url = common.chapterFunUrl(slug, chapter, meta.chapterNumericId, page, meta.guidKey);
    const body = await instance.fetchTextPublic(url);
    const image = common.parseChapterImageResponse(body);
    if (image.url.length === 0) throw new Error(`pas d'URL page ${page}`);
    pages.push(image.url);
  }
  return { pages, meta };
}

async function imageStatus(url) {
  try {
    const res = await axios(url, { headers: IMAGE_HEADERS, timeout: 30000, responseType: "arraybuffer" });
    return { status: res.status, type: res.headers["content-type"], bytes: Buffer.from(res.data).length };
  } catch (error) {
    return { status: `ERR ${error.response?.status ?? error.message}`, type: "", bytes: 0 };
  }
}

// Accès public minimal : `fetchText` est privé en TS mais présent au runtime.
async function makeInstance() {
  const instance = new source.Fanfox(cheerio.default);
  instance.fetchTextPublic = instance.fetchText.bind(instance);
  if (typeof instance.fetchTextPublic !== "function") throw new Error("fetchText introuvable sur l'instance");
  return instance;
}

(async () => {
  let failures = 0;
  console.log(`### REVUE round 1 — Fanfox ${source.FanfoxInfo.version} — déclaré rps=${new source.Fanfox(cheerio.default).requestManager.requestsPerSecond} — modèle rps=${RPS}`);

  for (const testCase of CASES) {
    // 1. Référence séquentielle, débit 4 req/s.
    const seq = await makeInstance();
    const seqLimiter = limiter(seq.requestManager, RPS);
    seq.requestManager = seqLimiter.manager;
    const t0 = Date.now();
    const ref = await sequentialPages(seq, testCase.slug, testCase.chapter);
    const seqMs = Date.now() - t0;

    // 2. Implémentation livrée, débit 4 req/s.
    const impl = await makeInstance();
    const implLimiter = limiter(impl.requestManager, RPS);
    impl.requestManager = implLimiter.manager;
    const t1 = Date.now();
    let details = null;
    let error = null;
    try {
      details = await impl.getChapterDetails(testCase.slug, testCase.chapter);
    } catch (e) {
      error = e && e.message ? e.message : String(e);
    }
    const implMs = Date.now() - t1;
    const got = details ? details.pages : [];

    const sameLength = ref.pages.length === got.length;
    const sameList = JSON.stringify(ref.pages) === JSON.stringify(got);
    const countOk = ref.pages.length === testCase.expect && got.length === testCase.expect;
    const ok = sameLength && sameList && countOk && error === null;
    if (!ok) failures += 1;
    console.log(
      `${ok ? "OK  " : "FAIL"} ${testCase.tag} ${testCase.slug}/${testCase.chapter} : ` +
        `séquentiel=${ref.pages.length} p. en ${seqMs} ms (${seqLimiter.stats.dispatched} req, vol max ${seqLimiter.stats.maxInFlight}) | ` +
        `livré=${got.length} p. en ${implMs} ms (${implLimiter.stats.dispatched} req, vol max ${implLimiter.stats.maxInFlight}) | ` +
        `listes identiques (ordre inclus)=${sameList}${error ? ` | ERREUR: ${error}` : ""}`,
    );
    if (!sameList) {
      for (let i = 0; i < Math.max(ref.pages.length, got.length); i += 1) {
        if (ref.pages[i] !== got[i]) {
          console.log(`      diff[${i}] seq=${ref.pages[i]} livré=${got[i]}`);
          break;
        }
      }
    }
    console.log(`      page[0]=${got[0]}`);
    console.log(`      page[${got.length - 1}]=${got[got.length - 1]}`);
    console.log(
      `      gain modèle rps=${RPS} : ${implMs > 0 ? (seqMs / implMs).toFixed(2) : "?"}x ` +
        `(séquentiel ${seqMs} ms -> livré ${implMs} ms)`,
    );

    // 3. Images : toutes pour le court, échantillon (1re, milieu, dernière) pour le long.
    const indices = testCase.checkAllImages
      ? got.map((_, i) => i)
      : [...new Set([0, Math.floor(got.length / 2), got.length - 1])];
    const bad = [];
    let bytes = 0;
    for (const index of indices) {
      const status = await imageStatus(got[index]);
      bytes += status.bytes;
      if (status.status !== 200) bad.push({ index, url: got[index], ...status });
      await new Promise((r) => setTimeout(r, 120));
    }
    if (bad.length > 0) failures += 1;
    console.log(
      `${bad.length === 0 ? "OK  " : "FAIL"} images ${testCase.tag} : ${indices.length - bad.length}/${indices.length} en 200 ` +
        `(${(bytes / 1048576).toFixed(1)} Mio)${bad.length ? ` — KO: ${JSON.stringify(bad.slice(0, 3))}` : ""}`,
    );
  }

  console.log(`\nRESULTAT REVUE : ${failures === 0 ? "ÉGALITÉ URL + IMAGES OK" : failures + " ÉCHEC(S)"}`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((error) => {
  console.error("ERREUR SONDE:", error && error.stack ? error.stack : error);
  process.exitCode = 2;
});
