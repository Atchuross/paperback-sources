// Extrait le conteneur « releases » de l'accueil + affiche sa structure brute.
import fs from "node:fs";
import * as cheerio from "cheerio";

const file = new URL("./home.html", import.meta.url).pathname;
const html = fs.readFileSync(file, "utf8");
const $ = cheerio.load(html);

const containers = $("div[class*=manga-list]").toArray();
for (const el of containers) {
  const cls = $(el).attr("class") ?? "";
  if (!/\bmanga-list-4\b/.test(cls)) continue;
  console.log("== container", JSON.stringify(cls));
  const raw = $.html(el).replace(/\s+/g, " ");
  console.log(raw.slice(0, 3000));
  console.log("\n... total len:", raw.length);
}

console.log("\n== tous les <h*> et titres visibles près de /releases/ ==");
$("a[href='/releases/']").each((i, el) => {
  const block = $(el).closest("div[class*=manga-list]");
  console.log(i, JSON.stringify($(el).text().trim()), "| parentClass=", JSON.stringify(block.attr("class")), "| li=", block.find("ul > li").length);
  console.log("   h-tags:", block.find("h1,h2,h3,h4,span").map((j, x) => $(x).text().trim()).get().slice(0, 8).join(" | "));
});
