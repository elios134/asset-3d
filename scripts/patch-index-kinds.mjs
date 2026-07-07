#!/usr/bin/env node
// patch-index-kinds.mjs — injecte interiorKind/interiorWalkableM2 dans l'index.json EXISTANT,
// sans recalculer les sha256 (les GLB locaux peuvent etre en cours de rebuild HD : l'index live
// doit continuer a pointer les assets de la Release avec leurs sha d'origine).
//
// Maj metadonnees seule : pour chaque clef mesuree dans interior-kinds.json, pose les 2 champs
// sur la variante interior. L'app gate isVisitable sur interiorKind !== "cockpit".
// Usage : node scripts/patch-index-kinds.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const idx = JSON.parse(readFileSync(join(ROOT, "index.json"), "utf8"));
const kinds = JSON.parse(readFileSync(join(ROOT, "interior-kinds.json"), "utf8")).kinds;

let hab = 0, cock = 0, untouched = 0;
for (const ship of idx.ships) {
  const v = ship.variants.find((x) => x.level === "interior");
  if (!v) continue;
  const k = kinds[ship.key];
  if (!k) { untouched++; continue; } // non mesure (crew<2, jamais visitable via le gate crew)
  v.interiorKind = k.kind;
  v.interiorWalkableM2 = k.walkableM2;
  k.kind === "habitable" ? hab++ : cock++;
}
idx.generatedAt = new Date().toISOString();
writeFileSync(join(ROOT, "index.json"), JSON.stringify(idx, null, 2) + "\n");
console.log(`index.json patche : ${hab} habitable, ${cock} cockpit, ${untouched} interieurs non mesures (crew<2, inchanges).`);
