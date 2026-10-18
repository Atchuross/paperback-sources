// Sonde générique d'une page : classes de listes, premier li, liens manga.
import fs from "node:fs";
import * as cheerio from "cheerio";

const file = process.argv[2];
const html = fs.readFileSync(file, "utf8");
const $ = cheerio.load(html);

console.log(`### ${file}`);
console.log("== classes des <ul>/<div> contenant >1 li ==");
$("ul, div").each((i, el) => {
  const li = $(el).children("li").length;
  if (li < 2) return;
  console.log(String(i).padStart(3), JSON.stringify($(el).attr("class") ?? ""), JSON.stringify($(el).attr("id") ?? ""), "li=", li);
});

console.log("\n== liens /manga/<slug>/ (dédupliqués, ordre) ==");
const seen = new Set();
const ids = [];
$("a[href^='/manga/']").each((i, el) => {
  const m = /^\/manga\/([^/]+)\/?$/.exec($(el).attr("href") ?? "");
  if (!m || seen.has(m[1])) return;
  seen.add(m[1]);
  ids.push(m[1]);
});
console.log(ids.length, ids.slice(0, 25));

console.log("\n== premier li du plus gros ul ==");
let best = null;
$("ul").each((i, el) => {
  const n = $(el).children("li").length;
  if (!best || n > $(best).children("li").length) best = el;
});
if (best) console.log($.html(best).replace(/\s+/g, " ").slice(0, 900));

console.log("\n== titres h1/h2/div[class*=title] ==");
$("h1,h2,h3,.manga-list-4-title,[class*=title]").each((i, el) => {
  const t = $(el).text().trim().replace(/\s+/g, " ");
  if (t.length > 0 && t.length < 60) console.log(String(i).padStart(3), JSON.stringify($(el).attr("class")), JSON.stringify(t));
});
