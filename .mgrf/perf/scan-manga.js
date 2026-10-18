// Scanne les chapitres d'un manga réel : récupère la fiche, parse la liste via
// le code compilé du dépôt, puis lit `var imagecount` de quelques chapitres
// répartis dans la liste (requêtes espacées).
// Usage : node .mgrf/perf/scan-manga.js <slug> [nbChapitres] [pas]
const path = require("node:path");
const axios = require("axios");
const common = require(path.join(process.cwd(), "tmp", "Fanfox", "Common.js"));

const HEADERS = { "User-Agent": common.BROWSER_USER_AGENT, Referer: common.DEFAULT_REFERER };
const slug = process.argv[2] ?? "one_punch_man";
const count = Number.parseInt(process.argv[3] ?? "10", 10);
const step = Number.parseInt(process.argv[4] ?? "1", 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const res = await axios(common.seriesUrl(slug), { headers: HEADERS, timeout: 20000, responseType: "arraybuffer" });
  const html = Buffer.from(res.data).toString();
  const entries = common.parseChapterList(html, slug);
  console.log(`# ${slug} : ${entries.length} chapitres listés (${entries[0]?.chapterId} … ${entries[entries.length - 1]?.chapterId})`);

  const picks = [];
  for (let i = 0; i < entries.length && picks.length < count; i += step) picks.push(entries[i]);

  for (const entry of picks) {
    const url = common.chapterReaderUrl(slug, entry.chapterId, 1);
    try {
      const r = await axios(url, { headers: HEADERS, timeout: 20000, responseType: "arraybuffer" });
      const meta = common.parseReaderMeta(Buffer.from(r.data).toString());
      console.log(`${String(meta.imageCount).padStart(3)} pages | cid=${meta.chapterNumericId.padStart(7)} | ${entry.chapterId} | ${entry.name.slice(0, 40)}`);
    } catch (error) {
      console.log(`  ? pages | ERR ${error.message} | ${entry.chapterId}`);
    }
    await sleep(400);
  }
})().catch((e) => {
  console.error("ERREUR:", e.message);
  process.exitCode = 2;
});
