// SONDE 18+ (avec ÉMULATION du magasin de cookies du runtime natif).
//
// Le polyfill Node `@paperback/runtime-polyfills` ne fournit AUCUN
// `cookieStore` (mesuré) : sans magasin, la source signale explicitement
// « magasin de cookies ABSENT » et la fiche 18+ reste bloquée. Cette sonde
// installe donc un magasin de cookies minimal, branché AVANT l'instanciation,
// qui reproduit le comportement du runtime natif : tout cookie ajouté par la
// source via `requestManager.cookieStore.addCookie(...)` repart dans l'en-tête
// `Cookie` des requêtes suivantes (le MockRequestManager du polyfill construit
// cet en-tête à partir de `request.cookies`).
//
// But : vérifier la NON-RÉGRESSION du déblocage 18+ (`grand_blue` → 149
// chapitres) sur le build AVANT et le build APRÈS l'optimisation PERF.
//
// Usage : node .mgrf/perf/probe-adult.js .mgrf/perf/build-after
const path = require("node:path");
require("@paperback/runtime-polyfills");
const cheerio = require("cheerio");

const buildDir = path.resolve(process.argv[2] ?? ".mgrf/perf/build-after");

// --- Émulation du magasin de cookies du runtime natif -----------------------
const originalCreateRequestManager = App.createRequestManager;
App.createRequestManager = function createRequestManagerWithCookieStore(info) {
  const manager = originalCreateRequestManager(info);
  const jar = [];
  manager.cookieStore = {
    addCookie(cookie) {
      jar.push({ name: cookie.name, value: cookie.value });
      return undefined;
    },
    getCookies() {
      return jar;
    },
  };
  const nativeSchedule = manager.schedule.bind(manager);
  manager.schedule = async (request, retryCount) => {
    if (jar.length > 0) {
      request.cookies = [...(request.cookies ?? []), ...jar];
    }
    return nativeSchedule(request, retryCount);
  };
  return manager;
};

const source = require(path.join(buildDir, "Fanfox.js"));

(async () => {
  const instance = new source.Fanfox(cheerio.default);
  console.log(`### ${path.relative(process.cwd(), buildDir)} — Fanfox ${source.FanfoxInfo.version}`);
  console.log(`magasin de cookies émulé : ${instance.requestManager.cookieStore ? "PRÉSENT" : "ABSENT"}`);
  console.log(`diagnostic cookie (constructeur) : ${instance.adultCookieDiag}`);

  const chapters = await instance.getChapters("grand_blue");
  const ok = chapters.length === 149;
  console.log(
    `${ok ? "OK  " : "FAIL"} 18+ : grand_blue → ${chapters.length} chapitres (attendu 149) | ` +
      `premier=${chapters[0]?.id} dernier=${chapters[chapters.length - 1]?.id}`,
  );

  // Témoin négatif : un manager SANS magasin de cookies (polyfill d'origine) doit
  // produire le message diagnostic explicite, et non une liste vide silencieuse.
  App.createRequestManager = originalCreateRequestManager;
  const stock = new source.Fanfox(cheerio.default);
  try {
    await stock.getChapters("grand_blue");
    console.log("FAIL contrôle : aucune erreur alors que le magasin de cookies est absent");
    process.exitCode = 1;
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    const informative = /18\+/.test(message) && /isAdult/.test(message) && /magasin de cookies/.test(message);
    console.log(`${informative ? "OK  " : "FAIL"} contrôle (manager sans magasin) : message 18+ explicite`);
    process.exitCode = ok && informative ? 0 : 1;
  }
})().catch((error) => {
  console.error("ERREUR:", error && error.message ? error.message : error);
  process.exitCode = 2;
});
