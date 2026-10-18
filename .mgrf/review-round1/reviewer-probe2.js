// SONDE DE REVUE INDÉPENDANTE n°2 — non-régression recherche / fiche / chapitres
require("@paperback/runtime-polyfills");
const path = require("node:path");
const cheerio = require("cheerio");
const source = require(path.join(process.cwd(), "tmp", "Fanfox", "Fanfox.js"));

(async () => {
  const inst = new source.Fanfox(cheerio.default);

  const search = await inst.getSearchResults({ title: "naruto", includedTags: [], excludedTags: [] }, undefined);
  console.log(`getSearchResults("naruto", p1) -> results=${search.results.length} metadata=${JSON.stringify(search.metadata)}`);
  console.log(`  exemple: ${search.results[0]?.mangaId} | ${JSON.stringify(search.results[0]?.title)} | ${(search.results[0]?.image ?? "").slice(0, 60)}`);
  const p2 = await inst.getSearchResults({ title: "naruto", includedTags: [], excludedTags: [] }, search.metadata);
  console.log(`  page 2 -> results=${p2.results.length}`);

  const sections = [];
  await inst.getHomePageSections((s) => sections.push(s));
  let checked = 0;
  for (const s of sections) {
    for (const item of (s.items ?? []).slice(0, 1)) {
      const details = await inst.getMangaDetails(item.mangaId);
      const chapters = await inst.getChapters(item.mangaId);
      console.log(`fiche ${item.mangaId}: titre=${JSON.stringify(details.mangaInfo?.titles?.[0])} desc=${details.mangaInfo?.desc?.length ?? 0} car. chapitres=${chapters.length}`);
      checked += 1;
    }
  }
  console.log(`\nitems d'accueil menant à une fiche réelle : ${checked}/${sections.length}`);
  process.exitCode = search.results.length > 0 && checked === sections.length ? 0 : 1;
})().catch((e) => {
  console.error("ERREUR EXCEPTION:", e && e.message ? e.message : e);
  process.exitCode = 2;
});
