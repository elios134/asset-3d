#!/usr/bin/env node
// scan-vs-dims.mjs — QA GLOBALE : bbox statique de l'exterieur vs dims RSI (ShipData).
//
// Pour chaque vaisseau : bbox des meshes STATIQUES (exclut skinned + pieces animees par nom :
// train/roues/armes/gimbals/rampes/pistons) vs dims RSI (l/b/h). Un depassement au-dela de la marge
// = pièce mal placee (ex. 350r : tuyere qui depasse alors qu'elle ne devrait pas). NE corrige RIEN.
//
// Axes glTF Y-up : longueur=z, largeur(beam)=x, hauteur=y.
// Usage : node scripts/scan-vs-dims.mjs [max]

import { NodeIO, getBounds } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = join(ROOT, "models");
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const meta = JSON.parse(readFileSync(join(ROOT, "ships.meta.json"), "utf8"));

// dims RSI officielles (ship-matrix) — la vraie reference, priorite sur ShipData
const RSI_PATH = "C:/Users/andre/Documents/ship-matrix-index.txt";
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const rsiMap = {};
try {
  for (const s of JSON.parse(readFileSync(RSI_PATH, "utf8")).data) rsiMap[norm(s.name)] = { l: s.length, b: s.beam, h: s.height };
} catch { /* pas de matrice -> fallback ShipData */ }
// dims effectives : RSI si matche, sinon ShipData
const dimsOf = (key) => {
  const r = rsiMap[norm(meta[key].name)];
  return r && r.l ? { ...r, src: "RSI" } : { ...meta[key].dims, src: "ShipData" };
};

// pieces animees / deployables a exclure (train, roues, armes, gimbals, rampes...) — PAS les tuyeres
const ANIMATED = /^bone_|landing.?gear|_gear\b|gear_|wheel|gimbal|_barrel|barrel_|missile|_turret|turret_|ladder|liftarm|_ramp\b|ramp_|_hatch|hatch_|piston|hydraul|hydrol|_arm\b|deploy/i;

// marges de tolerance
const mL = (d) => Math.max(1.5, 0.08 * d);   // longueur / beam : serre
const mH = (d) => Math.max(3.0, 0.25 * d);   // hauteur : large (train deploye)

const keys = Object.keys(meta).filter((k) => k !== "_comment" && existsSync(join(MODELS, `${k}.exterior.glb`)) && dimsOf(k).l > 0);
const max = process.argv[2] ? parseInt(process.argv[2]) : keys.length;

const flagged = [], ok = [], errored = [], noDims = [];
for (const key of keys.slice(0, max)) {
  const dims = dimsOf(key);
  try {
    const doc = await io.read(join(MODELS, `${key}.exterior.glb`));
    // bbox statique : union des bounds des noeuds non-animes portant un mesh
    let xn = Infinity, yn = Infinity, zn = Infinity, xx = -Infinity, yx = -Infinity, zx = -Infinity, n = 0;
    for (const node of doc.getRoot().listNodes()) {
      if (!node.getMesh()) continue;
      if (node.getSkin() || ANIMATED.test(node.getName() || "")) continue;
      const b = getBounds(node);
      if (!b || !isFinite(b.min[0])) continue;
      n++;
      xn = Math.min(xn, b.min[0]); yn = Math.min(yn, b.min[1]); zn = Math.min(zn, b.min[2]);
      xx = Math.max(xx, b.max[0]); yx = Math.max(yx, b.max[1]); zx = Math.max(zx, b.max[2]);
    }
    if (!n) { errored.push({ key, err: "aucun mesh statique" }); continue; }
    const got = { l: zx - zn, b: xx - xn, h: yx - yn };
    const over = { l: +(got.l - dims.l).toFixed(1), b: +(got.b - dims.b).toFixed(1), h: +(got.h - dims.h).toFixed(1) };
    const bad = (over.l > mL(dims.l)) || (over.b > mL(dims.b)) || (over.h > mH(dims.h));
    const rec = { key, name: meta[key].name, dims, got: { l: +got.l.toFixed(1), b: +got.b.toFixed(1), h: +got.h.toFixed(1) }, over };
    if (bad) flagged.push(rec); else ok.push(rec);
  } catch (e) { errored.push({ key, err: e.message.split("\n")[0] }); }
}

flagged.sort((a, b) => Math.max(b.over.l, b.over.b, b.over.h) - Math.max(a.over.l, a.over.b, a.over.h));
writeFileSync(join(ROOT, "dims-qa.json"), JSON.stringify({ flagged, ok, errored }, null, 2) + "\n");
console.log(`\n=== QA bbox statique vs dims RSI (${flagged.length + ok.length + errored.length} vaisseaux) ===`);
console.log(`  FLAGGES (depassent) : ${flagged.length}`);
console.log(`  OK                  : ${ok.length}`);
console.log(`  erreur              : ${errored.length}`);
console.log(`\n--- flaggés (tri par pire depassement) ---`);
for (const f of flagged) console.log(`  ${f.key.padEnd(26)} L ${f.got.l}/${f.dims.l}(${f.over.l >= 0 ? "+" : ""}${f.over.l}) l ${f.got.b}/${f.dims.b}(${f.over.b >= 0 ? "+" : ""}${f.over.b}) H ${f.got.h}/${f.dims.h}(${f.over.h >= 0 ? "+" : ""}${f.over.h}) [${f.dims.src}]`);
if (errored.length) console.log(`\nerreurs: ${errored.map((e) => e.key).join(", ")}`);
