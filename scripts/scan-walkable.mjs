#!/usr/bin/env node
// scan-walkable.mjs — CALIBRATION : estime la surface de plancher "praticable" (debout) d'un interieur.
// Grille (x,z) de CELL m. Pour chaque colonne, on trie les hauteurs de surface (sommets binnes) et on
// cherche le plus grand VIDE vertical entre deux surfaces consecutives. Si ce vide >= CLEAR m (hauteur
// debout), la cellule est "praticable". Surface praticable = nb cellules praticables x CELL^2.
// Un cockpit (bulle < 1.8m) -> ~0 m2 ; un habitacle (cabine/cargo >= 2m) -> surface nette.
// Usage : node scripts/scan-walkable.mjs KEY1 KEY2 ...   (lit models/<key>.interior.glb)

import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = join(ROOT, "models");
const CELL = 0.5, CLEAR = 1.8, YBIN = 0.2;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const keys = process.argv.slice(2).filter((a) => !a.startsWith("--"));

const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };

export async function walkableArea(key) {
  const doc = await io.read(join(MODELS, `${key}.interior.glb`));
  const nodes = doc.getRoot().listNodes();
  const pm = new Map(); for (const n of nodes) for (const c of n.listChildren()) pm.set(c, n);
  const wm = (n) => { let m = n.getMatrix(), p = pm.get(n), seen = new Set([n]), d = 0; while (p && !seen.has(p) && d < 200) { m = mul(p.getMatrix(), m); seen.add(p); p = pm.get(p); d++; } return m; };
  // cellule (x,z) -> Set de bins de hauteur
  const cells = new Map();
  const P = [0, 0, 0];
  for (const node of nodes) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const M = wm(node);
    for (const prim of mesh.listPrimitives()) {
      const a = prim.getAttribute("POSITION"); if (!a) continue;
      const n = a.getCount();
      for (let i = 0; i < n; i++) {
        a.getElement(i, P);
        const x = M[0] * P[0] + M[4] * P[1] + M[8] * P[2] + M[12];
        const y = M[1] * P[0] + M[5] * P[1] + M[9] * P[2] + M[13];
        const z = M[2] * P[0] + M[6] * P[1] + M[10] * P[2] + M[14];
        const ck = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
        let s = cells.get(ck); if (!s) cells.set(ck, (s = new Set()));
        s.add(Math.round(y / YBIN));
      }
    }
  }
  // par cellule : plus grand vide vertical entre surfaces consecutives
  let walk = 0;
  for (const s of cells.values()) {
    if (s.size < 2) continue;
    const ys = [...s].sort((a, b) => a - b);
    let maxGap = 0;
    for (let i = 1; i < ys.length; i++) maxGap = Math.max(maxGap, (ys[i] - ys[i - 1]) * YBIN);
    if (maxGap >= CLEAR) walk++;
  }
  return { key, area: +(walk * CELL * CELL).toFixed(0), cells: cells.size };
}

if (keys.length) {
  for (const key of keys) {
    if (!existsSync(join(MODELS, `${key}.interior.glb`))) { console.log(`  ${key.padEnd(30)} (pas d'interieur)`); continue; }
    try { const r = await walkableArea(key); console.log(`  ${key.padEnd(30)} walkable=${String(r.area).padStart(6)} m2   (footprint cells ${r.cells})`); }
    catch (e) { console.log(`  ${key.padEnd(30)} ERR ${e.message.split("\n")[0]}`); }
  }
}
