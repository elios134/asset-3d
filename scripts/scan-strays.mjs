#!/usr/bin/env node
// scan-strays.mjs — QA (lecture seule) : detecte les meshes "hors coque" d'un interieur construit.
//
// Mesure les VRAIS sommets (decodes meshopt) de chaque noeud-mesh de models/<KEY>.interior.glb
// contre l'enveloppe reelle de models/<KEY>.exterior.glb. Tout mesh qui deborde de plus de
// SEUIL metres est un artefact (bug reorder+quantize gltf-transform sur accessors partages,
// module mal place, debris). Ne PAS se fier a accessor.min/max ni a getBounds sur les noeuds
// individuels d'un fichier quantize (grille de quantization mensongere).
// Usage : node scripts/scan-strays.mjs KEY [KEY...] | --all   (exit 1 si au moins un debordant)

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds } from "@gltf-transform/functions";
import { MeshoptDecoder } from "meshoptimizer";
import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = join(ROOT, "models");
const SEUIL = 2;

let keys = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (process.argv.includes("--all") || !keys.length)
  keys = readdirSync(MODELS).filter((f) => f.endsWith(".interior.glb")).map((f) => f.replace(/\.interior\.glb$/, ""));

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const ap = (m, x, y, z) => [m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]];

let totalBad = 0;
for (const key of keys) {
  const extF = join(MODELS, `${key}.exterior.glb`), intF = join(MODELS, `${key}.interior.glb`);
  if (!existsSync(extF) || !existsSync(intF)) { console.log(`- ${key} : fichier manquant, ignore`); continue; }
  const hull = getBounds((await io.read(extF)).getRoot().listScenes()[0]);
  const doc = await io.read(intF);
  const nodes = doc.getRoot().listNodes();
  const pm = new Map(); for (const n of nodes) for (const c of n.listChildren()) pm.set(c, n);
  const wm = (n) => { let mm = n.getMatrix(), p = pm.get(n), seen = new Set([n]), d = 0; while (p && !seen.has(p) && d < 200) { mm = mul(p.getMatrix(), mm); seen.add(p); p = pm.get(p); d++; } return mm; };
  const PT = [0, 0, 0]; const bad = []; let mc = 0;
  for (const node of nodes) { const mesh = node.getMesh(); if (!mesh) continue; mc++;
    let xn=1/0,yn=1/0,zn=1/0,xx=-1/0,yx=-1/0,zx=-1/0; const M = wm(node);
    for (const pr of mesh.listPrimitives()) { const a = pr.getAttribute("POSITION"); if (!a) continue;
      const cn = a.getCount(); for (let i = 0; i < cn; i++) { a.getElement(i, PT); const w = ap(M, PT[0], PT[1], PT[2]);
        xn=Math.min(xn,w[0]);yn=Math.min(yn,w[1]);zn=Math.min(zn,w[2]);xx=Math.max(xx,w[0]);yx=Math.max(yx,w[1]);zx=Math.max(zx,w[2]); } }
    if (!isFinite(xn)) continue;
    const prot = Math.max(hull.min[0]-xn, xx-hull.max[0], hull.min[1]-yn, yx-hull.max[1], hull.min[2]-zn, zx-hull.max[2]);
    if (prot > SEUIL) { const mats = [...new Set(mesh.listPrimitives().map((p) => p.getMaterial()?.getName() || "?"))]; bad.push({ prot, name: node.getName() || "·", mats: mats.slice(0, 2).join("|") }); } }
  bad.sort((a, b) => b.prot - a.prot);
  totalBad += bad.length;
  console.log(`${bad.length ? "✗" : "✓"} ${key.padEnd(30)} ${bad.length}/${mc} meshes hors coque (>${SEUIL}m)`);
  for (const b of bad.slice(0, 5)) console.log(`    ${b.prot.toFixed(1)}m "${b.name}" ${b.mats}`);
}
if (keys.length > 1) console.log(`\nTotal : ${totalBad} meshes hors coque sur ${keys.length} vaisseaux`);
process.exit(totalBad ? 1 : 0);
