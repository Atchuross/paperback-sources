// Recherche de chapitres RÉELS sur fanfox.net : lit `var imagecount` des pages de
// lecture (1 requête par chapitre, espacée) pour choisir un chapitre « court »
// (~18 pages) et un chapitre « long » (~46 pages) servant aux mesures PERF.
//
// Aucune modification du dépôt : sonde de reconnaissance uniquement.
const path = require("node:path");
const axios = require("axios");
const common = require(path.join(process.cwd(), "tmp", "Fanfox", "Common.js"));

const HEADERS = {
  "User-Agent": common.BROWSER_USER_AGENT,
  Referer: common.DEFAULT_REFERER,
};

const MANGA = process.argv[2] ?? "one_piece";
const LIST = (process.argv[3] ?? "vTBE/c1196,vTBE/c1195,vTBE/c1194,vTBE/c1193,vTBE/c1192,vTBE/c1191,vTBE/c1190,vTBE/c1189,vTBE/c1188,vTBE/c1187,vTBE/c1186,vTBE/c1185").split(",");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const out = [];
  for (const chapterId of LIST) {
    const url = common.chapterReaderUrl(MANGA, chapterId, 1);
    let meta = { imageCount: 0, chapterNumericId: "", guidKey: "" };
    let status = "?";
    try {
      const res = await axios(url, { headers: HEADERS, timeout: 20000, responseType: "arraybuffer" });
      status = res.status;
      meta = common.parseReaderMeta(Buffer.from(res.data).toString());
    } catch (error) {
      status = `ERR ${error.message}`;
    }
    console.log(
      `${String(meta.imageCount).padStart(3)} pages | cid=${meta.chapterNumericId.padStart(7)} | key=${meta.guidKey ? "OK" : "MANQUANTE"} | ${status} | ${chapterId}`,
    );
    out.push({ chapterId, imageCount: meta.imageCount, chapterNumericId: meta.chapterNumericId, guidKey: meta.guidKey, url });
    await sleep(400);
  }
  console.log("\nJSON:", JSON.stringify(out.filter((o) => o.imageCount > 0)));
})().catch((e) => {
  console.error("ERREUR:", e.message);
  process.exitCode = 2;
});
