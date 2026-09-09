// glb-bbox.mjs — mesure de bounding-box monde d'un .glb, DEQUANT-AWARE et CYCLE-SAFE.
//
// Meme geometrie que scripts/qa.mjs (dequantification KHR_mesh_quantization,
// matrices monde memoisees et sures face aux cycles de hierarchie), factorisee
// pour que gen-meta.mjs derive des dims a partir du maillage exactement comme la
// QA les recontrole. qa.mjs garde sa propre copie tant qu'il n'est pas refondu ;
// toute evolution de la mesure doit rester alignee entre les deux.

import { readFileSync } from "node:fs";

const NORM_DIV = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }; // BYTE/UBYTE/SHORT/USHORT

export function loadGlb(path) {
  const buf = readFileSync(path);
  let off = 12, json = null;
  while (off < buf.length) {
    const l = buf.readUInt32LE(off), t = buf.readUInt32LE(off + 4), s = off + 8;
    if (t === 0x4e4f534a) { json = JSON.parse(buf.subarray(s, s + l).toString("utf8")); break; }
    off = s + l;
  }
  const nodes = json?.nodes ?? [];
  const parent = new Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (parent[c] = i)));
  return { json, nodes, parent };
}

function accMinMax(pa) {
  if (!pa?.min || !pa?.max) return null;
  const div = pa.normalized ? NORM_DIV[pa.componentType] : undefined;
  if (!div) return { min: pa.min, max: pa.max };
  const deq = (v) => Math.max(v / div, -1); // clamp signe conforme glTF
  return { min: pa.min.map(deq), max: pa.max.map(deq) };
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
// Matrice monde memoisee + sure face aux cycles (cf. qa.mjs, ex. AEGS_Idris_M).
function worldMatrix(g, i) {
  const cache = g._wm ?? (g._wm = new Array(g.nodes.length).fill(null));
  const prog = g._wmProg ?? (g._wmProg = new Uint8Array(g.nodes.length));
  const rec = (k) => {
    if (cache[k]) return cache[k];
    if (prog[k]) return localMatrix(g.nodes[k]); // cycle : on stoppe la remontee
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

function emptyBox() { return { xMin: Infinity, yMin: Infinity, zMin: Infinity, xMax: -Infinity, yMax: -Infinity, zMax: -Infinity }; }
function growBox(box, [x, y, z]) {
  if (x < box.xMin) box.xMin = x; if (y < box.yMin) box.yMin = y; if (z < box.zMin) box.zMin = z;
  if (x > box.xMax) box.xMax = x; if (y > box.yMax) box.yMax = y; if (z > box.zMax) box.zMax = z;
}
const CORNERS = ([x0, y0, z0], [x1, y1, z1]) =>
  [[x0,y0,z0],[x1,y0,z0],[x0,y1,z0],[x0,y0,z1],[x1,y1,z0],[x1,y0,z1],[x0,y1,z1],[x1,y1,z1]];

// bbox monde de tout le sous-arbre du noeud idx (cycle-safe).
function subtreeWorldBBox(g, idx) {
  const box = emptyBox();
  const acc = g.json.accessors ?? [], meshes = g.json.meshes ?? [];
  let found = false;
  const stack = [idx], seen = new Set();
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
        for (const corner of CORNERS(mm.min, mm.max)) growBox(box, apply(wm, corner));
      }
    }
    for (const c of n.children ?? []) if (!seen.has(c)) stack.push(c);
  }
  return found ? box : null;
}

// bbox monde du SEUL mesh porte par le noeud i (sans ses enfants).
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
    for (const c of CORNERS(mm.min, mm.max)) growBox(box, apply(wm, c));
  }
  return found ? box : null;
}

// bbox monde de tout le modele, noeuds passant le filtre (n, i) => bool.
function worldBBox(g, filter) {
  const box = emptyBox();
  g.nodes.forEach((n, i) => {
    if (n.mesh == null || !filter(n, i)) return;
    const b = subtreeWorldBBox(g, i);
    if (b) { growBox(box, [b.xMin, b.yMin, b.zMin]); growBox(box, [b.xMax, b.yMax, b.zMax]); }
  });
  return box;
}

const extents = (box) => ({ l: box.zMax - box.zMin, b: box.xMax - box.xMin, h: box.yMax - box.yMin });
const ABERRANT_FACTOR = 1.5; // aligne sur qa.mjs

// Mesure les dims PROPRES {l,b,h} d'un .glb : bbox monde en excluant les meshes
// aberrants (bbox propre d'un noeud depassant une dim de reference * 1.5), comme
// le controle 0 de qa.mjs. La limite d'exclusion est AMORCEE depuis `seed`
// (les dims ShipData) exactement comme qa.mjs l'amorce depuis ships.meta.json :
// c'est le seul amorcage qui exclut un parasite qui domine la bbox brute (le
// self-seed depuis le brut ne le pourrait pas, la limite etant alors gonflee par
// le parasite lui-meme). Sans seed fiable, repli auto-amorce en deux passes (au
// mieux ; un axe aberrant restera alors "explose" -> signal a tenir a la main).
// Retourne { l, b, h } (metres, arrondis 0.1) ou null si aucun mesh.
export function measureCleanDims(path, seed) {
  const g = loadGlb(path);
  if (!g.json || !g.nodes.length) return null;
  const raw = worldBBox(g, () => true);
  if (!Number.isFinite(raw.xMax)) return null;
  const rawE = extents(raw);

  // Un export mono-mesh (coque en une piece, ex. Redeemer) n'a rien a exclure :
  // sa seule piece EST la coque. L'exclure viderait tout -> bbox -Infinity (faux
  // positif). On rend le brut directement.
  const meshNodes = g.nodes.filter((n) => n.mesh != null).length;
  if (meshNodes <= 1) return { l: +rawE.l.toFixed(1), b: +rawE.b.toFixed(1), h: +rawE.h.toFixed(1) };

  const cleanWith = (s) => {
    const lim = { b: s.b * ABERRANT_FACTOR, h: s.h * ABERRANT_FACTOR, l: s.l * ABERRANT_FACTOR };
    const box = worldBBox(g, (n, i) => {
      const own = nodeOwnBBox(g, i);
      if (!own) return true;
      const e = extents(own);
      return !(e.b > lim.b || e.h > lim.h || e.l > lim.l);
    });
    // Ne JAMAIS vider l'ensemble : si l'exclusion a tout retire, on garde le brut.
    return Number.isFinite(box.xMax) ? extents(box) : rawE;
  };

  const seedOk = seed && seed.l > 0 && seed.b > 0 && seed.h > 0;
  const clean = seedOk
    ? cleanWith(seed)          // amorce ShipData : aligne sur qa.mjs
    : cleanWith(cleanWith(rawE)); // repli : deux passes auto-amorcees
  return { l: +clean.l.toFixed(1), b: +clean.b.toFixed(1), h: +clean.h.toFixed(1) };
}
