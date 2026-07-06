#!/usr/bin/env node
// optimize.mjs — passe d'optimisation gltf-transform sur des .glb (perf de rendu + poids).
//
// Attaque le "Cas B" (rame en orbite) : fusionne les sous-meshes par materiau -> beaucoup
// moins de draw calls. Et le "Cas A" (poids) : compression meshopt. Sans perte visuelle
// (pas de decimation ici). Ecrit <name>.opt.glb a cote et affiche avant/apres.
//
// Usage : node scripts/optimize.mjs <fichier.glb> [autre.glb ...]
//         (sans argument : traite tous les models/*.exterior.glb)

import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, prune, flatten, weld, join, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join as pjoin } from "node:path";

const ROOT = pjoin(dirname(fileURLToPath(import.meta.url)), "..");

// --compress-only : uniquement compression meshopt (preserve noms de mesh + structure + placement).
//   Pour les INTERIEURS : le harnais app filtre par nom de mesh (int_rear/...) et verifie le
//   placement -> on NE DOIT PAS join/flatten (detruit les noms) ni bouger la geometrie.
const COMPRESS_ONLY = process.argv.includes("--compress-only");
let inputs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (inputs.length === 0) {
  const dir = pjoin(ROOT, "models");
  inputs = readdirSync(dir).filter((f) => f.endsWith(".exterior.glb")).map((f) => pjoin(dir, f));
}

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression])
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

for (const path of inputs) {
  const doc = await io.read(path);
  const before = stats(doc);
  const sizeBefore = statSync(path).size;

  await doc.transform(
    ...(COMPRESS_ONLY
      ? [ weld({ tolerance: 0.0001 }),                          // nettoie les bounds sans renommer/deplacer/supprimer de noeud (pas de prune: garde les hardpoints locators dont le harnais a besoin)
          meshopt({ encoder: MeshoptEncoder, level: "high" }) ] // interieurs : compression, noms/placement/hardpoints intacts
      : [
          dedup(),                      // fusionne accessors/materiaux/meshes dupliques
          weld({ tolerance: 0.0001 }),  // soude les sommets colocalises
          flatten(),                    // aplatit la hierarchie de noeuds
          join(),                       // FUSIONNE les primitives par materiau -> moins de draw calls
          prune(),                      // retire ce qui n'est plus reference
          meshopt({ encoder: MeshoptEncoder, level: "high" }), // compression (poids)
        ])
  );

  const after = stats(doc);
  const out = path.replace(/\.glb$/i, ".opt.glb");
  await io.write(out, doc);
  const sizeAfter = statSync(out).size;

  const name = path.split(/[\\/]/).pop();
  console.log(`\n${name}`);
  console.log(`  draw calls (primitives) : ${before.prims}  ->  ${after.prims}   (${pct(before.prims, after.prims)})`);
  console.log(`  meshes                  : ${before.meshes}  ->  ${after.meshes}`);
  console.log(`  triangles               : ${before.tris.toLocaleString()}  ->  ${after.tris.toLocaleString()}`);
  console.log(`  taille                  : ${mb(sizeBefore)}  ->  ${mb(sizeAfter)}   (${pct(sizeBefore, sizeAfter)})`);
  console.log(`  ecrit : ${out.split(/[\\/]/).pop()}`);
}

function stats(doc) {
  const meshes = doc.getRoot().listMeshes();
  let prims = 0, tris = 0;
  for (const m of meshes) for (const p of m.listPrimitives()) {
    prims++;
    const idx = p.getIndices(), pos = p.getAttribute("POSITION");
    const count = idx ? idx.getCount() : (pos ? pos.getCount() : 0);
    tris += Math.floor(count / 3);
  }
  return { meshes: meshes.length, prims, tris };
}
function mb(b) { return (b / 1048576).toFixed(2) + " Mo"; }
function pct(a, b) { return (a === 0 ? "0" : Math.round((1 - b / a) * 100)) + "% en moins"; }
