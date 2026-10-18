// SONDE DE REVUE INDÉPENDANTE (round 1, lentille « artefact »)
// Écrite par le reviewer — n'utilise AUCUN script du livrable.
// Objectif : prouver par exécution réelle que les sections d'accueil sont non
// vides, avec URLs d'images absolues, et que getViewMoreItems ne casse rien.
require("@paperback/runtime-polyfills");
const path = require("node:path");
const cheerio = require("cheerio");
const source = require(path.join(process.cwd(), "tmp", "Fanfox", "Fanfox.js"));

const issues = [];
const check = (cond, label) => {
  if (!cond) issues.push(label);
  console.log(`${cond ? "OK  " : "FAIL"} ${label}`);
};

(async () => {
  console.log(`version=${source.FanfoxInfo.version} intents=${source.FanfoxInfo.intents}`);
  check(source.FanfoxInfo.intents === 5, "intents === 5 (MANGA_CHAPTERS|HOMEPAGE_SECTIONS)");
  check(typeof source.Fanfox.prototype.getHomePageSections === "function", "getHomePageSections définie");
  check(typeof source.Fanfox.prototype.getViewMoreItems === "function", "getViewMoreItems définie");

  const inst = new source.Fanfox(cheerio.default);
  const seen = [];
  await inst.getHomePageSections((s) => seen.push(s));

  console.log(`sections reçues = ${seen.length}`);
  check(seen.length >= 1, "au moins une section publiée");
  for (const s of seen) {
    const items = s.items ?? [];
    console.log(`  section id=${s.id} title=${JSON.stringify(s.title)} type=${s.type} containsMoreItems=${s.containsMoreItems} items=${items.length}`);
    check(items.length > 0, `section ${s.id} non vide`);
    check(items.every((i) => /^https?:\/\//.test(i.image ?? "")), `section ${s.id} : 100% images absolues`);
    check(items.every((i) => (i.mangaId ?? "").length > 0 && (i.title ?? "").length > 0), `section ${s.id} : ids+titres non vides`);
    const hosts = [...new Set(items.map((i) => (i.image.match(/^https?:\/\/([^/]+)/) ?? [])[1]))];
    console.log(`    hôtes d'images observés: ${hosts.join(", ")}`);
    const sample = items[0];
    console.log(`    exemple: mangaId=${sample.mangaId} title=${JSON.stringify(sample.title)} image=${sample.image}`);
  }

  for (const [id, md] of [["latest_updates", undefined], ["trending", { page: 2 }], ["inexistante", { page: 3 }]]) {
    const p = await inst.getViewMoreItems(id, md);
    console.log(`  getViewMoreItems(${id}) -> results=${p.results.length} metadata=${JSON.stringify(p.metadata)}`);
  }

  console.log(issues.length === 0 ? "\nREVUE : TOUTES LES ASSERTIONS PASSENT" : `\nREVUE : ${issues.length} ÉCHEC(S)\n - ${issues.join("\n - ")}`);
  process.exitCode = issues.length === 0 ? 0 : 1;
})().catch((e) => {
  console.error("ERREUR EXCEPTION:", e && e.message ? e.message : e);
  process.exitCode = 2;
});
