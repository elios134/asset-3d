#!/usr/bin/env node
// classify-interiors.mjs — calcule interiorKind (habitable|cockpit) pour chaque interieur visitable,
// via la surface de plancher praticable (scan-walkable). Ecrit interior-kinds.json consomme par build-index.
// Seuil : SEUIL_M2 (defaut 100, milieu de la vallee 82-113 mesuree sur la flotte).
// Usage : node scripts/classify-interiors.mjs [--seuil=100] [KEY...]  (defaut : les 107 de visitable-interiors.json)

import { walkableArea } from "./scan-walkable.mjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = join(ROOT, "models");
const sArg = process.argv.find((a) => a.startsWith("--seuil="));
const SEUIL = sArg ? parseInt(sArg.split("=")[1]) : 100;
const argKeys = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const keys = argKeys.length ? argKeys : JSON.parse(readFileSync(join(ROOT, "visitable-interiors.json"), "utf8")).keys;

const out = {};
for (const key of keys) {
  if (!existsSync(join(MODELS, `${key}.interior.glb`))) continue;
  try {
    const { area } = await walkableArea(key);
    out[key] = { walkableM2: area, kind: area >= SEUIL ? "habitable" : "cockpit" };
  } catch (e) { out[key] = { walkableM2: -1, kind: "cockpit", err: e.message.split("\n")[0] }; }
}
const kinds = Object.values(out);
const hab = kinds.filter((v) => v.kind === "habitable").length;
writeFileSync(join(ROOT, "interior-kinds.json"), JSON.stringify({ _comment: `Genere par classify-interiors.mjs. Seuil ${SEUIL} m2 de plancher praticable. kind=habitable si walkableM2>=seuil.`, seuil: SEUIL, kinds: out }, null, 2) + "\n");
console.log(`interior-kinds.json ecrit : ${kinds.length} interieurs — ${hab} habitable, ${kinds.length - hab} cockpit (seuil ${SEUIL} m2).`);
