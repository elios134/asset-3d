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
import { makeEmitter } from "./lib/emit.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STRICT = process.argv.includes("--strict");
const JSON_MODE = process.argv.includes("--json");
const emit = makeEmitter(JSON_MODE);
if (JSON_MODE) console.log = () => {}; // stdout = NDJSON pur : on silence le rapport humain (les erreurs partent sur stderr)
// Overrides (tests / usages hors-racine) : --models=<dir> --meta=<fichier>.
const argVal = (name, def) => {
  const p = process.argv.find((a) => a.startsWith(name + "="));
  return p ? p.slice(name.length + 1) : def;
};
const modelsDir = argVal("--models", join(ROOT, "models"));
const meta = JSON.parse(readFileSync(argVal("--meta", join(ROOT, "ships.meta.json")), "utf8"));

// Tolerances (metres)
const TOL_CONTAIN = 2.0;   // depassement max tolere hors bas/arriere
const TOL_RAMP = 4.0;      // depassement tolere vers le bas (-Y) et l'arriere (+Z) : rampes/trains
const TOL_DIMS_ABS = 3.0;  // ecart absolu tolere sur l/b/h
const TOL_DIMS_REL = 0.15; // + ecart relatif tolere
const ABERRANT_FACTOR = 1.5; // un mesh dont une bbox-axe depasse dim_reelle * ce facteur = aberrant

let hardFail = 0, warns = 0, shipCount = 0;

// Regroupe les .glb par key et niveau
const files = readdirSync(modelsDir).filter((f) => f.toLowerCase().endsWith(".glb"));
const ships = new Map(); // key -> { exterior?: path, interior?: path }
for (const f of files) {
  const stem = f.slice(0, -4);
  const dot = stem.lastIndexOf(".");
  if (dot < 0) continue;
  const key = stem.slice(0, dot), rawLevel = stem.slice(dot + 1);
  // Le catalogue publié est 100 % clay : on ne contrôle que les variantes clay
  // canoniques (clay-exterior / clay-interior). On ignore le legacy HD
  // (.exterior/.interior) et les variantes hors-index (out-tag, ex. clay-soft-interior).
  const level = rawLevel === "clay-interior" ? "interior" : rawLevel === "clay-exterior" ? "exterior" : null;
  if (!level) continue;
  if (!ships.has(key)) ships.set(key, {});
  ships.get(key)[level] = join(modelsDir, f);
}

for (const [key, variants] of ships) {
  if (!variants.interior) continue; // QA cible les intérieurs
  console.log(`\n=== ${key} ===`);
  const m = meta[key];
  const dims = m?.dims;
  const int = loadGlb(variants.interior);
  const msgs = [];               // messages "problème" de CE vaisseau (pour l'UI)
  const h0 = hardFail, w0 = warns; // snapshot pour le delta par vaisseau

  // --- Controle 0 : meshes aberrants (et set d'exclusion pour les references) ---
  const excludeInt = dims ? reportAberrant(int, dims, key + " interior", msgs) : new Set();
  const ext = variants.exterior ? loadGlb(variants.exterior) : null;
  const excludeExt = ext && dims ? reportAberrant(ext, dims, key + " exterior", msgs) : new Set();

  // --- Controle 1 : containment des modules interieurs dans la coque PROPRE ---
  if (ext) {
    const hull = worldBBox(ext, (n, i) => !excludeExt.has(i));
    // La reference n'a de sens que si ses dims sont plausibles. Sinon le containment est ininterpretable.
    const hullOk = dims && Math.abs((hull.zMax - hull.zMin) - dims.l) <= dims.l * 0.2
      && Math.abs((hull.xMax - hull.xMin) - dims.b) <= dims.b * 0.2
      && Math.abs((hull.yMax - hull.yMin) - dims.h) <= dims.h * 0.2;
    if (!hullOk) {
      const msg = `référence coque non fiable (bbox exterior ${(hull.xMax-hull.xMin).toFixed(0)}x${(hull.yMax-hull.yMin).toFixed(0)}x${(hull.zMax-hull.zMin).toFixed(0)}m ≠ dims réelles) → containment ininterprétable, voir contrôle DIMS`;
      console.log(`  ⚠ ${msg}`);
      msgs.push(msg);
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
        msgs.push(`${root.name} dépasse la coque : ${bad.join(", ")}`);
        hardFail++;
      } else {
        console.log(`  ✓ ${root.name} contenu dans la coque`);
      }
    }
  } else {
    const msg = "pas de variante exterior pour la référence coque — containment non vérifié";
    console.log(`  ⚠ ${msg}`);
    msgs.push(msg);
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
      if (!ok) { hardFail++; msgs.push(`dim ${axis} : export ${val.toFixed(1)}m vs réel ${real}m (écart ${diff.toFixed(1)}m)`); }
    }
  } else {
    const msg = "dims absentes de ships.meta.json — contrôle dims sauté";
    console.log(`  ⚠ ${msg}`);
    msgs.push(msg);
    warns++;
  }

  shipCount++;
  emit({ type: "ship", key, name: m?.name ?? key, hard: hardFail - h0, warns: warns - w0, messages: msgs });
}

console.log(`\n${hardFail} echec(s) dur(s), ${warns} avertissement(s).`);
const conforme = hardFail === 0 && !(STRICT && warns > 0);
emit({ type: "result", conforme, ships: shipCount, hard: hardFail, warns });
if (!conforme) {
  console.error("QA : NON CONFORME — ne pas publier en l'etat.");
  // En mode --json, le verdict voyage dans l'event `result` ; on ne sort pas en
  // erreur (le consommateur machine lit `conforme`). En mode humain/CI, exit≠0.
  if (!JSON_MODE) process.exit(1);
} else {
  console.log("QA : conforme.");
}

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
// Matrice monde d'un noeud, MEMOISEE (une seule fois par noeud, reutilisee par
// reportAberrant/worldBBox/containment) et SURE FACE AUX CYCLES : certains exports
// (ex. AEGS_Idris_M : 61 noeuds) ont une hierarchie cyclique (A enfant de B, B
// enfant de A). Sans garde, la remontee de parents boucle a l'infini. Le drapeau
// `prog` (calcul en cours) casse la boucle : un noeud rencontre dans sa propre
// chaine d'ancetres est traite comme une racine (sa locale sert de base).
function worldMatrix(g, i) {
  const cache = g._wm ?? (g._wm = new Array(g.nodes.length).fill(null));
  const prog = g._wmProg ?? (g._wmProg = new Uint8Array(g.nodes.length));
  const rec = (k) => {
    const hit = cache[k];
    if (hit) return hit;
    if (prog[k]) return localMatrix(g.nodes[k]); // cycle detecte : on stoppe la remontee
    prog[k] = 1;
    const local = localMatrix(g.nodes[k]);
    const p = g.parent[k];
    const m = p === -1 ? local : mul(rec(p), local);
    prog[k] = 0;
    cache[k] = m;
    return m;
  };
  return rec(i);
}
function apply(m, [x, y, z]) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}
// Déquantification KHR_mesh_quantization : les exports clay stockent POSITION en
// entiers NORMALISÉS (ex. int16), et un scale de noeud reconvertit en mètres.
// min/max sont alors dans l'espace entier ; il faut les ramener dans [-1,1] AVANT
// d'appliquer la matrice monde (qui porte le scale). Sans ça, ±32767 × scale ⇒
// bbox géante ⇒ meshes "aberrants" exclus ⇒ coque/dims vides (-Infinity).
// NB : déclaration de fonction (hoistée) car appelée depuis la boucle principale.
function accMinMax(pa) {
  if (!pa?.min || !pa?.max) return null;
  const NORM_DIV = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }; // BYTE/UBYTE/SHORT/USHORT
  const div = pa.normalized ? NORM_DIV[pa.componentType] : undefined;
  if (!div) return { min: pa.min, max: pa.max };
  const deq = (v) => Math.max(v / div, -1); // clamp signé conforme glTF ; sans effet sur non signé (≥0)
  return { min: pa.min.map(deq), max: pa.max.map(deq) };
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
  const seen = new Set(); // stoppe les cycles de hierarchie (children A<->B), cf. worldMatrix
  while (stack.length) {
    const i = stack.pop();
    if (seen.has(i)) continue;
    seen.add(i);
    const n = g.nodes[i];
    if (n.mesh != null) {
      const wm = worldMatrix(g, i);
      for (const prim of meshes[n.mesh].primitives ?? []) {
        const mm = accMinMax(acc[prim.attributes?.POSITION]);
        if (!mm) continue;
        found = true;
        const [x0, y0, z0] = mm.min, [x1, y1, z1] = mm.max;
        for (const corner of [[x0,y0,z0],[x1,y0,z0],[x0,y1,z0],[x0,y0,z1],[x1,y1,z0],[x1,y0,z1],[x0,y1,z1],[x1,y1,z1]])
          growBox(box, apply(wm, corner));
      }
    }
    for (const c of n.children ?? []) if (!seen.has(c)) stack.push(c);
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
    const mm = accMinMax(acc[prim.attributes?.POSITION]);
    if (!mm) continue;
    found = true;
    const [x0, y0, z0] = mm.min, [x1, y1, z1] = mm.max;
    for (const c of [[x0,y0,z0],[x1,y0,z0],[x0,y1,z0],[x0,y0,z1],[x1,y1,z0],[x1,y0,z1],[x0,y1,z1],[x1,y1,z1]])
      growBox(box, apply(wm, c));
  }
  return found ? box : null;
}

// Signale les meshes dont la bbox depasse une dim reelle * ABERRANT_FACTOR.
// Retourne le Set des index de noeuds aberrants (a exclure des references).
function reportAberrant(g, dims, label, sink) {
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
    if (sink) sink.push(`${hits.length} mesh(es) aberrant(s) dans ${label} (exclus des références)`);
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
