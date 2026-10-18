// SONDE LIVE (réseau réel) : exécute le code COMPILÉ de la source Fanfox
// (tmp/Fanfox/Fanfox.js) sur le site fanfox.net et affiche le contenu réel des
// sections d'accueil + le résultat de getViewMoreItems.
//
// Le harnais `paperback test` n'affiche que « non vide » ; cette sonde montre
// les identifiants, titres, nombres d'items et URLs d'images réellement reçus.
require("@paperback/runtime-polyfills");
const path = require("node:path");
const cheerio = require("cheerio");
const source = require(path.join(process.cwd(), "tmp", "Fanfox", "Fanfox.js"));

// Le harnais fait `new sourceFile[id](cheerio.default)` : cheerio 1.x n'expose
// pas de `default` sous CommonJS, on reproduit donc le même appel (undefined).
const instance = new source.Fanfox(cheerio.default);

console.log(`version déclarée : ${source.FanfoxInfo.version}`);
console.log(`intents           : ${source.FanfoxInfo.intents} (MANGA_CHAPTERS=${1}, HOMEPAGE_SECTIONS=${4})`);

(async () => {
  const sections = [];
  await instance.getHomePageSections((section) => sections.push(section));

  console.log(`\n=== getHomePageSections : ${sections.length} section(s) ===`);
  let failures = 0;
  for (const section of sections) {
    const items = section.items ?? [];
    const absolute = items.filter((i) => /^https?:\/\//.test(i.image)).length;
    const withId = items.filter((i) => typeof i.mangaId === "string" && i.mangaId.length > 0).length;
    const withTitle = items.filter((i) => typeof i.title === "string" && i.title.length > 0).length;
    const ok = items.length > 0 && absolute === items.length && withId === items.length && withTitle === items.length;
    if (!ok) failures += 1;
    console.log(
      `${ok ? "OK  " : "FAIL"} id=${section.id} titre=${JSON.stringify(section.title)} type=${JSON.stringify(section.type)} ` +
        `containsMoreItems=${section.containsMoreItems} items=${items.length} ` +
        `(imagesAbsolues=${absolute}, ids=${withId}, titres=${withTitle})`,
    );
    for (const item of items.slice(0, 3)) {
      console.log(`        - ${item.mangaId} | ${item.title} | ${item.image.slice(0, 80)}`);
    }
  }

  console.log("\n=== getViewMoreItems ===");
  for (const [sectionId, metadata] of [
    [sections.length > 0 ? sections[0].id : "latest_updates", null],
    ["inconnue", { page: 2 }],
  ]) {
    const paged = await instance.getViewMoreItems(sectionId, metadata);
    console.log(
      `id=${sectionId} metadata=${JSON.stringify(metadata)} -> results=${paged.results.length} metadata=${JSON.stringify(paged.metadata)}`,
    );
  }

  console.log(`\nRESULTAT SONDE LIVE : ${failures === 0 ? "SECTIONS NON VIDES, ITEMS COMPLETS" : failures + " ECHEC(S)"}`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((error) => {
  console.error("ERREUR :", error && error.message ? error.message : error);
  process.exitCode = 2;
});
