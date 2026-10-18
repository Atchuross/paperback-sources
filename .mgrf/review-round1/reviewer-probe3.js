// Sonde 3 : le chemin `tags` d'une fiche est-il réellement exercé (pré-existant) ?
require("@paperback/runtime-polyfills");
const path = require("node:path");
const cheerio = require("cheerio");
const source = require(path.join(process.cwd(), "tmp", "Fanfox", "Fanfox.js"));
(async () => {
  const inst = new source.Fanfox(cheerio.default);
  for (const id of ["the_dark_swordsman_returns", "gensou_gourmet"]) {
    const d = await inst.getMangaDetails(id);
    const secs = d.mangaInfo?.tags ?? [];
    console.log(`${id}: tagSections=${secs.length} tags=${secs.reduce((n, s) => n + (s.tags?.length ?? 0), 0)} échantillon=${JSON.stringify((secs[0]?.tags ?? []).slice(0, 3))}`);
  }
})().catch((e) => { console.error("ERREUR:", e && e.message ? e.message : e); process.exitCode = 2; });
