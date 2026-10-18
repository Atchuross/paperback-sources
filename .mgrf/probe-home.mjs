// Sonde locale : structure de la page d'accueil fanfox.net (fichier .mgrf/home.html).
// N'émet AUCUNE requête réseau : lit le HTML déjà téléchargé.
import fs from "node:fs";
import * as cheerio from "cheerio";

const html = fs.readFileSync(new URL("./home.html", import.meta.url), "utf8");
const $ = cheerio.load(html);

function dump(label, sel) {
  console.log(`--- ${label} : ${sel} -> ${$(sel).length}`);
}

dump("manga-list-1 (Latest Updates) blocks", "div.manga-list-1");
dump("manga-list-1-title", ".manga-list-1-title");
dump("manga-list-1-list", ".manga-list-1-list");
dump("manga-list-1-list > li", ".manga-list-1-list > li");
dump("manga-list-2 blocks", "div.manga-list-2");
dump("manga-list-2-title", ".manga-list-2-title");
dump("manga-list-2-list > li", ".manga-list-2-list > li");
dump("manga-list-3-show-say", ".manga-list-3-show-say");
dump("swiper-slide", ".swiper-slide");

console.log("\n=== titres des sections (manga-list-*-title) ===");
$(".manga-list-1-title, .manga-list-2-title").each((i, el) => {
  console.log(i, JSON.stringify($(el).text().trim()), "href=", $(el).find("a").attr("href"));
});

console.log("\n=== 3 premiers <li> de manga-list-1-list (brut, tronqué) ===");
$(".manga-list-1-list > li")
  .slice(0, 3)
  .each((i, el) => {
    console.log(`\n[li ${i}] ${$.html(el).replace(/\s+/g, " ").slice(0, 900)}`);
  });

console.log("\n=== 2 premiers <li> de manga-list-2-list (brut, tronqué) ===");
$(".manga-list-2-list > li")
  .slice(0, 2)
  .each((i, el) => {
    console.log(`\n[li ${i}] ${$.html(el).replace(/\s+/g, " ").slice(0, 900)}`);
  });

console.log("\n=== liens 'more' ===");
$("a.manga-list-1-more, a.manga-list-2-more").each((i, el) => {
  console.log(i, $(el).attr("href"), JSON.stringify($(el).text().trim()));
});

console.log("\n=== comptage par liste ===");
$(".manga-list-1-list").each((i, el) => console.log("list-1", i, "li=", $(el).children("li").length));
$(".manga-list-2-list").each((i, el) => console.log("list-2", i, "li=", $(el).children("li").length));
