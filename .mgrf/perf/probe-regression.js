// SONDE DE NON-RÉGRESSION — exécute la source Fanfox COMPILÉE (build fourni) sur
// le site réel et vérifie les fonctions qui ne doivent PAS avoir changé :
// accueil, fiches, chapitres (dont la fiche 18+ `grand_blue`), recherche.
//
// Usage : node .mgrf/perf/probe-regression.js .mgrf/perf/build-after
const path = require("node:path");
require("@paperback/runtime-polyfills");
const cheerio = require("cheerio");

const buildDir = path.resolve(process.argv[2] ?? ".mgrf/perf/build-after");

// Magasin de cookies émulé (le polyfill Node n'en fournit aucun) : identique à
// `.mgrf/perf/probe-adult.js`, requis pour que la fiche 18+ `grand_blue` soit
// réellement débloquée comme dans l'application.
const originalCreateRequestManager = App.createRequestManager;
App.createRequestManager = function createRequestManagerWithCookieStore(info) {
  const manager = originalCreateRequestManager(info);
  const jar = [];
  manager.cookieStore = {
    addCookie(cookie) {
      jar.push({ name: cookie.name, value: cookie.value });
      return undefined;
    },
  };
  const nativeSchedule = manager.schedule.bind(manager);
  manager.schedule = async (request, retryCount) => {
    if (jar.length > 0) request.cookies = [...(request.cookies ?? []), ...jar];
    return nativeSchedule(request, retryCount);
  };
  return manager;
};

const source = require(path.join(buildDir, "Fanfox.js"));

let failures = 0;
const check = (ok, label, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
};

(async () => {
  const instance = new source.Fanfox(cheerio.default);
  console.log(`### ${path.relative(process.cwd(), buildDir)} — Fanfox ${source.FanfoxInfo.version} — intents=${source.FanfoxInfo.intents}`);

  // 1. Accueil (intent HOMEPAGE_SECTIONS)
  const sections = [];
  await instance.getHomePageSections((section) => sections.push(section));
  check(sections.length >= 2, "accueil : au moins 2 sections publiées", `sections=${sections.map((s) => `${s.id}(${s.items.length})`).join(", ")}`);
  check(
    sections.every((s) => s.items.length > 0 && s.items.every((i) => /^https?:\/\//.test(i.image) && i.mangaId && i.title)),
    "accueil : items complets (id, titre, image absolue)",
  );

  // 2. Fiche série
  const manga = await instance.getMangaDetails("one_piece");
  check(
    manga.id === "one_piece" && !!manga.mangaInfo && (manga.mangaInfo.titles ?? []).length > 0,
    "fiche : SourceManga valide",
    `titre=${JSON.stringify((manga.mangaInfo.titles ?? [])[0])} statut=${JSON.stringify(manga.mangaInfo.status)} auteur=${JSON.stringify(manga.mangaInfo.author)} tags=${(manga.mangaInfo.tags ?? []).length} synopsis=${(manga.mangaInfo.desc ?? "").length} car.`,
  );
  check(/^https?:\/\//.test(manga.mangaInfo.image ?? ""), "fiche : couverture absolue", manga.mangaInfo.image);

  // 3. Liste des chapitres (fiche normale)
  const chapters = await instance.getChapters("one_piece");
  const numbered = chapters.filter((c) => c.chapNum > 0).length;
  check(chapters.length > 1000 && numbered > 1000, "chapitres : one_piece > 1000 entrées", `total=${chapters.length} numérotées=${numbered}`);

  // 4. Déblocage 18+ : `grand_blue` doit rendre ses 149 chapitres
  const adult = await instance.getChapters("grand_blue");
  check(adult.length === 149, "18+ : grand_blue → 149 chapitres", `total=${adult.length}`);

  // 5. Recherche paginée
  const page1 = await instance.getSearchResults({ title: "naruto", includedTags: [], excludedTags: [], parameters: {} }, undefined);
  const page2 = await instance.getSearchResults({ title: "naruto", includedTags: [], excludedTags: [], parameters: {} }, page1.metadata);
  check(
    page1.results.length > 0 && page2.results.length > 0 && page1.results[0].mangaId !== page2.results[0].mangaId,
    "recherche : 2 pages de résultats distinctes",
    `p1=${page1.results.length} (${page1.results.map((r) => r.mangaId).slice(0, 3).join(",")}) p2=${page2.results.length} metadata1=${JSON.stringify(page1.metadata)}`,
  );

  console.log(`\nRESULTAT NON-RÉGRESSION : ${failures === 0 ? "TOUT PASSE" : failures + " ECHEC(S)"}`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((error) => {
  console.error("ERREUR:", error && error.message ? error.message : error);
  process.exitCode = 2;
});
