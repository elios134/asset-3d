#!/usr/bin/env node
// gen-meta.mjs — genere ships.meta.json depuis la base ShipData de l'app (SQLite).
//
// Lit la table ShipData (name, classNameCig, manufacturer, classification, length/beam/height),
// deduplique par nom d'affichage en gardant la variante de base (classNameCig le plus court,
// ex. DRAK_Cutlass_Black plutot que DRAK_Cutlass_Black_BIS2950), et ecrit ships.meta.json
// clef = classNameCig (= nom de fichier .glb).
//
// La meta couvre TOUTE la flotte ; build-index ne catalogue que les vaisseaux ayant un .glb.
//
// CONVENTION DIMS : le catalogue publie tient une regle "dims ~ bbox du maillage"
// (les vaisseaux valides collent a leur geometrie a +-10%). gen-meta l'automatise :
// quand ShipData diverge de la geometrie mesuree (ou vaut 0), on RECALE les dims sur
// la bbox propre du clay-exterior — mais seulement si la geometrie est FIABLE
// (clay-exterior ~ clay-interior, et l'ecart avec ShipData reste sous SUSPECT_FACTOR).
// Sinon le vaisseau est TENU (held) : dims ShipData inchangees + signale, pour arbitrage
// manuel (meta=0, ext/int divergents, ou axe geometrique qui explose = train/gear).
// DIM_OVERRIDES reste la couche prioritaire pour les valeurs vetees a la main.
//
// Usage : node scripts/gen-meta.mjs [chemin_vers_scfleet.db] [--models=<dir>]

import { DatabaseSync } from "node:sqlite";
import { writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { measureCleanDims } from "./lib/glb-bbox.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DB = "C:/Users/andre/AppData/Roaming/com.andre.sc-fleet-manager-v2/scfleet.db";

// Overrides de dims (metres) VETES A LA MAIN : couche prioritaire, appliquee avant
// toute logique geometrique. Cle = classNameCig. Valeurs = bbox propre EXTERIEUR
// mesuree (convention "dims = geometrie clay affichee", gear/ailes/formes retractees
// incluses), retenues quand ShipData est faux/nul ET que le recalage auto ne peut pas
// trancher seul (interieur bruite, meta=0...). Verifiees a la main (session pipeline).
const DIM_OVERRIDES = {
  AEGS_Avenger_Stalker: { l: 24.6, b: 16.8, h: 7.2 },
  AEGS_Avenger_Titan: { l: 24.6, b: 16.8, h: 7.2 },
  AEGS_Avenger_Titan_Renegade: { l: 24.6, b: 16.8, h: 7.2 },
  AEGS_Avenger_Warlock: { l: 24.6, b: 16.8, h: 7.2 },
  // ShipData faux/nul, geometrie exterieure verifiee (train/ailes/coque affichee) :
  ARGO_MOTH: { l: 45, b: 25.7, h: 14.5 },        // ShipData = 0
  BANU_Defender: { l: 24.8, b: 22.8, h: 9.1 },   // h ShipData=5 ignore le train sorti
  MISC_Freelancer_MAX: { l: 36.7, b: 31.9, h: 13.2 }, // h inclut le gear sorti
  MISC_Hull_B: { l: 46.7, b: 16.7, h: 8.2 },     // forme retractee (ShipData 71 = deployee)
  MRAI_Guardian_MX: { l: 24.4, b: 20, h: 11.5 }, // b = envergure ailes
  DRAK_Clipper: { l: 49.5, b: 25.3, h: 13.8 },   // ext reoriente (length sur Z) ; ShipData 26.5 faux
  ORIG_m80: { l: 31.9, b: 17.6, h: 5.3 },         // vrai cargo ~32 m ; ShipData 11.5 perime (bbox clay verifiee)
};

// --- Regle de resolution des dims (pure, testee) ---
const TOL_ABS = 3.0, TOL_REL = 0.15; // aligne sur qa.mjs (controle DIMS)

const axes = ["l", "b", "h"];
const valid = (d) => !!d && axes.every((a) => d[a] > 0);
const withinTol = (a, b) => { const d = Math.abs(a - b); return d <= TOL_ABS || d <= TOL_REL * Math.max(a, b); };
const allWithinTol = (x, y) => axes.every((a) => withinTol(x[a], y[a]));
const close = (a, b, rel) => a > 0 && b > 0 && Math.abs(a - b) / Math.max(a, b) <= rel;
// ext/int se confirment : longueur/largeur a 15%, hauteur a 35% (l'interieur perd
// de la hauteur sous coque incurvee / trains) — meme regle que l'audit triage.
const extIntAgree = (ext, int) => close(ext.l, int.l, 0.15) && close(ext.b, int.b, 0.15) && close(ext.h, int.h, 0.35);

// Choisit les dims d'un vaisseau. Retourne { dims, source, held, note }.
// source: "override" | "shipdata" | "geometry". held=true => a arbitrer a la main.
//
// Critere de confiance = COHERENCE GEOMETRIQUE (clay-exterior ~ clay-interior),
// PAS l'ecart avec ShipData : quand la geometrie se confirme elle-meme, on la
// croit meme si ShipData est tres faux (ex. Aurora_Mk2 : ShipData b=27.4 alors
// que le mesh fait ~11) ou nul (ex. MOTH meta=0). On ne TIENT (arbitrage manuel)
// que si la geometrie ne se confirme pas : ext/int divergents, ou pas d'interieur.
export function resolveDims({ shipData, ext, int, override }) {
  if (override) return { dims: override, source: "override", held: false, note: "" };
  const sd = valid(shipData) ? shipData : null;
  // Pas de clay-exterior mesurable : on ne peut pas appliquer la convention.
  // ShipData valide => on lui fait confiance (flotte non cataloguee / HD only, non QA-testee).
  if (!ext) {
    if (sd) return { dims: sd, source: "shipdata", held: false, note: "" };
    return { dims: { l: 0, b: 0, h: 0 }, source: "shipdata", held: !!int, note: "meta ShipData = 0, pas de clay-exterior mesurable" };
  }
  // clay-exterior mesure et ShipData deja conforme a la geometrie -> on n'y touche pas (le gros du catalogue).
  if (sd && allWithinTol(sd, ext)) return { dims: sd, source: "shipdata", held: false, note: "" };
  // Divergent ou vide : on recale sur la geometrie SI elle se confirme (ext~int).
  if (int && extIntAgree(ext, int)) return { dims: ext, source: "geometry", held: false, note: "" };
  // Sinon on TIENT : dims ShipData inchangees (ou 0), signale pour arbitrage.
  const note = !int ? "pas de clay-interior" : "ext/int divergents";
  return { dims: sd ?? { l: 0, b: 0, h: 0 }, source: "shipdata", held: true, note };
}

function main() {
  const args = process.argv.slice(2);
  const dbPath = args.find((a) => !a.startsWith("--")) || DEFAULT_DB;
  const modelsArg = args.find((a) => a.startsWith("--models="));
  const modelsDir = modelsArg ? modelsArg.slice("--models=".length) : join(ROOT, "models");

  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db.prepare(`
    SELECT name, classNameCig, manufacturer, classification, length, beam, height
    FROM ShipData
    WHERE classNameCig IS NOT NULL AND classNameCig <> ''
      AND length IS NOT NULL AND beam IS NOT NULL AND height IS NOT NULL
  `).all();
  db.close();

  // dedup par nom : garde le classNameCig le plus court (la variante de base)
  const byName = new Map();
  for (const r of rows) {
    const cur = byName.get(r.name);
    if (!cur || r.classNameCig.length < cur.classNameCig.length) byName.set(r.name, r);
  }

  const meta = {
    _comment: "Genere par scripts/gen-meta.mjs depuis ShipData (app SQLite). clef = classNameCig = nom du fichier models/<key>.glb. Ne pas editer a la main : relancer gen-meta. Les dims divergentes sont recalees sur la geometrie clay (convention dims~bbox) ; voir DIM_OVERRIDES pour les valeurs vetees a la main.",
  };
  const measure = (key, level, seed) => {
    const p = join(modelsDir, `${key}.${level}.glb`);
    if (!existsSync(p)) return null;
    try { return measureCleanDims(p, seed); } catch { return null; }
  };

  const recaled = [], held = [];
  for (const r of [...byName.values()].sort((a, b) => a.classNameCig.localeCompare(b.classNameCig))) {
    const key = r.classNameCig;
    const seed = { l: r.length, b: r.beam, h: r.height };
    const ext = measure(key, "clay-exterior", seed);
    const int = measure(key, "clay-interior", seed);
    const res = resolveDims({
      shipData: { l: r.length, b: r.beam, h: r.height },
      ext, int, override: DIM_OVERRIDES[key],
    });
    meta[key] = {
      name: r.name,
      manufacturer: r.manufacturer,
      classification: r.classification || null,
      dims: res.dims,
      materials: "flat",
    };
    if (res.source === "geometry") recaled.push({ key, from: `${r.length}/${r.beam}/${r.height}`, to: `${res.dims.l}/${res.dims.b}/${res.dims.h}` });
    if (res.held) held.push({ key, dims: `${res.dims.l}/${res.dims.b}/${res.dims.h}`, note: res.note });
  }

  writeFileSync(join(ROOT, "ships.meta.json"), JSON.stringify(meta, null, 2) + "\n");
  const count = Object.keys(meta).length - 1;
  console.log(`ships.meta.json ecrit : ${count} vaisseaux (dedup depuis ${rows.length} lignes ShipData).`);
  console.log(`Recales sur geometrie : ${recaled.length}`);
  for (const x of recaled) console.log(`  ~ ${x.key.padEnd(32)} ${x.from} -> ${x.to}`);
  console.log(`A ARBITRER A LA MAIN (tenus) : ${held.length}`);
  for (const x of held) console.log(`  ! ${x.key.padEnd(32)} ${x.dims.padEnd(16)} ${x.note}`);
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
