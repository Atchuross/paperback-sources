// HARNAIS DE MESURE PERF — `getChapterDetails` de la source Fanfox compilée.
//
// Ce harnais charge un BUILD donné (dossier contenant Fanfox.js/Common.js) et
// mesure le temps réel de `getChapterDetails` sur deux chapitres réels :
//   • court : one_piece / vTBE/c1196 (18 pages)
//   • long  : bleach    / v00/c000  (46 pages)
//
// ⚠ MODÈLE DE DÉBIT : le polyfill Node `@paperback/runtime-polyfills` n'applique
// PAS `requestsPerSecond` (il appelle axios immédiatement). Or, dans
// l'application, c'est LUI le goulot d'étranglement (1 req/s ⇒ ≥ N secondes).
// Le harnais enveloppe donc le `RequestManager` dans un limiteur de débit qui
// reproduit la sémantique du manager natif : un départ de requête toutes les
// `1/requestsPerSecond` secondes, les requêtes lancées restant EN VOL
// simultanément. RPS=0 ⇒ aucun limiteur (coût réseau brut).
//
// Usage : RPS=1 LABEL=avant node .mgrf/perf/harness.js .mgrf/perf/build-before
const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");
require("@paperback/runtime-polyfills");
const cheerio = require("cheerio");
const common = require(path.join(process.cwd(), "tmp", "Fanfox", "Common.js"));

const buildDir = path.resolve(process.argv[2] ?? ".mgrf/perf/build-before");
const RPS = Number(process.env.RPS ?? "1");
const LABEL = process.env.LABEL ?? "run";
const OUT = path.resolve(process.env.OUT ?? path.join(".mgrf", "perf", `${LABEL}-rps${RPS}.json`));

const CASES = [
  { tag: "court-18", slug: "one_piece", chapter: "vTBE/c1196", pages: 18 },
  { tag: "long-46", slug: "bleach", chapter: "v00/c000", pages: 46 },
];

const IMAGE_HEADERS = {
  "User-Agent": common.BROWSER_USER_AGENT,
  Referer: common.DEFAULT_REFERER,
};

/** Limiteur de débit : espace les DÉPARTS, laisse les requêtes en vol. */
function wrapRequestManager(manager, requestsPerSecond) {
  const intervalMs = requestsPerSecond > 0 ? 1000 / requestsPerSecond : 0;
  const stats = { dispatched: 0, maxInFlight: 0, inFlight: 0, firstDispatch: 0, lastDispatch: 0 };
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
        if (stats.firstDispatch === 0) stats.firstDispatch = Date.now();
        stats.lastDispatch = Date.now();
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

/** Statut HTTP d'une URL d'image (GET, Referer fanfox.net exigé par le CDN). */
async function imageStatus(url) {
  try {
    const res = await axios(url, { headers: IMAGE_HEADERS, timeout: 30000, responseType: "arraybuffer" });
    return { status: res.status, bytes: Buffer.from(res.data).length, type: res.headers["content-type"] };
  } catch (error) {
    return { status: `ERR ${error.response?.status ?? error.message}`, bytes: 0, type: "" };
  }
}

(async () => {
  const source = require(path.join(buildDir, "Fanfox.js"));
  const report = {
    label: LABEL,
    build: path.relative(process.cwd(), buildDir),
    requestsPerSecond: RPS,
    version: source.FanfoxInfo.version,
    measuredAt: new Date().toISOString(),
    cases: [],
  };

  console.log(`### ${LABEL} — build=${report.build} — requestsPerSecond=${RPS} — Fanfox ${report.version}`);

  for (const testCase of CASES) {
    const instance = new source.Fanfox(cheerio.default);
    // Débit DÉCLARÉ par la source (lu avant enveloppement) : c'est la valeur que
    // le manager natif appliquerait. Le limiteur du harnais doit la reproduire.
    const declared = instance.requestManager.requestsPerSecond;
    const limiter = wrapRequestManager(instance.requestManager, RPS);
    instance.requestManager = limiter.manager;
    if (declared !== RPS) {
      console.log(`  ⚠ la source déclare requestsPerSecond=${declared}, le harnais modélise ${RPS}`);
    }
    testCase.declared = declared;

    const started = Date.now();
    let details = null;
    let error = null;
    try {
      details = await instance.getChapterDetails(testCase.slug, testCase.chapter);
    } catch (e) {
      error = e && e.message ? e.message : String(e);
    }
    const elapsedMs = Date.now() - started;
    const pages = details ? details.pages : [];

    // Échantillon d'images : 3 premières + 3 dernières (dont la DERNIÈRE page).
    const sampleIndices = [
      ...new Set([0, 1, 2, pages.length - 3, pages.length - 2, pages.length - 1].filter((i) => i >= 0)),
    ];
    const checks = [];
    for (const index of sampleIndices) {
      const result = await imageStatus(pages[index]);
      checks.push({ index, url: pages[index], ...result });
      await new Promise((r) => setTimeout(r, 150));
    }

    const entry = {
      tag: testCase.tag,
      mangaId: testCase.slug,
      chapterId: testCase.chapter,
      declaredRequestsPerSecond: testCase.declared,
      expectedPages: testCase.pages,
      ok: error === null,
      error,
      elapsedMs,
      pageCount: pages.length,
      requests: limiter.stats.dispatched,
      maxInFlight: limiter.stats.maxInFlight,
      dispatchWindowMs: limiter.stats.lastDispatch - limiter.stats.firstDispatch,
      pages,
      imageChecks: checks,
      imageFailures: checks.filter((c) => c.status !== 200).length,
    };
    report.cases.push(entry);

    console.log(
      `  ${testCase.tag.padEnd(9)} ${testCase.slug}/${testCase.chapter} : ` +
        `${elapsedMs} ms | pages=${pages.length} (attendu ${testCase.pages}) | ` +
        `requêtes=${limiter.stats.dispatched} | en vol max=${limiter.stats.maxInFlight} | ` +
        `fenêtre de départ=${entry.dispatchWindowMs} ms | images KO=${entry.imageFailures}` +
        (error ? ` | ERREUR: ${error}` : ""),
    );
    fs.writeFileSync(
      path.join(path.dirname(OUT), `${testCase.tag}-${LABEL}-rps${RPS}.pages.json`),
      JSON.stringify(entry, null, 2),
    );
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`\nRapport écrit : ${path.relative(process.cwd(), OUT)}`);
})().catch((error) => {
  console.error("ERREUR HARNAIS:", error && error.message ? error.message : error);
  process.exitCode = 2;
});
