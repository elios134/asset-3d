#!/usr/bin/env node
// list-ships.mjs — énumère les vaisseaux/véhicules du JEU (source de vérité) via la
// DataCore StarBreaker, indépendamment de SCFM. Écrit game-ships.json (liste de clés
// classNameCig). Avec --diff, compare au catalogue actuel (ships.meta.json).
//
// Usage : node scripts/list-ships.mjs [--json] [--diff]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./lib/config.mjs";
import { parseProjection, selectShips, diffCatalogue, bboxToDims } from "./lib/ship-enum.mjs";

const ROOT = process.cwd();
const JSON_MODE = process.argv.includes("--json");
const DIFF = process.argv.includes("--diff");

const { paths } = loadConfig({ root: ROOT });
const env = { ...process.env, SC_DATA_P4K: paths.p4k };

// Une projection dcb query → texte TSV « RecordName\tvaleur ».
function query(propertyPath) {
  return execFileSync(paths.starbreaker, ["dcb", "query", propertyPath], {
    env, cwd: ROOT, maxBuffer: 512 * 1024 * 1024, encoding: "utf8",
  });
}

if (!JSON_MODE) console.error("Interrogation de la DataCore du jeu…");
// 1) clés ayant un composant véhicule ; 2) chemin de géométrie de coque par clé ;
// 3) maxBoundingBoxSize (Vec3) par clé → dims approximatives (affinées à l'extraction).
const vehicleKeys = [...parseProjection(query("EntityClassDefinition.Components[VehicleComponentParams]")).keys()];
const geomByKey = parseProjection(query("EntityClassDefinition.Components[SGeometryResourceParams].Geometry.Geometry.Geometry.path"));
const bboxByKey = parseProjection(query("EntityClassDefinition.Components[VehicleComponentParams].maxBoundingBoxSize"));

const ships = selectShips({ vehicleKeys, geomByKey });
const dims = {};
for (const key of ships) {
  const raw = bboxByKey.get(key);
  if (!raw) continue;
  try { const d = bboxToDims(JSON.parse(raw)); if (d) dims[key] = d; } catch { /* bbox illisible → dims 0 */ }
}
writeFileSync(join(ROOT, "game-ships.json"), JSON.stringify(
  { _comment: "Vaisseaux/véhicules énumérés depuis le JEU (DataCore). Source de vérité de ce qui est extractible. Généré par scripts/list-ships.mjs. dims = maxBoundingBoxSize du jeu (approx).", patchVersion: null, keys: ships, dims },
  null, 2,
) + "\n");

if (DIFF) {
  const meta = existsSync(join(ROOT, "ships.meta.json"))
    ? JSON.parse(readFileSync(join(ROOT, "ships.meta.json"), "utf8")) : {};
  const cat = new Set(Object.keys(meta).filter((k) => k !== "_comment"));
  const d = diffCatalogue(ships, cat);
  if (JSON_MODE) {
    process.stdout.write(JSON.stringify({ count: ships.length, ...d }));
  } else {
    console.error(`\nVaisseaux détectés en jeu : ${ships.length} (catalogue actuel : ${cat.size})`);
    console.error(`\nEN JEU, absents du catalogue (${d.newInGame.length}) :\n  ${d.newInGame.join(", ") || "(aucun)"}`);
    console.error(`\nCatalogue, absents du jeu (${d.missingFromGame.length}) :\n  ${d.missingFromGame.join(", ") || "(aucun)"}`);
  }
} else if (!JSON_MODE) {
  console.error(`game-ships.json écrit : ${ships.length} vaisseaux.`);
} else {
  process.stdout.write(JSON.stringify({ count: ships.length, keys: ships }));
}
