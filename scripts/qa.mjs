#!/usr/bin/env node
// qa.mjs — controle qualite geometrique des exports, AVANT publication.
//
// Trois controles, sur chaque vaisseau ayant une variante `interior` :
//   0) MESHES ABERRANTS : un mesh isole dont la bbox depasse largement une dim reelle
//      du vaisseau (facteur 1.5) est signale (ex. Idris : Engine_Mount, walkway).
//      Ces meshes sont EXCLUS des references coque/dims ci-dessous (sinon ils faussent tout).
//   1) CONTAINMENT : la bbox monde de chaque noeud racine `interior_*` doit tenir dans
//      l'enveloppe de la COQUE PROPRE (bbox de la variante `exterior`, meshes aberrants
//      exclus), a une tolerance pres. Un module qui depasse = probable bug de placement.
//      (Depassements vers le bas/arriere : tolerance rampe/train plus large.)
//   2) DIMS : la bbox globale PROPRE de l'export doit correspondre aux dims reelles
//      (ships.meta.json : l/b/h). Attrape les geometries mal placees residuelles.
//
// Sortie : rapport lisible + code de sortie != 0 si un controle DUR echoue (pour CI/publish).
// Usage : node scripts/qa.mjs [--strict]  (--strict : les warnings deviennent bloquants)

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STRICT = process.argv.includes("--strict");
const modelsDir = join(ROOT, "models");
const meta = JSON.parse(readFileSync(join(ROOT, "ships.meta.json"), "utf8"));

// Tolerances (metres)
const TOL_CONTAIN = 2.0;   // depassement max tolere hors bas/arriere
const TOL_RAMP = 4.0;      // depassement tolere vers le bas (-Y) et l'arriere (+Z) : rampes/trains
const TOL_DIMS_ABS = 3.0;  // ecart absolu tolere sur l/b/h
const TOL_DIMS_REL = 0.15; // + ecart relatif tolere
const ABERRANT_FACTOR = 1.5; // un mesh dont une bbox-axe depasse dim_reelle * ce facteur = aberrant

let hardFail = 0, warns = 0;

// Regroupe les .glb par key et niveau
const files = readdirSync(modelsDir).filter((f) => f.toLowerCase().endsWith(".glb"));
const ships = new Map(); // key -> { exterior?: path, interior?: path }
for (const f of files) {
  const stem = f.slice(0, -4);
  const dot = stem.lastIndexOf(".");
  if (dot < 0) continue;
  const key = stem.slice(0, dot), level = stem.slice(dot + 1);
  if (!ships.has(key)) ships.set(key, {});
  ships.get(key)[level] = join(modelsDir, f);
}

for (const [key, variants] of ships) {
  if (!variants.interior) continue; // QA cible les intérieurs
  console.log(`\n=== ${key} ===`);
  const m = meta[key];
  const dims = m?.dims;
  const int = loadGlb(variants.interior);

  // --- Controle 0 : meshes aberrants (et set d'exclusion pour les references) ---
  const excludeInt = dims ? reportAberrant(int, dims, key + " interior") : new Set();
  const ext = variants.exterior ? loadGlb(variants.exterior) : null;
  const excludeExt = ext && dims ? reportAberrant(ext, dims, key + " exterior") : new Set();

  // --- Controle 1 : containment des modules interieurs dans la coque PROPRE ---
  if (ext) {
    const hull = worldBBox(ext, (n, i) => !excludeExt.has(i));
    // La reference n'a de sens que si ses dims sont plausibles. Sinon le containment est ininterpretable.
    const hullOk = dims && Math.abs((hull.zMax - hull.zMin) - dims.l) <= dims.l * 0.2
      && Math.abs((hull.xMax - hull.xMin) - dims.b) <= dims.b * 0.2
      && Math.abs((hull.yMax - hull.yMin) - dims.h) <= dims.h * 0.2;
    if (!hullOk) {
      console.log(`  ⚠ reference coque non fiable (bbox exterior ${(hull.xMax-hull.xMin).toFixed(0)}x${(hull.yMax-hull.yMin).toFixed(0)}x${(hull.zMax-hull.zMin).toFixed(0)}m != dims reelles) → containment ininterpretable, voir controle DIMS`);
      warns++;
    } else
    for (const root of interiorRoots(int)) {
      const box = subtreeWorldBBox(int, root.index);
      if (!box) continue;
      const over = protrusion(box, hull);
      const bad = [];
      if (over.xMin > TOL_CONTAIN) bad.push(`gauche +${over.xMin.toFixed(1)}m`);
      if (over.xMax > TOL_CONTAIN) bad.push(`droite +${over.xMax.toFixed(1)}m`);
      if (over.yMax > TOL_CONTAIN) bad.push(`haut +${over.yMax.toFixed(1)}m`);
      if (over.zMin > TOL_CONTAIN) bad.push(`avant +${over.zMin.toFixed(1)}m`);
      if (over.yMin > TOL_RAMP) bad.push(`bas +${over.yMin.toFixed(1)}m`);
      if (over.zMax > TOL_RAMP) bad.push(`arriere +${over.zMax.toFixed(1)}m`);
      if (bad.length) {
        console.log(`  ✗ ${root.name} DEPASSE la coque : ${bad.join(", ")}`);
        hardFail++;
      } else {
        console.log(`  ✓ ${root.name} contenu dans la coque`);
      }
    }
  } else {
    console.log(`  ⚠ pas de variante exterior pour la reference coque — containment non verifie`);
    warns++;
  }

  // --- Controle 2 : dims globales PROPRES vs dims reelles ---
  if (dims) {
    const gb = worldBBox(int, (n, i) => !excludeInt.has(i));
    const got = { l: gb.zMax - gb.zMin, b: gb.xMax - gb.xMin, h: gb.yMax - gb.yMin };
    for (const axis of ["l", "b", "h"]) {
      const real = dims[axis], val = got[axis], diff = Math.abs(val - real);
      const ok = diff <= TOL_DIMS_ABS || diff / real <= TOL_DIMS_REL;
      console.log(`  ${ok ? "✓" : "✗"} dim ${axis}: export propre ${val.toFixed(1)}m vs reel ${real}m (ecart ${diff.toFixed(1)}m)`);
      if (!ok) hardFail++;
    }
  } else {
    console.log(`  ⚠ dims absentes de ships.meta.json — controle dims saute`);
    warns++;
  }
}

console.log(`\n${hardFail} echec(s) dur(s), ${warns} avertissement(s).`);
if (hardFail > 0 || (STRICT && warns > 0)) {
  console.error("QA : NON CONFORME — ne pas publier en l'etat.");
  process.exit(1);
}
console.log("QA : conforme.");

// ---------- GLB + geometrie ----------

function loadGlb(path) {
  const buf = readFileSync(path);
  let off = 12, json = null;
  while (off < buf.length) {
    const l = buf.readUInt32LE(off), t = buf.readUInt32LE(off + 4), s = off + 8;
    if (t === 0x4e4f534a) { json = JSON.parse(buf.subarray(s, s + l).toString("utf8")); break; }
    off = s + l;
  }
  const nodes = json.nodes ?? [];
  const parent = new Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (parent[c] = i)));
  return { json, nodes, parent };
}

function localMatrix(n) {
  if (n.matrix) return n.matrix.slice();
  const t = n.translation ?? [0, 0, 0], r = n.rotation ?? [0, 0, 0, 1], s = n.scale ?? [1, 1, 1];
  const [x, y, z, w] = r, x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  const [sx, sy, sz] = s;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0], t[1], t[2], 1,
  ];
}
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
  return o;
}
function worldMatrix(g, i) {
  let m = localMatrix(g.nodes[i]), p = g.parent[i];
  while (p !== -1) { m = mul(localMatrix(g.nodes[p]), m); p = g.parent[p]; }
  return m;
}
function apply(m, [x, y, z]) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}
function emptyBox() { return { xMin: Infinity, yMin: Infinity, zMin: Infinity, xMax: -Infinity, yMax: -Infinity, zMax: -Infinity }; }
function growBox(box, [x, y, z]) {
  if (x < box.xMin) box.xMin = x; if (y < box.yMin) box.yMin = y; if (z < box.zMin) box.zMin = z;
  if (x > box.xMax) box.xMax = x; if (y > box.yMax) box.yMax = y; if (z > box.zMax) box.zMax = z;
}

// bbox monde de tout le sous-arbre du noeud `idx` (via min/max des accessors POSITION)
function subtreeWorldBBox(g, idx) {
  const box = emptyBox();
  const acc = g.json.accessors ?? [];
  const meshes = g.json.meshes ?? [];
  let found = false;
  const stack = [idx];
  while (stack.length) {
    const i = stack.pop();
    const n = g.nodes[i];
    if (n.mesh != null) {
      const wm = worldMatrix(g, i);
      for (const prim of meshes[n.mesh].primitives ?? []) {
        const pa = acc[prim.attributes?.POSITION];
        if (!pa?.min || !pa?.max) continue;
        found = true;
        const [x0, y0, z0] = pa.min, [x1, y1, z1] = pa.max;
        for (const corner of [[x0,y0,z0],[x1,y0,z0],[x0,y1,z0],[x0,y0,z1],[x1,y1,z0],[x1,y0,z1],[x0,y1,z1],[x1,y1,z1]])
          growBox(box, apply(wm, corner));
      }
    }
    for (const c of n.children ?? []) stack.push(c);
  }
  return found ? box : null;
}

// bbox monde de tout le modele (noeuds passant le filtre)
function worldBBox(g, filter) {
  const box = emptyBox();
  g.nodes.forEach((n, i) => {
    if (n.mesh == null || !filter(n, i)) return;
    const b = subtreeWorldBBox(g, i);
    if (b) { growBox(box, [b.xMin, b.yMin, b.zMin]); growBox(box, [b.xMax, b.yMax, b.zMax]); }
  });
  return box;
}

// bbox monde du SEUL mesh porte par le noeud i (sans ses enfants)
function nodeOwnBBox(g, i) {
  const acc = g.json.accessors ?? [], meshes = g.json.meshes ?? [];
  const n = g.nodes[i];
  if (n.mesh == null) return null;
  const wm = worldMatrix(g, i);
  const box = emptyBox();
  let found = false;
  for (const prim of meshes[n.mesh].primitives ?? []) {
    const pa = acc[prim.attributes?.POSITION];
    if (!pa?.min || !pa?.max) continue;
    found = true;
    const [x0, y0, z0] = pa.min, [x1, y1, z1] = pa.max;
    for (const c of [[x0,y0,z0],[x1,y0,z0],[x0,y1,z0],[x0,y0,z1],[x1,y1,z0],[x1,y0,z1],[x0,y1,z1],[x1,y1,z1]])
      growBox(box, apply(wm, c));
  }
  return found ? box : null;
}

// Signale les meshes dont la bbox depasse une dim reelle * ABERRANT_FACTOR.
// Retourne le Set des index de noeuds aberrants (a exclure des references).
function reportAberrant(g, dims, label) {
  const set = new Set();
  const limit = { b: dims.b * ABERRANT_FACTOR, h: dims.h * ABERRANT_FACTOR, l: dims.l * ABERRANT_FACTOR };
  const hits = [];
  g.nodes.forEach((n, i) => {
    if (n.mesh == null) return;
    const box = nodeOwnBBox(g, i);
    if (!box) return;
    const ex = box.xMax - box.xMin, ey = box.yMax - box.yMin, ez = box.zMax - box.zMin;
    if (ex > limit.b || ey > limit.h || ez > limit.l) {
      set.add(i);
      hits.push({ name: n.name || `#${i}`, ex, ey, ez });
    }
  });
  if (hits.length) {
    console.log(`  ⚠ ${hits.length} mesh(es) aberrant(s) dans ${label} (exclus des references) :`);
    for (const h of hits.slice(0, 8))
      console.log(`      ${h.name.padEnd(40)} bbox ${h.ex.toFixed(0)}x${h.ey.toFixed(0)}x${h.ez.toFixed(0)} m`);
    if (hits.length > 8) console.log(`      … +${hits.length - 8} autres`);
    warns += hits.length;
  }
  return set;
}

// noeuds racines de module interieur
function interiorRoots(g) {
  return g.nodes
    .map((n, index) => ({ n, index }))
    .filter(({ n, index }) => n.name && /^interior_base_int_/i.test(n.name))
    .map(({ n, index }) => ({ name: n.name, index }));
}

// de combien `box` depasse `hull` sur chaque face (positif = depasse)
function protrusion(box, hull) {
  return {
    xMin: hull.xMin - box.xMin, xMax: box.xMax - hull.xMax,
    yMin: hull.yMin - box.yMin, yMax: box.yMax - hull.yMax,
    zMin: hull.zMin - box.zMin, zMax: box.zMax - hull.zMax,
  };
}
