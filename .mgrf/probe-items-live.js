// SONDE LIVE (réseau réel) : les items publiés dans les sections d'accueil
// mènent-ils à des fiches RÉELLES et à des chapitres exploitables ?
// Exécute le code compilé (tmp/Fanfox/Fanfox.js) sur fanfox.net.
// Pauses de 1 s entre séries pour rester courtois avec le site.
require("@paperback/runtime-polyfills");
const path = require("node:path");
const cheerio = require("cheerio");
const source = require(path.join(process.cwd(), "tmp", "Fanfox", "Fanfox.js"));

const instance = new source.Fanfox(cheerio.default);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const sections = [];
  await instance.getHomePageSections((s) => sections.push(s));

  const targets = [];
  for (const section of sections) {
    const items = section.items;
    targets.push([`${section.id} [0]`, items[0]]);
    targets.push([`${section.id} [dernier]`, items[items.length - 1]]);
  }

  let failures = 0;
  for (const [label, item] of targets) {
    await sleep(1000);
    try {
      const details = await instance.getMangaDetails(item.mangaId);
      const chapters = await instance.getChapters(item.mangaId);
      const haben = await instance.getMangaDetails(item.mangaId); // 2e appel : stabilité
      const ok =
        details.id === item.mangaId &&
        (details.mangaInfo?.titles ?? []).length > 0 &&
        (details.mangaInfo?.image ?? "").length > 0 &&
        chapters.length > 0;
      if (!ok) failures += 1;
      console.log(
        `${ok ? "OK  " : "FAIL"} ${label.padEnd(22)} id=${details.id} ` +
          `titre="${details.mangaInfo.titles[0]}" statut="${details.mangaInfo.status}" ` +
          `couverture=${/^https?:\/\//.test(details.mangaInfo.image) ? "absolue" : "RELATIVE"} ` +
          `chapitres=${chapters.length} (1er=${chapters[0]?.id}, dernier=${chapters[chapters.length - 1]?.id}) ` +
          `2eAppel=${haben.id === details.id ? "stable" : "INSTABLE"}`,
      );
    } catch (error) {
      failures += 1;
      console.log(`FAIL ${label.padEnd(22)} ${item.mangaId} -> ${error && error.message ? error.message : error}`);
    }
  }

  // Non-régression fonctionnelle : recherche.
  await sleep(1000);
  const found = await instance.getSearchResults(
    { title: "naruto", includedTags: [], excludedTags: [], parameters: {} },
    {},
  );
  console.log(`\nrecherche "naruto" -> ${found.results.length} résultat(s), 1er = ${found.results[0]?.mangaId}, pageSuivante=${JSON.stringify(found.metadata)}`);
  if (found.results.length === 0) failures += 1;

  console.log(`\nRESULTAT SONDE FONCTIONNELLE : ${failures === 0 ? "OK (items d'accueil cliquables et fonctionnels)" : failures + " ECHEC(S)"}`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((error) => {
  console.error("ERREUR :", error && error.message ? error.message : error);
  process.exitCode = 2;
});
