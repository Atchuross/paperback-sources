// Sonde structurelle : associe chaque conteneur de liste à son titre, sa classe
// et le lien « more ». Lit uniquement .mgrf/*.html déjà téléchargés.
import fs from "node:fs";
import * as cheerio from "cheerio";

const file = process.argv[2] ?? new URL("./home.html", import.meta.url).pathname;
const html = fs.readFileSync(file, "utf8");
const $ = cheerio.load(html);

console.log(`### fichier = ${file}`);

// Tous les titres de section, avec leur classe réelle et le href associé
console.log("\n== titres de section ==");
$(".manga-list-1-title, .manga-list-2-title, .manga-list-1-more, .manga-list-2-more").each(
  (i, el) => {
    console.log(
      String(i).padStart(2),
      "class=",
      JSON.stringify($(el).attr("class")),
      "text=",
      JSON.stringify($(el).text().trim().slice(0, 40)),
      "href=",
      $(el).find("a").attr("href"),
    );
  },
);

// Conteneurs : classe, titre porté, nombre de li, href "more"
console.log("\n== conteneurs de listes ==");
$("div[class*=manga-list]").each((i, el) => {
  const cls = $(el).attr("class") ?? "";
  const title = $(el).find(".manga-list-1-title, .manga-list-2-title").first().text().trim();
  const liDirect = $(el).children("ul").children("li").length;
  const more = $(el).find("a[class*=more]").first().attr("href");
  if (!title && liDirect === 0 && !more) return;
  console.log(
    String(i).padStart(2),
    JSON.stringify(cls),
    "| titre=",
    JSON.stringify(title.slice(0, 40)),
    "| li=",
    liDirect,
    "| more=",
    more,
  );
});

// Sections par ancre de titre connue
console.log("\n== section avec ancre /hot/, /ranking/, /trending/, /directory/ ==");
$("a[href='/hot/'], a[href='/ranking/'], a[href='/trending/'], a[href='/directory/?news']").each(
  (i, el) => {
    const block = $(el).closest("div[class*=manga-list]");
    console.log(
      i,
      $(el).attr("href"),
      "| containerClass=",
      JSON.stringify(block.attr("class")),
      "| li=",
      block.find("ul > li").length,
    );
  },
);
