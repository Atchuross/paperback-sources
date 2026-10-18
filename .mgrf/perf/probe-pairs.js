// MESURE DE LA PISTE B (« demi-requêtes + rattrapage ») — décision documentée.
//
// Pour chaque page N d'un chapitre réel, l'endpoint `chapterfun.ashx` renvoie
// `pvalue = [ … ]`. La piste B consisterait à n'appeler que les pages impaires
// et à compléter les pages paires avec `pvalue[1]`. Cette sonde mesure la
// fiabilité EXACTE de cette hypothèse :
//   • `pvalue[0]` (utilisé par l'implémentation livrée) contre la référence
//     séquentielle ;
//   • `pvalue[1]` contre la page suivante de la référence ;
// et documente le piège n°3 (numérotation NON contiguë des fichiers du CDN).
//
// Usage : node .mgrf/perf/probe-pairs.js
const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");
const common = require(path.join(process.cwd(), "tmp", "Fanfox", "Common.js"));

const dir = path.join(process.cwd(), ".mgrf", "perf");
const HEADERS = { "User-Agent": common.BROWSER_USER_AGENT, Referer: common.DEFAULT_REFERER };
const CONCURRENCY = 4;
const RPS = 3;

const CASES = [
  { tag: "court-18", slug: "one_piece", chapter: "vTBE/c1196", reference: "court-18-avant-rps1.pages.json" },
  { tag: "long-46", slug: "bleach", chapter: "v00/c000", reference: "long-46-avant-rps1.pages.json" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Toutes les chaînes de `pvalue = [ … ]` d'une réponse (via l'unpacker de la source). */
function allPvalues(body) {
  const unpacked = common.unpackPackedScripts(body).join("\n") || (typeof body === "string" ? body : "");
  const arrayBody = /\bpvalue\s*=\s*\[([\s\S]*?)\]/.exec(unpacked)?.[1] ?? "";
  return (arrayBody.match(/"([^"]*)"/g) ?? []).map((q) => q.slice(1, -1)).map((v) => v.trim()).filter((v) => v.length > 0);
}

(async () => {
  const report = { measuredAt: new Date().toISOString(), cases: [] };

  for (const testCase of CASES) {
    const reference = JSON.parse(fs.readFileSync(path.join(dir, testCase.reference), "utf8")).pages;
    const readerHtml = Buffer.from(
      (await axios(common.chapterReaderUrl(testCase.slug, testCase.chapter, 1), { headers: HEADERS, timeout: 30000, responseType: "arraybuffer" })).data,
    ).toString();
    const meta = common.parseReaderMeta(readerHtml);

    const rows = new Array(meta.imageCount);
    let cursor = 0;
    let nextSlot = 0;
    const worker = async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= meta.imageCount) return;
        const page = index + 1;
        const now = Date.now();
        const slot = Math.max(now, nextSlot);
        nextSlot = slot + 1000 / RPS;
        if (slot > now) await sleep(slot - now);
        const url = common.chapterFunUrl(testCase.slug, testCase.chapter, meta.chapterNumericId, page, meta.guidKey);
        const body = Buffer.from(
          (await axios(url, { headers: HEADERS, timeout: 30000, responseType: "arraybuffer" })).data,
        ).toString();
        const values = allPvalues(body);
        const hostBase = /\bvar\s+pix\s*=\s*"([^"]*)"/.exec(common.unpackPackedScripts(body).join("\n") || body)?.[1] ?? "";
        rows[index] = {
          page,
          first: common.resolveCdnUrl(hostBase, values[0] ?? ""),
          second: common.resolveCdnUrl(hostBase, values[1] ?? ""),
          valueCount: values.length,
        };
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    const firstMatches = rows.filter((r, i) => r.first === reference[i]).length;
    let secondMatches = 0;
    const secondFailures = [];
    for (let i = 0; i < rows.length - 1; i += 1) {
      if (rows[i].second === reference[i + 1]) secondMatches += 1;
      else secondFailures.push({ page: rows[i].page, second: rows[i].second, expected: reference[i + 1] });
    }

    // Piège n°3 : numérotation des fichiers du CDN (motif `…/dNNN.jpg`).
    const names = reference.map((u) => /([^/]+\.jpg)/.exec(u)?.[1] ?? "?");
    const plateau = names.map((n) => Number.parseInt(/(\d+)\.jpg$/.exec(n)?.[1] ?? "NaN", 10));
    const gaps = [];
    for (let i = 1; i < plateau.length; i += 1) {
      if (Number.isFinite(plateau[i]) && Number.isFinite(plateau[i - 1]) && plateau[i] !== plateau[i - 1] + 1) {
        gaps.push({ index: i, avant: names[i - 1], apres: names[i] });
      }
    }

    report.cases.push({
      tag: testCase.tag,
      chapter: `${testCase.slug}/${testCase.chapter}`,
      imageCount: meta.imageCount,
      callsMade: rows.length,
      pvalue0MatchesReference: `${firstMatches}/${rows.length}`,
      pvalue1MatchesNextPage: `${secondMatches}/${rows.length - 1}`,
      pvalue1Failures: secondFailures.slice(0, 5),
      secondValuesPresent: rows.filter((r) => r.second.length > 0).length,
      cdnNumberingGaps: gaps,
    });

    console.log(`### ${testCase.tag} — ${testCase.slug}/${testCase.chapter} — ${rows.length} appels`);
    console.log(`    pvalue[0] == référence séquentielle        : ${firstMatches}/${rows.length}`);
    console.log(`    pvalue[1] == page suivante de la référence : ${secondMatches}/${rows.length - 1} (valeur présente sur ${rows.filter((r) => r.second.length > 0).length} réponses)`);
    for (const f of secondFailures.slice(0, 5)) {
      console.log(`      désaccord page=${f.page} pvalue[1]=${f.second} attendu=${f.expected}`);
    }
    console.log(`    trous de numérotation CDN détectés         : ${gaps.length}`);
    for (const g of gaps.slice(0, 5)) console.log(`      index ${g.index} : ${g.avant} → ${g.apres}`);
    console.log("");
  }

  fs.writeFileSync(path.join(dir, "piste-b.json"), JSON.stringify(report, null, 2));
  console.log("Rapport écrit : .mgrf/perf/piste-b.json");
})().catch((error) => {
  console.error("ERREUR:", error && error.message ? error.message : error);
  process.exitCode = 2;
});
