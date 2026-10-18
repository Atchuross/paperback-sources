/**
 * Fanfox — lanceur de tests LOCAUX (harnais officiel `paperback test`).
 *
 * Le harnais officiel exécute, pour chaque source, la suite générique
 * (accueil, fiche, liste des chapitres, pages de chapitre, recherche) pilotée
 * par `Fanfox.test.json`. Ce lanceur exécute D'ABORD cette suite, puis ajoute
 * des cas explicites sur les points que la suite générique ne couvre pas :
 *
 *   1. FORMAT B — chapitre dont la page de lecture embarque la liste complète
 *      des URLs d'images (incident `t_c75d5d7d`) : 98 pages attendues, URLs
 *      absolues, et 3 images réellement téléchargées en HTTP 200 (Referer
 *      fanfox.net exigé par le CDN) ;
 *   2. FORMAT A — non-régression des chapitres classiques (clé `guidkey`) :
 *      `one_piece/vTBE/c1196` = 18 pages, `naruto/v72/c700.6` = 46 pages ;
 *   3. 18+ — `grand_blue` (cookie `isAdult=1`) doit rendre sa liste de
 *      chapitres.
 *
 * ⚠ Le harnais Node ne valide NI les classes natives (`App.createXxx`) NI le
 * débit déclaré : la validation finale reste celle de l'application, sur
 * iPhone (cf. AGENTS.md).
 */

const path = require("node:path");
const axios = require("axios");

/** Constantes d'en-tête : reprises du module compilé (repli littéral documenté). */
function headers() {
  try {
    // `paperback test` transpile `src/` vers `tmp/` avant d'exécuter la suite.
    const common = require(path.join(process.cwd(), "tmp", "Fanfox", "Common.js"));
    return { "User-Agent": common.BROWSER_USER_AGENT, Referer: common.DEFAULT_REFERER };
  } catch (error) {
    return {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Referer: "https://fanfox.net/",
    };
  }
}

/** Télécharge réellement une URL d'image et renvoie son statut HTTP. */
async function imageStatus(url) {
  try {
    const response = await axios(url, { headers: headers(), timeout: 30000, responseType: "arraybuffer" });
    return { status: response.status, type: response.headers["content-type"], bytes: response.data.length };
  } catch (error) {
    return { status: error.response ? error.response.status : `ERR ${error.message}`, type: "", bytes: 0 };
  }
}

module.exports = {
  async runTests(testCase, testData, source, defaultRunTests) {
    // ---- 1. Suite générique du harnais (accueil, fiche, chapitres, recherche, pages) ----
    await defaultRunTests(testCase, testData, source);

    // ---- 2. FORMAT B : liste d'images embarquée dans la page de lecture ----
    await testCase("Fanfox format B : chapitre à URLs d'images embarquées (98 pages)", async () => {
      const details = await source.getChapterDetails("oshi_no_shuuchakushin_wo_namete_ita", "c001");
      if (details.pages.length !== 98) {
        throw new Error(`98 pages attendues pour le format B, ${details.pages.length} obtenues`);
      }
      const notAbsolute = details.pages.filter((url) => !/^https:\/\/\S+$/.test(url));
      if (notAbsolute.length > 0) {
        throw new Error(`${notAbsolute.length} URL(s) non absolue(s), ex. « ${notAbsolute[0]} »`);
      }
      if (new Set(details.pages).size !== details.pages.length) {
        throw new Error("le format B a produit des URLs en double");
      }
      const statuses = [];
      for (const index of [0, 1, 2]) {
        const result = await imageStatus(details.pages[index]);
        statuses.push(`page[${index}] ${result.status} ${result.type} ${result.bytes}o`);
        if (result.status !== 200) {
          throw new Error(`image de la page ${index} non téléchargeable : ${result.status}`);
        }
      }
      console.log(`        format B : ${details.pages.length} pages, 1 requête ; ${statuses.join(" | ")}`);
    });

    // ---- 3. FORMAT A : non-régression des chapitres classiques (clé guidkey) ----
    const formatACases = [
      { slug: "one_piece", chapter: "vTBE/c1196", pages: 18 },
      { slug: "naruto", chapter: "v72/c700.6", pages: 46 },
    ];
    for (const testCaseData of formatACases) {
      await testCase(
        `Fanfox format A : ${testCaseData.slug}/${testCaseData.chapter} (${testCaseData.pages} pages)`,
        async () => {
          const details = await source.getChapterDetails(testCaseData.slug, testCaseData.chapter);
          if (details.pages.length !== testCaseData.pages) {
            throw new Error(
              `${testCaseData.pages} pages attendues pour ${testCaseData.slug}/${testCaseData.chapter}, ` +
                `${details.pages.length} obtenues`,
            );
          }
          console.log(`        format A : ${details.pages.length} pages (attendu ${testCaseData.pages})`);
        },
      );
    }

    // ---- 4. 18+ : cookie `isAdult=1` (liste de chapitres d'une série classée) ----
    //
    // ⚠ Le polyfill Node du harnais ne fournit AUCUN `cookieStore` (mesuré) :
    // la source ne peut donc pas poser `isAdult=1` ici, et l'écran d'âge du site
    // bloque la fiche. Le cas accepte donc DEUX issues et en exige une :
    //   • le magasin de cookies est disponible (runtime natif) → liste complète ;
    //   • le magasin est absent (harnais Node) → erreur explicite mentionnant le
    //     18+, `isAdult` ET l'absence de magasin, JAMAIS une liste vide muette.
    // La liste réelle de `grand_blue` (149 chapitres) est vérifiée hors suite par
    // `.mgrf/perf/probe-adult.js` (magasin de cookies émulé) et reste à valider
    // sur l'iPhone, seule plateforme qui fournit ce magasin.
    await testCase("Fanfox 18+ : « grand_blue » rend sa liste OU signale explicitement le blocage", async () => {
      let chapters = [];
      let diagnostic = "";
      try {
        chapters = await source.getChapters("grand_blue");
      } catch (error) {
        diagnostic = error && error.message ? error.message : String(error);
      }

      if (chapters.length >= 100) {
        console.log(`        18+ : ${chapters.length} chapitres (magasin de cookies disponible)`);
        return;
      }

      const explicit =
        /18\+/.test(diagnostic) && /isAdult/i.test(diagnostic) && /magasin de cookies/.test(diagnostic);
      if (!explicit) {
        throw new Error(
          `liste de chapitres 18+ inexploitable (${chapters.length} entrée(s)) sans diagnostic explicite : ` +
            `« ${diagnostic || "aucune erreur levée"} »`,
        );
      }
      console.log(
        "        18+ : harnais Node sans magasin de cookies ⇒ blocage d'âge signalé explicitement " +
          "(liste réelle 149 chapitres vérifiée par .mgrf/perf/probe-adult.js ; validation iPhone requise)",
      );
    });
  },
};
