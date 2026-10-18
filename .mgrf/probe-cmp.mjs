// Compare deux pages /releases/ (page 1 vs ?page=2) : mêmes tuiles ou non ?
import fs from "node:fs";
import * as cheerio from "cheerio";

function load(file) {
  const html = fs.readFileSync(file, "utf8");
  const $ = cheerio.load(html);
  const ids = [];
  $("p.manga-list-4-item-title a").each((i, el) => {
    const m = /^\/manga\/([^/]+)\/?$/.exec($(el).attr("href") ?? "");
    if (m) ids.push(m[1]);
  });
  return { html, ids, covers: $("img.manga-list-4-cover").length };
}

const a = load(process.argv[2]);
const b = load(process.argv[3]);
console.log("page1:", a.ids.length, a.ids.slice(0, 8));
console.log("page2:", b.ids.length, b.ids.slice(0, 8));
console.log("identiques ?", JSON.stringify(a.ids) === JSON.stringify(b.ids));
console.log("intersection:", a.ids.filter((x) => b.ids.includes(x)).length);
console.log("covers p1/p2:", a.covers, b.covers);
