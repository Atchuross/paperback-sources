"use strict";
/**
 * Fanfox — contrats de données (formes réellement observées le 2026-10-18).
 *
 * Ces interfaces décrivent uniquement les entités extraites du HTML / du JS
 * public de `https://fanfox.net`, relevées par requêtes réelles (UA navigateur,
 * ≥ 1 s entre requêtes) dans ce workspace :
 *   - GET /releases/                                     -> HTML (21 tuiles « Lastest Updates »)
 *   - GET /trending/                                     -> HTML (28 tuiles « Trending Manga »)
 *   - GET /search?title=<q>&page=<n>                     -> HTML (12 tuiles / page)
 *   - GET /manga/<slug>/                                 -> HTML (fiche + chapitres)
 *   - GET /manga/<slug>/<chapterId>/1.html                -> HTML (lecteur, imagecount)
 *   - GET /manga/<slug>/<chapterId>/chapterfun.ashx?…     -> JS packé (pix + pvalue)
 *   - GET <cdn>/…/<page>.jpg?token=…&ttl=…                -> image (Referer requis)
 *
 * Aucune référence au runtime Paperback (`App`) ici : ce fichier reste
 * importable et compilable hors application (tests unitaires).
 */
Object.defineProperty(exports, "__esModule", { value: true });
