// VÉRIFICATION DES IMAGES — teste TOUTES les URLs de pages produites par la
// nouvelle implémentation (et pas seulement un échantillon) : statut HTTP et
// type de contenu, avec le `Referer: https://fanfox.net/` exigé par le CDN.
//
// Usage : node .mgrf/perf/check-all-images.js
const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");
const common = require(path.join(process.cwd(), "tmp", "Fanfox", "Common.js"));

const dir = path.join(process.cwd(), ".mgrf", "perf");
const FILES = ["court-18-apres-rps4.pages.json", "long-46-apres-rps4.pages.json"];
const HEADERS = { "User-Agent": common.BROWSER_USER_AGENT, Referer: common.DEFAULT_REFERER };
const CONCURRENCY = 4;

async function checkOne(url) {
  try {
    const res = await axios(url, { headers: HEADERS, timeout: 30000, responseType: "arraybuffer" });
    return { url, status: res.status, type: res.headers["content-type"] ?? "", bytes: Buffer.from(res.data).length };
  } catch (error) {
    return { url, status: error.response?.status ?? `ERR ${error.message}`, type: "", bytes: 0 };
  }
}

(async () => {
  let failures = 0;
  for (const file of FILES) {
    const entry = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const results = [];
    let cursor = 0;
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= entry.pages.length) return;
        results[index] = await checkOne(entry.pages[index]);
      }
    });
    await Promise.all(workers);

    const ok = results.filter((r) => r.status === 200 && /^image\//.test(r.type));
    const bad = results.filter((r) => !(r.status === 200 && /^image\//.test(r.type)));
    if (bad.length > 0) failures += 1;
    const totalBytes = results.reduce((sum, r) => sum + r.bytes, 0);
    console.log(
      `${bad.length === 0 ? "OK  " : "FAIL"} ${entry.tag} (${entry.mangaId}/${entry.chapterId}) : ` +
        `${ok.length}/${entry.pages.length} images en 200 image/* | ${(totalBytes / 1024 / 1024).toFixed(2)} Mio | ` +
        `première=${results[0].status} dernière=${results[results.length - 1].status}`,
    );
    for (const b of bad.slice(0, 5)) console.log(`      KO ${b.status} ${b.type} ${b.url}`);
    fs.writeFileSync(path.join(dir, `${entry.tag}-images.json`), JSON.stringify(results, null, 2));
  }
  console.log(`\nRESULTAT IMAGES : ${failures === 0 ? "TOUTES LES IMAGES RÉPONDENT 200" : failures + " ECHEC(S)"}`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((error) => {
  console.error("ERREUR:", error && error.message ? error.message : error);
  process.exitCode = 2;
});
