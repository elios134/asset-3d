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
// Usage : node scripts/gen-meta.mjs [chemin_vers_scfleet.db]

import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DB = "C:/Users/andre/AppData/Roaming/com.andre.sc-fleet-manager-v2/scfleet.db";
const dbPath = process.argv[2] || DEFAULT_DB;

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
  _comment: "Genere par scripts/gen-meta.mjs depuis ShipData (app SQLite). clef = classNameCig = nom du fichier models/<key>.glb. Ne pas editer a la main : relancer gen-meta.",
};
for (const r of [...byName.values()].sort((a, b) => a.classNameCig.localeCompare(b.classNameCig))) {
  meta[r.classNameCig] = {
    name: r.name,
    manufacturer: r.manufacturer,
    classification: r.classification || null,
    dims: { l: r.length, b: r.beam, h: r.height },
    materials: "flat",
  };
}

writeFileSync(join(ROOT, "ships.meta.json"), JSON.stringify(meta, null, 2) + "\n");
const count = Object.keys(meta).length - 1;
console.log(`ships.meta.json ecrit : ${count} vaisseaux (dedup depuis ${rows.length} lignes ShipData).`);
console.log(`Exemples : ${Object.keys(meta).filter(k => k !== "_comment").slice(0, 5).join(", ")}`);
