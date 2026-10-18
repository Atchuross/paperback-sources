// Contrôle du CHEMIN 18+ : sans magasin de cookies (le polyfill Node n'en
// fournit pas), getChapters sur une série classée 18+ doit lever le message
// DIAGNOSTIC explicite (et non un plantage ou une liste vide silencieuse).
require("@paperback/runtime-polyfills");
const path = require("node:path");
const cheerio = require("cheerio");
const source = require(path.join(process.cwd(), "tmp", "Fanfox", "Fanfox.js"));

const instance = new source.Fanfox(cheerio.default);
console.log(`diagnostic cookie (constructeur) : ${instance.adultCookieDiag}`);
console.log(`magasin de cookies exposé par le runtime de test : ${instance.requestManager.cookieStore ? "PRÉSENT" : "ABSENT"}`);

(async () => {
  try {
    await instance.getChapters("goblin_slayer");
    console.log("INATTENDU : chapitres retournés sans cookie (la série n'est peut-être plus filtrée)");
    process.exitCode = 1;
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    const ok = /18\+/.test(message) && /isAdult/.test(message) && /magasin de cookies/.test(message);
    console.log(`${ok ? "OK  " : "FAIL"} message 18+ explicite : ${message}`);
    process.exitCode = ok ? 0 : 1;
  }
})();
