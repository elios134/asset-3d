#!/usr/bin/env node
// cull-stray-interior.mjs — retire d'un interieur les meshes PARASITES loin hors de la coque.
//
// Certains interieurs contiennent 1-2 meshes egares (transform casse) tres loin du vaisseau, qui
// gonflent la bbox et font "sortir" l'interieur de la vue. Souvent sans nom -> on cible par POSITION :
// un mesh dont la bbox depasse la coque (exterior) de plus de THRESHOLD m est un parasite -> retire.
//
// Bounds via gltf-transform (decode meshopt). Re-compresse meshopt. Ecrit en place.
// Usage : node scripts/cull-stray-interior.mjs [--threshold=20] KEY1 KEY2 ...

import { NodeIO, getBounds } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { prune, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = join(ROOT, "models");
const thArg = process.argv.find((a) => a.startsWith("--threshold="));
const THRESHOLD = thArg ? parseFloat(thArg.split("=")[1]) : 20; // m de depassement au-dela = parasite
const keys = process.argv.slice(2).filter((a) => !a.startsWith("--"));

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression])
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

for (const key of keys) {
  const extPath = join(MODELS, `${key}.exterior.glb`);
  const intPath = join(MODELS, `${key}.interior.glb`);
  if (!existsSync(intPath)) { console.log(`  ⚠ ${key} : pas d'interieur`); continue; }
  const hull = getBounds((await io.read(extPath)).getRoot().listScenes()[0]);
  const doc = await io.read(intPath);
  const removed = [];
  for (const node of doc.getRoot().listNodes()) {
    if (!node.getMesh()) continue;
    const b = getBounds(node);
    if (!b || !isFinite(b.min[0])) continue;
    const over = Math.max(
      hull.min[0] - b.max[0], b.min[0] - hull.max[0],
      hull.min[1] - b.max[1], b.min[1] - hull.max[1],
      hull.min[2] - b.max[2], b.min[2] - hull.max[2],
    ); // >0 = mesh entierement hors coque de tant sur une face
    if (over <= THRESHOLD) continue;
    // CRITERE SUR : un parasite doit etre ANONYME ET DEGENERE (aire ~nulle). Jamais un mesh nomme
    // (tuyere/nacelle...) ni volumineux, meme s'il depasse.
    const name = node.getName() || "";
    const anon = !name || /^[?]|^mesh[_.]?\d*$|^\d+$/i.test(name);
    const minDim = Math.min(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    if (!(anon && minDim < 0.5)) continue; // garde nomme OU volumineux
    removed.push({ name: name || "?", over: over.toFixed(0) });
    node.dispose();
  }
  const before = statSync(intPath).size;
  await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: "high" }));
  await io.write(intPath, doc);
  console.log(`  ✓ ${key.padEnd(28)} ${removed.length} parasite(s) retire(s) ${removed.map((r) => `@${r.over}m`).join(",")}  ${(before / 1048576).toFixed(1)}->${(statSync(intPath).size / 1048576).toFixed(1)} Mo`);
}
