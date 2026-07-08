#!/usr/bin/env node
// generate-floor.mjs — genere un PLANCHER PROPRE pour un interieur (pivot resine).
// Principe : grille (x,z) de CELL m. Pour chaque cellule, on echantillonne les hauteurs de surface
// des vertices INTERIEURS (hors shell) et on trouve la hauteur de PLANCHER = la surface la plus basse
// qui a un vide debout (>= CLEAR) au-dessus. Puis passe de REMPLISSAGE : une cellule sans plancher
// mais entouree de cellules-plancher herite de la hauteur mediane des voisines (bouche les trous du
// sol). On sort une soupe de quads (2 tris/cellule) a la hauteur plancher -> mesh propre et etanche.
//
// Usage : node scripts/generate-floor.mjs <in.glb> <out-floor.glb> [--cell=0.5] [--clear=1.8]

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";

const args = process.argv.slice(2);
const inPath = args[0], outPath = args[1];
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? parseFloat(a.split("=")[1]) : d; };
const CELL = opt("cell", 0.5), CLEAR = opt("clear", 1.9), CEIL_MAX = opt("ceil", 3.8), YSNAP = 0.15;
const LIFT = opt("lift", 0.2); // le niveau detecte = surface la plus basse ; on remonte au niveau de marche

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };

const doc = await io.read(inPath);
const nodes = doc.getRoot().listNodes();
const pm = new Map(); for (const n of nodes) for (const c of n.listChildren()) pm.set(c, n);
const wm = (n) => { let m = n.getMatrix(), p = pm.get(n), seen = new Set([n]), d = 0; while (p && !seen.has(p) && d < 200) { m = mul(p.getMatrix(), m); seen.add(p); p = pm.get(p); d++; } return m; };
const isShell = (n) => { let p = n, s = new Set(); while (p && !s.has(p)) { s.add(p); if ((p.getName() || "").toLowerCase().includes("occluder_shell")) return true; p = pm.get(p); } return false; };

// 1) echantillonnage des hauteurs par cellule (interieur seul)
const cells = new Map(); // "cx,cz" -> number[] (hauteurs)
const P = [0, 0, 0];
let ymin = Infinity, ymax = -Infinity;
for (const node of nodes) {
  const mesh = node.getMesh(); if (!mesh || isShell(node)) continue;
  const M = wm(node);
  for (const prim of mesh.listPrimitives()) {
    const a = prim.getAttribute("POSITION"); if (!a) continue;
    const cnt = a.getCount();
    for (let i = 0; i < cnt; i++) {
      a.getElement(i, P);
      const x = M[0]*P[0]+M[4]*P[1]+M[8]*P[2]+M[12];
      const y = M[1]*P[0]+M[5]*P[1]+M[9]*P[2]+M[13];
      const z = M[2]*P[0]+M[6]*P[1]+M[10]*P[2]+M[14];
      const ck = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
      let arr = cells.get(ck); if (!arr) cells.set(ck, (arr = [])); arr.push(y);
      if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    }
  }
}

// 2) hauteur plancher par cellule = surface la plus basse avec vide debout au-dessus
const floorH = new Map();
for (const [ck, ys] of cells) {
  ys.sort((a, b) => a - b);
  // clusters de surface (bins tasses)
  const levels = [];
  for (const y of ys) { if (!levels.length || y - levels[levels.length - 1] > YSNAP) levels.push(y); }
  // plus bas niveau L tel que : (a) vide debout [L+0.3, L+CLEAR] libre ET (b) un PLAFOND existe dans
  // [L+CLEAR, L+CEIL_MAX] -> confine aux VRAIES pieces closes (pas la coque ouverte / le dessous des ailes).
  let floor = null;
  for (let i = 0; i < levels.length; i++) {
    const L = levels[i];
    const clear = !levels.some((v) => v > L + 0.3 && v < L + CLEAR);
    const ceiling = levels.some((v) => v >= L + CLEAR && v <= L + CEIL_MAX);
    if (clear && ceiling) { floor = L; break; }
  }
  if (floor != null) floorH.set(ck, floor);
}

// 3) passe de remplissage : cellule sans plancher mais >=3 voisines-plancher -> mediane des voisines
const parse = (ck) => ck.split(",").map(Number);
for (let pass = 0; pass < 6; pass++) {
  const add = [];
  const keysAll = new Set([...cells.keys(), ...floorH.keys()]);
  // etendre le domaine aux trous entoures : on considere les cellules candidates = voisines des planchers
  const candidates = new Set();
  for (const ck of floorH.keys()) { const [cx, cz] = parse(ck); for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) candidates.add(`${cx+dx},${cz+dz}`); }
  for (const ck of candidates) {
    if (floorH.has(ck)) continue;
    const [cx, cz] = parse(ck);
    const nb = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { if (!dx && !dz) continue; const h = floorH.get(`${cx+dx},${cz+dz}`); if (h != null) nb.push(h); }
    if (nb.length >= 3) { nb.sort((a, b) => a - b); add.push([ck, nb[nb.length >> 1]]); }
  }
  if (!add.length) break;
  for (const [ck, h] of add) floorH.set(ck, h);
}

// 3b) DEBRUITAGE local (remplace le snap "ponts dominants" trop grossier qui jetait le cockpit) :
// (i) lissage MEDIAN 3x3 -> tue le sel-et-poivre en PRESERVANT chaque niveau reel (pont principal,
// cockpit sureleve, etc.) ; (ii) COMPOSANTES CONNEXES (voisins a |Δh|<0.8m = meme surface continue)
// -> on jette les ilots < MINREGION cellules (plaques flottantes parasites) mais on garde les regions
// coherentes meme petites (le cockpit). Un vrai pont reste, une detection isolee saute.
{
  for (let pass = 0; pass < 2; pass++) {
    const upd = [];
    for (const ck of floorH.keys()) {
      const [cx, cz] = parse(ck); const v = [];
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const h = floorH.get(`${cx+dx},${cz+dz}`); if (h != null) v.push(h); }
      v.sort((a, b) => a - b); upd.push([ck, v[v.length >> 1]]);
    }
    for (const [ck, m] of upd) floorH.set(ck, m);
  }
  const MINREGION = 10; // < 2.5 m2 connecte = ilot parasite
  const seen = new Set(); const comps = [];
  for (const start of floorH.keys()) {
    if (seen.has(start)) continue;
    const stack = [start], comp = []; seen.add(start);
    while (stack.length) {
      const ck = stack.pop(); comp.push(ck); const [cx, cz] = parse(ck); const h = floorH.get(ck);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { if (!dx && !dz) continue; const nk = `${cx+dx},${cz+dz}`; if (seen.has(nk)) continue; const nh = floorH.get(nk); if (nh != null && Math.abs(nh - h) < 0.8) { seen.add(nk); stack.push(nk); } }
    }
    const hs = comp.map((ck) => floorH.get(ck)).sort((a, b) => a - b);
    comps.push({ comp, size: comp.length, medH: hs[hs.length >> 1] });
  }
  const main = comps.reduce((a, b) => (b.size > a.size ? b : a), comps[0]);
  const drop = [];
  for (const c of comps) { if (c.size < MINREGION || c.medH < main.medH - 1.6) drop.push(...c.comp); } // ilots + cavites sous-plancher
  for (const ck of drop) floorH.delete(ck);
  const keptComps = comps.filter((c) => c.size >= MINREGION && c.medH >= main.medH - 1.6).length;
  console.log(`debruitage : ${keptComps}/${comps.length} regions gardees, pont principal y=${main.medH.toFixed(1)} (${main.size}c), ${drop.length} cellules jetees`);
}

// 3d) GARDE-FOU EXPLOSE (reco QA app) : un interieur a geometrie eclatee (ex. VNCL_Mauler : object
// containers non exportes -> debris disperses) genere un FAUX plancher etale verticalement sur des
// dizaines de m (Mauler 78 m ; les 61 sains <= 22 m). Mesure ICI sur floorH BRUT (avant quantization
// meshopt, ou l'etalement reel est lisible). yspread > MAXYS -> on vide floorH -> collision_walk vide
// -> l'invariant de build-clay SKIP le ship. Capte le Mauler et tout futur explose, proprement.
const MAXYS = opt("max-yspread", 30);
if (floorH.size) {
  let ymn = Infinity, ymx = -Infinity; for (const h of floorH.values()) { if (h < ymn) ymn = h; if (h > ymx) ymx = h; }
  const ys = ymx - ymn;
  console.log(`yspread plancher = ${ys.toFixed(1)} m (seuil explose ${MAXYS} m)`);
  if (ys > MAXYS) { console.log(`⚠ INTERIEUR EXPLOSE (yspread ${ys.toFixed(1)} > ${MAXYS}) -> plancher vide -> ship rejete par l'invariant`); floorH.clear(); }
}

// 3c) spawn_point : cellule la plus DEGAGEE (max distance au bord du plancher, erosion Chebyshev).
// Evite le centroide geometrique qui tombe souvent sur un obstacle (colonne centrale de soute Cutlass).
let spawn = null;        // cellule de plancher (fallback erosion)
let spawnPos = null;     // position 3D explicite (indice marqueur cockpit/passerelle)
// INDICE MARQUEUR : --spawn-hint=x,y,z (position monde du siege pilote/capitaine/console de passerelle).
// On place spawn_point DIRECTEMENT a cette position 3D -> l'app snappe au sol du BON pont par raycast.
// Le Y est crucial en MULTI-PONT : a une meme colonne XZ, la passerelle Idris (y=20) et le pont inferieur
// (y=5) coexistent ; un indice XZ seul snapperait au plus bas (bug spawn Idris mi-vaisseau). Le Y desambigue.
{
  const ha = args.find((x) => x.startsWith("--spawn-hint="));
  const hint = ha ? ha.split("=")[1].split(",").map(Number) : null;
  if (hint && hint.length >= 3 && hint.every((v) => isFinite(v))) {
    spawnPos = [hint[0], hint[1], hint[2]];
    console.log(`spawn_point (indice marqueur 3D) @ monde (${hint[0].toFixed(1)}, ${hint[1].toFixed(1)}, ${hint[2].toFixed(1)})`);
  }
}
if (spawnPos == null) {
  const dist = new Map();
  const has = (cx, cz) => floorH.has(`${cx},${cz}`);
  for (const ck of floorH.keys()) {
    const [cx, cz] = parse(ck); let border = false;
    for (let dx = -1; dx <= 1 && !border; dx++) for (let dz = -1; dz <= 1; dz++) { if (!dx && !dz) continue; if (!has(cx + dx, cz + dz)) { border = true; break; } }
    dist.set(ck, border ? 1 : Infinity);
  }
  for (let pass = 0; pass < 300; pass++) {
    let changed = false;
    for (const ck of floorH.keys()) {
      const [cx, cz] = parse(ck); let m = dist.get(ck);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { if (!dx && !dz) continue; const nd = dist.get(`${cx+dx},${cz+dz}`); if (nd != null && nd + 1 < m) m = nd + 1; }
      if (m < dist.get(ck)) { dist.set(ck, m); changed = true; }
    }
    if (!changed) break;
  }
  let best = -1; for (const [ck, d] of dist) if (d > best && d !== Infinity) { best = d; spawn = ck; }
  if (spawn != null) { const [cx, cz] = parse(spawn); const h = floorH.get(spawn) + LIFT; console.log(`spawn_point : cellule ${spawn} (degagement ${best} cases) @ monde (${(cx*CELL+CELL/2).toFixed(1)}, ${h.toFixed(1)}, ${(cz*CELL+CELL/2).toFixed(1)})`); }
}

// 4) genere les quads (2 tris/cellule) a la hauteur plancher
const positions = [], indices = [];
let vi = 0;
const normals = [];
for (const [ck, h] of floorH) {
  const [cx, cz] = parse(ck);
  const y = h + LIFT;
  const x0 = cx * CELL, z0 = cz * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
  positions.push(x0, y, z0,  x1, y, z0,  x1, y, z1,  x0, y, z1);
  normals.push(0,1,0, 0,1,0, 0,1,0, 0,1,0); // normales +Y (eclairage correct si rendu)
  indices.push(vi, vi + 2, vi + 1,  vi, vi + 3, vi + 2); // face vers le haut
  vi += 4;
}

// 5) ecrit un GLB plancher SEUL (repere monde = identite, positions deja en monde) -> mesh "collision_walk"
const { Document } = await import("@gltf-transform/core");
const out = new Document();
const buf = out.createBuffer();
const acc = out.createAccessor("floorPos").setType("VEC3").setArray(new Float32Array(positions)).setBuffer(buf);
const nrm = out.createAccessor("floorNrm").setType("VEC3").setArray(new Float32Array(normals)).setBuffer(buf);
const idx = out.createAccessor("floorIdx").setType("SCALAR").setArray(new Uint32Array(indices)).setBuffer(buf);
const mat = out.createMaterial("floor_mat").setBaseColorFactor([0.37, 0.4, 0.44, 1]).setRoughnessFactor(1).setMetallicFactor(0).setDoubleSided(true);
const prim = out.createPrimitive().setAttribute("POSITION", acc).setAttribute("NORMAL", nrm).setIndices(idx).setMaterial(mat);
const fnode = out.createNode("collision_walk").setMesh(out.createMesh("collision_walk").addPrimitive(prim));
const scene = out.createScene().addChild(fnode);

// 5b) FLOOR_PATCH : patch VISUEL du sol (rendu clay), memes quads mais legerement SOUS le plancher
// (-PATCH_DROP) pour ne montrer QUE par les trous du sol visuel sans z-fighting avec le vrai sol.
// Comble les trous de plancher que le shell (coque ext) ne couvre pas (trous vers le pont du dessous).
// Nom distinct -> l'app le REND (matcap), contrairement a collision_walk (render-off). Desactivable --no-patch.
if (!args.includes("--no-patch")) {
  const PATCH_DROP = 0.03;
  const ppos = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) { ppos[i] = positions[i]; ppos[i+1] = positions[i+1] - PATCH_DROP; ppos[i+2] = positions[i+2]; }
  const pacc = out.createAccessor("patchPos").setType("VEC3").setArray(ppos).setBuffer(buf);
  const pnrm = out.createAccessor("patchNrm").setType("VEC3").setArray(new Float32Array(normals)).setBuffer(buf);
  const pidx = out.createAccessor("patchIdx").setType("SCALAR").setArray(new Uint32Array(indices)).setBuffer(buf);
  const pmat = out.createMaterial("floor_patch_mat").setBaseColorFactor([0.4, 0.42, 0.45, 1]).setRoughnessFactor(1).setMetallicFactor(0).setDoubleSided(true);
  const pprim = out.createPrimitive().setAttribute("POSITION", pacc).setAttribute("NORMAL", pnrm).setIndices(pidx).setMaterial(pmat);
  scene.addChild(out.createNode("floor_patch").setMesh(out.createMesh("floor_patch").addPrimitive(pprim)));
}
// noeud vide spawn_point (l'app s'y ancre par nom). Priorite : position 3D du marqueur (cockpit/passerelle),
// sinon cellule la plus degagee (erosion). L'app snappe au sol + garde le point degage.
if (spawnPos != null) { scene.addChild(out.createNode("spawn_point").setTranslation([spawnPos[0], spawnPos[1], spawnPos[2]])); }
else if (spawn != null) { const [sx, sz] = parse(spawn); const sy = floorH.get(spawn) + LIFT; scene.addChild(out.createNode("spawn_point").setTranslation([sx*CELL+CELL/2, sy, sz*CELL+CELL/2])); }
await io.write(outPath, out);
const areaM2 = (floorH.size * CELL * CELL).toFixed(0);
console.log(`plancher : ${floorH.size} cellules -> ${areaM2} m2 couverts · ${positions.length/3} verts · CELL=${CELL} CLEAR=${CLEAR} CEIL_MAX=${CEIL_MAX}`);
// diagnostics : histogramme des hauteurs plancher + emprise XZ
let fxn=Infinity,fxx=-Infinity,fzn=Infinity,fzx=-Infinity;
const hist = new Map();
for (const [ck, h] of floorH) { const [cx,cz]=parse(ck); const x=cx*CELL,z=cz*CELL; fxn=Math.min(fxn,x);fxx=Math.max(fxx,x);fzn=Math.min(fzn,z);fzx=Math.max(fzx,z); const b=Math.round(h*2)/2; hist.set(b,(hist.get(b)||0)+1); }
console.log(`emprise plancher X[${fxn.toFixed(1)},${fxx.toFixed(1)}] Z[${fzn.toFixed(1)},${fzx.toFixed(1)}]  (geom interieur Y[${ymin.toFixed(1)},${ymax.toFixed(1)}])`);
console.log("histogramme hauteurs plancher (y -> nb cellules, emprise Z) :");
const zByH = new Map();
for (const [ck, h] of floorH) { const [, cz] = parse(ck); const z = cz * CELL; const b = Math.round(h * 2) / 2; let e = zByH.get(b); if (!e) zByH.set(b, e = [Infinity, -Infinity]); e[0] = Math.min(e[0], z); e[1] = Math.max(e[1], z); }
for (const [h,c] of [...hist].sort((a,b)=>a[0]-b[0])) { const z = zByH.get(h) || [0,0]; console.log(`  y=${String(h).padStart(5)}  ${"#".repeat(Math.ceil(c/15))} ${c}  Z[${z[0].toFixed(0)},${z[1].toFixed(0)}]`); }
