// Sonde /releases/ : structure des tuiles + pagination.
import fs from "node:fs";
import * as cheerio from "cheerio";

const file = process.argv[2];
const html = fs.readFileSync(file, "utf8");
const $ = cheerio.load(html);

console.log(`### ${file} (${html.length} octets)`);
console.log("manga-list-4 containers:", $("div[class*=manga-list-4]").length);
console.log("li total:", $("li").length);
console.log("manga-list-4-item-title:", $(".manga-list-4-item-title").length);
console.log("img.manga-list-4-cover:", $("img.manga-list-4-cover").length);

console.log("\n== titres de conteneurs manga-list-4-title ==");
$(".manga-list-4-title").each((i, el) => console.log(i, JSON.stringify($(el).text().trim()), $(el).find("a").attr("href")));

console.log("\n== pagination ==");
$("a[href*=page], .pager, [class*=page]").each((i, el) => {
  const href = $(el).attr("href");
  if (!href) return;
  console.log(i, JSON.stringify($(el).attr("class")), href, JSON.stringify($(el).text().trim().slice(0, 20)));
});

console.log("\n== 2 premiers li ==");
$("ul.manga-list-4-list > li").slice(0, 2).each((i, el) => {
  console.log(`\n[li ${i}]`, $.html(el).replace(/\s+/g, " ").slice(0, 700));
});

console.log("\n== tous les href de pages (fin de document) ==");
const tail = html.slice(-4000);
for (const m of tail.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([^<]{0,12})<\/a>/g)) {
  console.log(JSON.stringify(m[2].trim()), "->", m[1]);
}
