#!/usr/bin/env node
// cull-stray-interior.mjs — retire d'un interieur les meshes PARASITES loin hors de la coque.
//
// Parasite = nom GENERIQUE (Box/Cube/Object/...) ou ANONYME, ET bbox monde entierement hors de la
// coque (variante exterior) de plus de THRESHOLD m. Un nom SPECIFIQUE (mur/piece) ou tout ce qui est
// DANS la coque = GARDE (jamais culle par distance seule — lecon 350r).
//
// Calcule les bbox de noeud MANUELLEMENT (matrice monde cycle-safe) pour contourner le bug
// getWorldMatrix de gltf-transform sur certains fichiers. Re-compresse meshopt. Ecrit en place.
// Usage : node scripts/cull-stray-interior.mjs [--threshold=10] KEY1 KEY2 ...

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
const THRESHOLD = thArg ? parseFloat(thArg.split("=")[1]) : 10;
const GENERIC = /^(box|cube|plane|cylinder|sphere|cone|circle|icosphere|object|empty)[._]?\d+$/i;
const keys = process.argv.slice(2).filter((a) => !a.startsWith("--"));

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression])
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const ap = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];

for (const key of keys) {
  const intPath = join(MODELS, `${key}.interior.glb`);
  if (!existsSync(intPath)) { console.log(`  ⚠ ${key} : pas d'interieur`); continue; }
  const hull = getBounds((await io.read(join(MODELS, `${key}.exterior.glb`))).getRoot().listScenes()[0]);
  const doc = await io.read(intPath);
  const nodes = doc.getRoot().listNodes();
  const pm = new Map(); for (const n of nodes) for (const c of n.listChildren()) pm.set(c, n);
  const wm = (n) => { let m = n.getMatrix(), p = pm.get(n), seen = new Set([n]), d = 0; while (p && !seen.has(p) && d < 200) { m = mul(p.getMatrix(), m); seen.add(p); p = pm.get(p); d++; } return m; };

  const removed = [];
  for (const node of nodes) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const M = wm(node);
    let xn = Infinity, yn = Infinity, zn = Infinity, xx = -Infinity, yx = -Infinity, zx = -Infinity;
    for (const p of mesh.listPrimitives()) {
      const a = p.getAttribute("POSITION"); if (!a) continue;
      const mn = a.getMinNormalized([]), mx = a.getMaxNormalized([]); if (!mn) continue;
      for (const c of [[mn[0], mn[1], mn[2]], [mx[0], mx[1], mx[2]], [mn[0], mx[1], mn[2]], [mx[0], mn[1], mx[2]], [mn[0], mn[1], mx[2]], [mx[0], mx[1], mn[2]]]) {
        const w = ap(M, ...c); xn = Math.min(xn, w[0]); yn = Math.min(yn, w[1]); zn = Math.min(zn, w[2]); xx = Math.max(xx, w[0]); yx = Math.max(yx, w[1]); zx = Math.max(zx, w[2]);
      }
    }
    if (!isFinite(xn)) continue;
    const over = Math.max(hull.min[0] - xx, xn - hull.max[0], hull.min[1] - yx, yn - hull.max[1], hull.min[2] - zx, zn - hull.max[2]);
    if (over <= THRESHOLD) continue;
    const name = node.getName() || "";
    if (!(!name || /^[?]/.test(name) || GENERIC.test(name))) continue; // garde les noms specifiques
    removed.push(name || "?"); node.dispose();
  }
  const before = statSync(intPath).size;
  await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: "high" }));
  await io.write(intPath, doc);
  console.log(`  ✓ ${key.padEnd(24)} ${removed.length} parasite(s) retire(s)  ${(before / 1048576).toFixed(1)}->${(statSync(intPath).size / 1048576).toFixed(1)} Mo`);
}
