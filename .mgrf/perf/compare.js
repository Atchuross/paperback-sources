// COMPARAISON DES URLs — prouve que la liste `pages` produite par la version
// parallélisée est IDENTIQUE, élément par élément et dans le même ordre, à celle
// de la version séquentielle (mesures réelles sur fanfox.net).
//
// Usage : node .mgrf/perf/compare.js
const fs = require("node:fs");
const path = require("node:path");

const dir = path.join(process.cwd(), ".mgrf", "perf");
const CASES = [
  // Référence séquentielle (avant, 1 req/s) vs version livrée (concurrente, 4 req/s).
  { tag: "court-18", before: "court-18-avant-rps1.pages.json", after: "court-18-apres-rps4.pages.json" },
  { tag: "long-46", before: "long-46-avant-rps1.pages.json", after: "long-46-apres-rps4.pages.json" },
  // Même DÉBIT des deux côtés (1 req/s) : isole l'effet de la seule
  // parallélisation (le débit est identique, seul le code change).
  { tag: "court-18 (même débit 1 req/s)", before: "court-18-avant-rps1.pages.json", after: "court-18-apres-rps1.pages.json" },
  { tag: "long-46 (même débit 1 req/s)", before: "long-46-avant-rps1.pages.json", after: "long-46-apres-rps1.pages.json" },
];

const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));

let failures = 0;
for (const testCase of CASES) {
  const before = read(testCase.before);
  const after = read(testCase.after);
  const rpsOf = (name) => Number(/rps(\d+)\.pages\.json$/.exec(name)?.[1] ?? NaN);
  const same =
    JSON.stringify(before.pages) === JSON.stringify(after.pages) &&
    before.pages.length === after.pages.length &&
    before.pages.length > 0;
  const diffs = [];
  for (let i = 0; i < Math.max(before.pages.length, after.pages.length); i += 1) {
    if (before.pages[i] !== after.pages[i]) diffs.push({ index: i, before: before.pages[i], after: after.pages[i] });
  }
  if (!same) failures += 1;
  console.log(
    `${same ? "OK  " : "FAIL"} ${testCase.tag} (${before.mangaId}/${before.chapterId}) : ` +
      `avant=${before.pages.length} pages (${before.elapsedMs} ms, rps=${rpsOf(testCase.before)}, en vol max=${before.maxInFlight}), ` +
      `après=${after.pages.length} pages (${after.elapsedMs} ms, rps=${rpsOf(testCase.after)}, en vol max=${after.maxInFlight}) — ` +
      `listes identiques (ordre inclus) = ${same}`,
  );
  for (const diff of diffs.slice(0, 5)) {
    console.log(`      diff[${diff.index}] avant=${diff.before} après=${diff.after}`);
  }
  console.log(`      ex. page[0] = ${after.pages[0]}`);
  console.log(`      ex. page[${after.pages.length - 1}] = ${after.pages[after.pages.length - 1]}`);
}

console.log(`\nRESULTAT: ${failures === 0 ? "URLS IDENTIQUES (ordre inclus) SUR LES 2 CHAPITRES" : failures + " ECHEC(S)"}`);
process.exitCode = failures === 0 ? 0 : 1;
