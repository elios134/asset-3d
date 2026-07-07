#!/usr/bin/env node
// move-nonvisitable-interiors.mjs — ne GARDE dans models/ que les interieurs HABITABLES.
//
// Decision user : seuls les 62 interieurs "habitable" (interior-kinds.json, walkableM2 >= seuil) ont
// une variante interior dans l'index. Les cockpits/buggies (45) et non-visitables restent flat mais
// sont ecartes vers models/_parked/ pour ne pas apparaitre dans l'index (build-index liste models/,
// non recursif). Reversible : --restore.
//
// Usage : node scripts/move-nonvisitable-interiors.mjs [--restore]

import { readFileSync, readdirSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = join(ROOT, "models");
const PARK = join(MODELS, "_parked");
const RESTORE = process.argv.includes("--restore");

if (RESTORE) {
  if (!existsSync(PARK)) { console.log("Rien a restaurer."); process.exit(0); }
  let n = 0;
  for (const f of readdirSync(PARK).filter((f) => f.endsWith(".interior.glb"))) { renameSync(join(PARK, f), join(MODELS, f)); n++; }
  console.log(`Restaure : ${n} interieurs remis dans models/.`);
  process.exit(0);
}

const kinds = JSON.parse(readFileSync(join(ROOT, "interior-kinds.json"), "utf8")).kinds;
const keep = new Set(Object.entries(kinds).filter(([, v]) => v.kind === "habitable").map(([k]) => k));

if (!existsSync(PARK)) mkdirSync(PARK);
let moved = 0, kept = 0;
for (const f of readdirSync(MODELS).filter((f) => f.endsWith(".interior.glb"))) {
  const key = f.replace(".interior.glb", "");
  if (keep.has(key)) { kept++; continue; }
  renameSync(join(MODELS, f), join(PARK, f)); moved++;
}
console.log(`Ecartes : ${moved} interieurs non-habitables -> models/_parked/`);
console.log(`Gardes  : ${kept} interieurs habitables dans models/ (attendu 62).`);
