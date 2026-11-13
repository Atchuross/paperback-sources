/**
 * AsuraScans — lanceur de tests LOCAUX (harnais officiel `paperback test`).
 *
 * Le toolchain charge automatiquement `src/<SourceId>/<SourceId>.test.js` et
 * appelle `module.exports.runTests(testCase, testData, source, defaultRunTests)`.
 * Ce lanceur exécute D'ABORD la suite générique (accueil, fiche, chapitres,
 * pages, recherche) pilotée par `AsuraScans.test.json`, puis des cas explicites :
 *
 *   1. chapitre normal — `getChapterDetails("solo-leveling", "10")` : pages
 *      non vides, URLs absolues `https://`, aucun doublon (le nombre de pages
 *      n'est JAMAIS asserté : il change côté site, 13 puis 17 mesurées) ;
 *   2. image réellement téléchargée en HTTP 200, sans `Referer` ;
 *   3. recherche `solo` : au moins 5 résultats, `mangaId` non vides,
 *      au moins une couverture `https://` ;
 *   4. pagination réelle `limit`/`offset` (le paramètre `page` est ignoré) ;
 *   5. premium DÉTERMINISTE via la fixture `fixtures/chapter-premium.json`
 *      passée au mapper pur (`toChapterPages`) : erreur explicite contenant
 *      « abonné »/« accès anticipé » ET une date `YYYY-MM-DD HH:mm UTC` ;
 *   6. premium LIVE best-effort : si un chapitre `is_premium: true` existe
 *      encore, `getChapterDetails` doit lever la même erreur explicite ;
 *      sinon SKIP journalisé (le premium expire) ;
 *   7. entrées invalides (`mangaId` vide, `chapterId` mal formé) : erreur
 *      claire, AUCUNE requête réseau émise ;
 *   8. chapitres DÉCIMAUX (déterministe) : `toChapterEntries` conserve
 *      `100.5` (et écarte `number` null / négatif) ; `toChapterPages` rend sa
 *      page unique en `https://` depuis `fixtures/chapter-decimal.json` ;
 *   9. normalisation des numéros (déterministe) : `« 010 »` -> `« 10 »`,
 *      `« 100.50 »` -> `« 100.5 »`, refus de `-1`, `1e3`, `10.5.1`… ;
 *  10. chapitre DÉCIMAL LIVE best-effort : `100.5` de
 *      `solo-farming-in-the-tower` listé par `getChapters` et lisible
 *      (>= 1 page `https://`), sinon SKIP journalisé.
 *
 * ⚠ Le harnais Node ne valide NI les classes natives (`App.createXxx`) NI le
 * débit déclaré (`requestsPerSecond`) : la validation finale reste celle de
 * l'application, sur iPhone (cf. AGENTS.md).
 */

const path = require("node:path");
const axios = require("axios");

const ROOT = process.cwd();
const FIXTURES = path.join(ROOT, "src", "AsuraScans", "fixtures");

/** Module compilé (`paperback test` transpile `src/` vers `tmp/` avant la suite). */
function compiledCommon() {
  const file = path.join(ROOT, "tmp", "AsuraScans", "Common.js");
  // eslint-disable-next-line import/no-dynamic-require
  return require(file);
}

/** Fixture JSON du dossier `src/AsuraScans/fixtures`. */
function fixture(name) {
  // eslint-disable-next-line import/no-dynamic-require
  return require(path.join(FIXTURES, name));
}

/** Exécute une action et exige un rejet dont le message correspond au motif. */
async function expectReject(action, pattern, label) {
  let message = "";
  try {
    await action();
  } catch (error) {
    message = error && error.message ? error.message : String(error);
  }
  if (message.length === 0) {
    throw new Error(`aucune erreur levée alors qu'une erreur était attendue (${label})`);
  }
  if (!pattern.test(message)) {
    throw new Error(`message inattendu pour ${label} : « ${message} » (motif attendu ${pattern})`);
  }
  return message;
}

/** Télécharge réellement une URL et renvoie statut / type / taille. */
async function download(url, headers) {
  try {
    const response = await axios(url, { headers, timeout: 30000, responseType: "arraybuffer" });
    return {
      status: response.status,
      type: String(response.headers["content-type"] || ""),
      bytes: response.data ? response.data.length : 0,
    };
  } catch (error) {
    return {
      status: error && error.response ? error.response.status : `ERR ${error && error.message}`,
      type: "",
      bytes: 0,
    };
  }
}

module.exports = {
  async runTests(testCase, testData, source, defaultRunTests) {
    const common = compiledCommon();
    const browserHeaders = {
      "User-Agent": common.BROWSER_USER_AGENT,
      Accept: common.API_ACCEPT,
      "Accept-Language": "en-US,en;q=0.9",
    };

    /* ---- 1. Suite générique du harnais (accueil, fiche, chapitres, pages, recherche) ---- */
    await defaultRunTests(testCase, testData, source);

    /* ---- 2. Chapitre normal : pages non vides, https, sans doublon ---- */
    await testCase("AsuraScans chapitre normal : pages non vides, toutes en https://", async () => {
      const details = await source.getChapterDetails("solo-leveling", "10");
      if (!Array.isArray(details.pages) || details.pages.length === 0) {
        throw new Error("aucune page retournée pour solo-leveling/chapitre 10");
      }
      const insecure = details.pages.filter((url) => !/^https:\/\/\S+$/.test(url));
      if (insecure.length > 0) {
        throw new Error(`${insecure.length} URL(s) non https : « ${insecure[0]} »`);
      }
      if (new Set(details.pages).size !== details.pages.length) {
        throw new Error("le mapper a produit des URLs en double");
      }
      console.log(`        ${details.pages.length} pages (nombre non asserté), toutes https://`);
    });

    /* ---- 3. Une image réellement téléchargée en HTTP 200, sans Referer ---- */
    await testCase("AsuraScans image : 1re page téléchargée en HTTP 200 (sans Referer)", async () => {
      const details = await source.getChapterDetails("solo-leveling", "10");
      const url = details.pages[0];
      const result = await download(url, { "User-Agent": common.BROWSER_USER_AGENT });
      if (result.status !== 200) {
        throw new Error(`image non téléchargeable (${result.status}) : ${url}`);
      }
      if (!/^image\//i.test(result.type)) {
        throw new Error(`type de contenu inattendu « ${result.type} » pour ${url}`);
      }
      if (!(result.bytes > 1000)) {
        throw new Error(`image suspicieusement petite (${result.bytes} octets) : ${url}`);
      }
      console.log(`        ${result.status} ${result.type} ${result.bytes} o — ${url}`);
    });

    /* ---- 4. Recherche ---- */
    await testCase("AsuraScans recherche : « solo » rend au moins 5 résultats exploitables", async () => {
      const paged = await source.getSearchResults(
        { title: "solo", includedTags: [], excludedTags: [], parameters: {} },
        {},
      );
      const results = paged.results || [];
      if (results.length < 5) {
        throw new Error(`au moins 5 résultats attendus pour « solo », ${results.length} obtenus`);
      }
      const emptyIds = results.filter((entry) => typeof entry.mangaId !== "string" || entry.mangaId.length === 0);
      if (emptyIds.length > 0) {
        throw new Error(`${emptyIds.length} résultat(s) sans mangaId`);
      }
      const httpsCovers = results.filter((entry) => typeof entry.image === "string" && /^https:\/\//.test(entry.image));
      if (httpsCovers.length === 0) {
        throw new Error("aucune couverture https:// parmi les résultats");
      }
      if (!results.some((entry) => entry.mangaId === "solo-leveling")) {
        throw new Error("« solo-leveling » absent des résultats de la recherche « solo »");
      }
      console.log(
        `        ${results.length} résultats, ${httpsCovers.length} couvertures https://, ` +
          `metadata=${JSON.stringify(paged.metadata)}`,
      );
    });

    /* ---- 4 bis. Pagination réelle par offset (le paramètre `page` est ignoré) ---- */
    await testCase("AsuraScans pagination recherche : offset réel, pas de page ignorée", async () => {
      const first = await source.getSearchResults(
        { title: "the", includedTags: [], excludedTags: [], parameters: {} },
        {},
      );
      const firstIds = (first.results || []).map((entry) => entry.mangaId);
      if (firstIds.length === 0) throw new Error("première page vide pour « the »");
      if (!first.metadata || typeof first.metadata.offset !== "number") {
        throw new Error(`metadata de suite attendue pour « the », reçu ${JSON.stringify(first.metadata)}`);
      }
      if (first.metadata.offset !== 20) {
        throw new Error(`offset suivant attendu = 20, reçu ${first.metadata.offset}`);
      }

      const second = await source.getSearchResults(
        { title: "the", includedTags: [], excludedTags: [], parameters: {} },
        first.metadata,
      );
      const secondIds = (second.results || []).map((entry) => entry.mangaId);
      if (secondIds.length === 0) throw new Error("seconde page vide pour « the »");
      if (secondIds.some((id) => firstIds.indexOf(id) >= 0)) {
        throw new Error("la seconde page répète des résultats de la première (offset non appliqué)");
      }
      console.log(
        `        page 1 = ${firstIds.length} items (1er « ${firstIds[0]} »), ` +
          `page 2 = ${secondIds.length} items (1er « ${secondIds[0]} »), metadata=${JSON.stringify(second.metadata)}`,
      );
    });

    /* ---- 4 ter. « Voir plus » d'une section d'accueil (getViewMoreItems) ---- */
    await testCase("AsuraScans « voir plus » : getViewMoreItems(trending) et id inconnu", async () => {
      const paged = await source.getViewMoreItems("trending", {});
      const results = paged.results || [];
      if (results.length === 0) {
        throw new Error("getViewMoreItems(« trending », {}) n'a rendu aucun item");
      }
      if (!paged.metadata || paged.metadata.offset !== 20) {
        throw new Error(`offset de suite attendu 20, reçu ${JSON.stringify(paged.metadata)}`);
      }

      const unknown = await source.getViewMoreItems("section-inexistante", {});
      if ((unknown.results || []).length !== 0 || unknown.metadata !== undefined) {
        throw new Error("un identifiant de section inconnu doit rendre une liste vide sans erreur");
      }
      console.log(
        `        trending : ${results.length} items (1er « ${results[0].mangaId} »), ` +
          `metadata=${JSON.stringify(paged.metadata)} ; id inconnu -> 0 item`,
      );
    });

    /* ---- 5. Premium DÉTERMINISTE (fixture -> mapper pur) ---- */
    await testCase("AsuraScans premium (fixture) : erreur explicite avec date d'ouverture", () => {
      const payload = fixture("chapter-premium.json");
      let message = "";
      try {
        common.toChapterPages(payload, "solo-farming-in-the-tower", "152");
      } catch (error) {
        message = error && error.message ? error.message : String(error);
      }
      if (message.length === 0) {
        throw new Error("aucune erreur levée pour un chapitre premium is_premium:true sans pages");
      }
      if (!/abonn|accès anticipé/i.test(message)) {
        throw new Error(`le message ne mentionne pas les abonnés / l'accès anticipé : « ${message} »`);
      }
      if (!/\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/.test(message)) {
        throw new Error(`le message ne contient pas de date UTC : « ${message} »`);
      }
      if (message.indexOf("2026-11-13 21:51 UTC") < 0) {
        throw new Error(`date d'ouverture attendue 2026-11-13 21:51 UTC, message : « ${message} »`);
      }
      console.log(`        erreur levée : ${message}`);
    });

    /* ---- 5 bis. Chapitre normal de la fixture : mapper positif (3 pages) ---- */
    await testCase("AsuraScans chapitre normal (fixture) : 3 pages mappées, aucune erreur", () => {
      const payload = fixture("chapter-normal.json");
      const pages = common.toChapterPages(payload, "solo-leveling", "10");
      if (!Array.isArray(pages) || pages.length !== 3) {
        throw new Error(`3 pages attendues depuis la fixture, ${pages ? pages.length : "aucune"} obtenue(s)`);
      }
      const insecure = pages.filter((url) => !/^https:\/\//.test(url));
      if (insecure.length > 0) throw new Error(`URL non https dans la fixture : ${insecure[0]}`);
      if (pages[0].indexOf("/142202/001.webp") < 0) {
        throw new Error(`ordre des pages inattendu : ${pages[0]}`);
      }
      console.log(`        ${pages.length} pages : ${pages.join(" | ")}`);
    });

    /* ---- 5 ter. Premium LIVE best-effort (SKIP si le premium a expiré) ---- */
    await testCase("AsuraScans premium (live, best-effort) : erreur explicite ou SKIP", async () => {
      const candidates = ["solo-farming-in-the-tower", "solo-leveling-ragnarok", "the-greatest-estate-developer"];
      let found = null;

      for (const slug of candidates) {
        let list = [];
        try {
          const response = await axios(`${common.API_BASE_URL}${common.API_SERIES_PATH}/${slug}/chapters`, {
            headers: browserHeaders,
            timeout: 30000,
          });
          list = response.data && Array.isArray(response.data.data) ? response.data.data : [];
        } catch (error) {
          console.log(`        ${slug} : liste indisponible (${error && error.message}) — candidat ignoré`);
          continue;
        }
        const premium = list.find((entry) => entry && entry.is_premium === true);
        if (premium) {
          found = { slug, number: premium.number };
          break;
        }
      }

      if (!found) {
        console.log(
          "        SKIP : aucun chapitre is_premium:true actif parmi " +
            `${candidates.join(", ")} (le premium a expiré) — cas couvert par la fixture`,
        );
        return;
      }

      let message = "";
      try {
        await source.getChapterDetails(found.slug, String(found.number));
      } catch (error) {
        message = error && error.message ? error.message : String(error);
      }
      if (message.length === 0) {
        throw new Error(
          `getChapterDetails a rendu des pages pour le chapitre premium ${found.slug}/${found.number} ` +
            `(une erreur explicite était attendue)`,
        );
      }
      if (!/abonn|accès anticipé/i.test(message)) {
        throw new Error(`le message live ne mentionne pas les abonnés / l'accès anticipé : « ${message} »`);
      }
      console.log(`        ${found.slug}/${found.number} : ${message}`);
    });

    /* ---- 6. Erreurs LIVE : 404 série / chapitre et `{"data":[]}` traduits ---- */
    await testCase("AsuraScans erreurs live : série inconnue, liste vide et chapitre 404", async () => {
      const seriesMessage = await expectReject(
        () => source.getMangaDetails("zzz-inexistant-00000000"),
        /Série introuvable/,
        "fiche d'une série inconnue",
      );
      const chaptersMessage = await expectReject(
        () => source.getChapters("zzz-inexistant-00000000"),
        /Série introuvable/,
        "chapitres d'une série inconnue ({\"data\":[]} + 404 fiche)",
      );
      const chapterMessage = await expectReject(
        () => source.getChapterDetails("solo-leveling", "999"),
        /Chapitre introuvable/,
        "chapitre 999 inexistant",
      );
      console.log(`        série : ${seriesMessage}`);
      console.log(`        liste : ${chaptersMessage}`);
      console.log(`        page  : ${chapterMessage}`);
    });

    /* ---- 7. Entrées invalides : erreur claire, aucune requête réseau ---- */
    await testCase("AsuraScans entrées invalides : erreur claire sans requête réseau", async () => {
      const manager = source.requestManager;
      const originalSchedule = manager.schedule;
      let networkCalls = 0;
      let patched = false;
      try {
        manager.schedule = function patchedSchedule(...args) {
          networkCalls += 1;
          return originalSchedule.apply(this, args);
        };
        patched = true;
      } catch (error) {
        patched = false;
      }

      try {
        await expectReject(() => source.getMangaDetails(""), /Identifiant de série invalide/, "mangaId vide");
        await expectReject(() => source.getChapters("   "), /Identifiant de série invalide/, "mangaId blanc");
        await expectReject(
          () => source.getChapterDetails("solo-leveling", "abc"),
          /Identifiant de chapitre invalide/,
          "chapterId « abc »",
        );
        // « 10.5 » est un numéro DÉCIMAL valide (mesuré : l'API sert /chapters/100.5) :
        // c'est une forme MAL formée (« 10.5.1 », exposant) qui doit être refusée.
        await expectReject(
          () => source.getChapterDetails("solo-leveling", "10.5.1"),
          /Identifiant de chapitre invalide/,
          "chapterId « 10.5.1 »",
        );
        await expectReject(
          () => source.getChapterDetails("solo-leveling", "1e3"),
          /Identifiant de chapitre invalide/,
          "chapterId « 1e3 » (exposant)",
        );
        await expectReject(
          () => source.getChapterDetails("", "10"),
          /Identifiant de série invalide/,
          "mangaId vide (pages)",
        );
        await expectReject(
          () => source.getChapterDetails("solo-leveling", "-1"),
          /Identifiant de chapitre invalide/,
          "chapterId « -1 »",
        );
      } finally {
        if (patched) manager.schedule = originalSchedule;
      }

      if (patched && networkCalls !== 0) {
        throw new Error(`${networkCalls} requête(s) réseau émise(s) malgré des entrées invalides`);
      }
      console.log(
        patched
          ? "        7 entrées invalides rejetées, 0 requête réseau"
          : "        7 entrées invalides rejetées (compteur réseau indisponible dans ce runtime)",
      );
    });

    /* ---- 8. Chapitres DÉCIMAUX (déterministe) : le mapper ne perd plus 100.5 ---- */
    await testCase("AsuraScans chapitre décimal (fixture) : toChapterEntries conserve 100.5", () => {
      const payload = fixture("chapter-list-decimal.json");
      const entries = common.toChapterEntries(payload);
      const ids = entries.map((entry) => entry.chapterId);
      const expected = ["101", "100.5", "100"];
      if (ids.join(",") !== expected.join(",")) {
        throw new Error(`chapitres attendus ${expected.join(", ")} (décroissant), reçus ${ids.join(", ")}`);
      }
      const decimal = entries.find((entry) => entry.chapterId === "100.5");
      if (!decimal) throw new Error("le chapitre décimal 100.5 a été écarté par le mapper");
      if (decimal.chapNum !== 100.5) {
        throw new Error(`chapNum attendu 100.5, reçu ${String(decimal.chapNum)}`);
      }
      if (decimal.name !== "") {
        throw new Error(`title null attendu -> name vide, reçu « ${decimal.name} »`);
      }
      // Les deux entrées synthétiques (number null, number négatif) sont écartées.
      if (entries.length !== 3) {
        throw new Error(`3 entrées attendues (null et négatif écartés), ${entries.length} reçues`);
      }
      console.log(`        ${entries.length} entrées : ${ids.join(", ")} (chapNum 100.5 conservé)`);
    });

    /* ---- 9. Pages d'un chapitre DÉCIMAL (déterministe, fixture réelle 100.5) ---- */
    await testCase("AsuraScans chapitre décimal (fixture) : 100.5 rend 1 page https", () => {
      const payload = fixture("chapter-decimal.json");
      const pages = common.toChapterPages(payload, "solo-farming-in-the-tower", "100.5");
      if (!Array.isArray(pages) || pages.length !== 1) {
        throw new Error(`1 page attendue depuis la fixture 100.5, ${pages ? pages.length : "aucune"} obtenue(s)`);
      }
      if (!/^https:\/\/\S+$/.test(pages[0])) {
        throw new Error(`URL non https pour le chapitre 100.5 : ${pages[0]}`);
      }
      if (pages[0].indexOf("/100.5/001.webp") < 0) {
        throw new Error(`ordre/chemin de page inattendu : ${pages[0]}`);
      }
      const url = common.chapterPagesUrl("solo-farming-in-the-tower", "100.5");
      if (url.indexOf("/chapters/100.5") < 0) {
        throw new Error(`URL de chapitre décimal mal construite : ${url}`);
      }
      console.log(`        ${pages.length} page : ${pages[0]}`);
    });

    /* ---- 9 bis. Normalisation des numéros (déterministe, aucune requête) ---- */
    await testCase("AsuraScans numéros de chapitre : normalisation et refus déterministes", () => {
      const accepted = [
        ["10", "10"],
        ["010", "10"],
        ["0", "0"],
        ["0.0", "0"],
        ["100.5", "100.5"],
        ["100.50", "100.5"],
        ["000.0010", "0.001"],
        [100.5, "100.5"],
        [7, "7"],
      ];
      for (const [input, expected] of accepted) {
        const actual = common.sanitizeChapterId(input);
        if (actual !== expected) {
          throw new Error(`sanitizeChapterId(${JSON.stringify(input)}) = « ${actual} », attendu « ${expected} »`);
        }
      }
      const rejected = ["", " ", "abc", "-1", "10.5.1", "1e3", "10.", ".5", "1 0", "+1", "0x10"];
      for (const input of rejected) {
        let message = "";
        try {
          common.sanitizeChapterId(input);
        } catch (error) {
          message = error && error.message ? error.message : String(error);
        }
        if (message.length === 0) {
          throw new Error(`sanitizeChapterId(${JSON.stringify(input)}) aurait dû être refusé`);
        }
        if (!/Identifiant de chapitre invalide/.test(message)) {
          throw new Error(`message inattendu pour ${JSON.stringify(input)} : « ${message} »`);
        }
      }
      console.log(
        `        ${accepted.length} formes acceptées (dont « 010 » -> « 10 » et « 100.50 » -> « 100.5 »), ` +
          `${rejected.length} formes refusées`,
      );
    });

    /* ---- 9 ter. Chapitre DÉCIMAL LIVE best-effort (SKIP si la donnée disparaît) ---- */
    await testCase("AsuraScans chapitre décimal (live, best-effort) : 100.5 listé et lisible, ou SKIP", async () => {
      const slug = "solo-farming-in-the-tower";
      const chapterId = "100.5";

      let chapters = [];
      try {
        chapters = await source.getChapters(slug);
      } catch (error) {
        console.log(
          `        SKIP : getChapters(« ${slug} ») indisponible (${error && error.message}) — cas couvert par les fixtures`,
        );
        return;
      }

      const listed = chapters.find((entry) => entry.id === chapterId);
      if (!listed) {
        console.log(
          `        SKIP : « ${slug} » ne publie plus ${chapterId} (${chapters.length} chapitres listés) — ` +
            "cas couvert par les fixtures",
        );
        return;
      }
      if (listed.chapNum !== 100.5) {
        throw new Error(`chapNum attendu 100.5 pour ${slug}/${chapterId}, reçu ${String(listed.chapNum)}`);
      }

      let details = null;
      let message = "";
      try {
        details = await source.getChapterDetails(slug, chapterId);
      } catch (error) {
        message = error && error.message ? error.message : String(error);
      }

      if (!details) {
        if (/abonn|accès anticipé|introuvable/i.test(message)) {
          console.log(`        SKIP : ${slug}/${chapterId} n'est plus librement lisible (${message})`);
          return;
        }
        throw new Error(`getChapterDetails(${slug}, ${chapterId}) a échoué : ${message}`);
      }

      const pages = details.pages || [];
      if (pages.length === 0) throw new Error(`aucune page pour ${slug}/${chapterId}`);
      const insecure = pages.filter((url) => !/^https:\/\//.test(url));
      if (insecure.length > 0) throw new Error(`URL non https pour ${slug}/${chapterId} : ${insecure[0]}`);
      if (details.id !== chapterId) {
        throw new Error(`id de chapitre attendu « ${chapterId} », reçu « ${details.id} »`);
      }
      console.log(`        ${slug}/${chapterId} : listé (chapNum 100.5) et ${pages.length} page(s) https`);
    });
  },
};
