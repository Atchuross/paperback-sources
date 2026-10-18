// Vérifie les NOUVEAUX parseurs sur les pages RÉELLES déjà téléchargées
// (.mgrf/*.html), via le code compilé du dépôt (tmp/Fanfox/Common.js).
// Aucune requête réseau n'est émise ici : ce contrôle valide le parsing seul.
const fs = require("node:fs");
const path = require("node:path");

const common = require(path.join(process.cwd(), "tmp", "Fanfox", "Common.js"));

function read(name) {
  return fs.readFileSync(path.join(process.cwd(), ".mgrf", name), "utf8");
}

const cases = [
  ["releases.html", common.parseReleaseTiles, "releases"],
  ["trending.html", common.parseMangaList1Tiles, "trending"],
  ["home.html", common.parseReleaseTiles, "home (bloc Lastest Updates)"],
  ["home.html", common.parseMangaList1Tiles, "home (bloc Hot Manga Releases)"],
  ["releases-p2.html", common.parseReleaseTiles, "releases?page=2"],
  ["hot.html", common.parseMangaList1Tiles, "hot"],
];

let failures = 0;
for (const [file, fn, label] of cases) {
  const tiles = fn(read(file));
  const badImage = tiles.filter((t) => !/^https?:\/\//.test(t.image));
  const badId = tiles.filter((t) => !/^[a-z0-9_.-]+$/i.test(t.mangaId));
  const emptyTitle = tiles.filter((t) => t.title.trim().length === 0);
  const ok = tiles.length > 0 && badImage.length === 0 && badId.length === 0 && emptyTitle.length === 0;
  if (!ok) failures += 1;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${label.padEnd(34)} items=${String(tiles.length).padStart(3)}` +
      ` imagesAbsolues=${tiles.length - badImage.length}/${tiles.length}` +
      ` idsValides=${tiles.length - badId.length}/${tiles.length}` +
      ` titresVides=${emptyTitle.length}`,
  );
  if (tiles.length > 0) {
    console.log(`      ex: ${tiles[0].mangaId} | ${tiles[0].title.slice(0, 45)} | ${tiles[0].image.slice(0, 70)}`);
  }
}

// Non-régression : parseSearchTiles doit continuer de fonctionner à l'identique.
const searchPage = read("search.html");
const a = common.parseSearchTiles(searchPage).map((t) => t.mangaId);
const b = common.parseTiles(searchPage, "manga-list-4-item-title", "manga-list-4-cover").map((t) => t.mangaId);
console.log(`\nsearch: parseSearchTiles=${a.length} vs parseTiles(generic)=${b.length} identiques=${JSON.stringify(a) === JSON.stringify(b)}`);

console.log(`\nRESULTAT: ${failures === 0 ? "TOUTES LES SONDES DE PARSING PASSENT" : failures + " ECHEC(S)"}`);
process.exitCode = failures === 0 ? 0 : 1;
