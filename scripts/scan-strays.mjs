#!/usr/bin/env node
// scan-strays.mjs — RE-SCAN DE CONTROLE (lecture seule) des meshes loin de la coque dans les interieurs.
//
// Classe chaque mesh qui depasse la coque (exterior) de plus de FAR m en :
//   - PARASITE  : anonyme ET degenere (plus petite dim < 0.5m) -> candidat au cull
//   - A GARDER  : nomme OU volumineux (min dim >= 0.5m) -> pièce legitime (tuyere/nacelle...), NE PAS toucher
// Ne modifie RIEN. Sert a valider le critere avant d'appliquer le culler.
//
// Usage : node scripts/scan-strays.mjs [--far=10] [max]

import { NodeIO, getBounds } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = join(ROOT, "models");
const farArg = process.argv.find((a) => a.startsWith("--far="));
const FAR = farArg ? parseFloat(farArg.split("=")[1]) : 10;
const DEGEN = 0.5; // plus petite dimension bbox en dessous = degenere (plat/sliver/point)
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ "meshopt.decoder": MeshoptDecoder });

const meta = JSON.parse(readFileSync(join(ROOT, "ships.meta.json"), "utf8"));
const maxArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const keys = Object.keys(meta).filter((k) => k !== "_comment" && existsSync(join(MODELS, `${k}.interior.glb`)) && existsSync(join(MODELS, `${k}.exterior.glb`)));
const batch = maxArg ? keys.slice(0, parseInt(maxArg)) : keys;

const parasites = [], keep = [];
for (const key of batch) {
  try {
    const hull = getBounds((await io.read(join(MODELS, `${key}.exterior.glb`))).getRoot().listScenes()[0]);
    const doc = await io.read(join(MODELS, `${key}.interior.glb`));
    for (const n of doc.getRoot().listNodes()) {
      if (!n.getMesh()) continue;
      const b = getBounds(n);
      if (!b || !isFinite(b.min[0])) continue;
      const over = Math.max(hull.min[0] - b.max[0], b.min[0] - hull.max[0], hull.min[1] - b.max[1], b.min[1] - hull.max[1], hull.min[2] - b.max[2], b.min[2] - hull.max[2]);
      if (over <= FAR) continue;
      const dims = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
      const minDim = Math.min(...dims);
      const name = n.getName() || "";
      // parasite = anonyme OU nom GENERIQUE (primitive Blender / Object export), ET loin hors coque (deja filtre)
      const GENERIC = /^(box|cube|plane|cylinder|sphere|cone|circle|icosphere|object|empty)[._]?\d+$/i;
      const generic = !name || /^[?]/.test(name) || GENERIC.test(name);
      const rec = { key, name: name || "(anonyme)", over: +over.toFixed(0), minDim: +minDim.toFixed(2), dims: dims.map((d) => d.toFixed(0)).join("x") };
      // named-specific (mur/pièce nommé) hors coque -> A GARDER (verif manuelle) ; generique hors coque -> parasite
      if (generic) parasites.push(rec); else keep.push(rec);
    }
  } catch (e) { console.log(`  ⚠ ${key} : ${e.message.split("\n")[0]}`); }
}

console.log(`\n=== PARASITES (anonyme + degenere + >${FAR}m) — candidats au cull : ${parasites.length} ===`);
for (const p of parasites) console.log(`  ${p.key.padEnd(26)} +${p.over}m  minDim=${p.minDim}m  ${p.dims}m  "${p.name}"`);
console.log(`\n=== A GARDER (nomme OU volumineux, meme s'ils depassent >${FAR}m) : ${keep.length} ===`);
for (const k of keep.slice(0, 40)) console.log(`  ${k.key.padEnd(26)} +${k.over}m  minDim=${k.minDim}m  ${k.dims}m  "${k.name}"`);
if (keep.length > 40) console.log(`  … +${keep.length - 40} autres`);
