// QA gate collision_hull : CONNECTIVITE DE MARCHE. Reproduit l'experience joueur : depuis spawn_point,
// flood-fill sur les cellules du filet collision_walk ; une cellule est franchissable si la colonne d'air
// 0.4-1.6 m au-dessus ne contient AUCUN voxel du collision_hull. Detecte les passages scelles par le
// simplify (portes/couloirs) PEU IMPORTE ou ils sont — les rayons fins aux portes ne suffisent pas
// (une capsule ne passe pas la ou un rayon passe). Leak-proof : le flood est borne au filet de sol.
// usage: node scripts/verify-walk.mjs models/KEY.clay-interior.glb [--hull=autre.glb] [--min=85] [--list]
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dequantize } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
const argOpt = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const LIST = process.argv.includes("--list");
const srcPath = process.argv[2];
const hullPath = argOpt("hull", srcPath);
const MIN_PCT = parseFloat(argOpt("min", "85"));
const CAPSULE_R = parseFloat(argOpt("capsule", "0")); // rayon capsule joueur (m) ; 0 = colonne fine (defaut)
const CELL = 0.25;

const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const ap = (m, x, y, z) => [m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]];

function collect(doc, filter) {
  // filter(nomDuNoeud, sousChunk) — sousChunk = un ancetre s'appelle chunk_* (les meshes chunkes sont anonymes)
  const out = [];
  for (const scene of doc.getRoot().listScenes()) {
    const st = scene.listChildren().map((n) => [n, [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], false]);
    while (st.length) {
      const [node, pm, inChunk] = st.pop();
      const wm = mul(pm, node.getMatrix());
      const nm = node.getName() || "";
      const flag = inChunk || /^chunk_/.test(nm);
      const mesh = node.getMesh();
      if (mesh && filter(nm, flag)) for (const pr of mesh.listPrimitives()) {
        const pos = pr.getAttribute("POSITION"); if (!pos) continue;
        out.push({ wm, pos: pos.getArray(), idx: pr.getIndices()?.getArray() ?? null });
      }
      for (const c of node.listChildren()) st.push([c, wm, flag]);
    }
  }
  return out;
}
// triangles monde [ax,ay,az,bx,...] aplatis
function worldTris(prims) {
  let n = 0; for (const p of prims) n += Math.floor((p.idx ? p.idx.length : p.pos.length / 3) / 3);
  const out = new Float64Array(n * 9); let o = 0;
  for (const p of prims) {
    const cnt = p.idx ? p.idx.length : p.pos.length / 3;
    for (let i = 0; i + 2 < cnt; i += 3) for (let k = 0; k < 3; k++) {
      const j = p.idx ? p.idx[i + k] : i + k;
      const w = ap(p.wm, p.pos[j*3], p.pos[j*3+1], p.pos[j*3+2]);
      out[o++] = w[0]; out[o++] = w[1]; out[o++] = w[2];
    }
  }
  return out;
}

const doc = await io.read(srcPath);
await doc.transform(dequantize()); // meshopt quantize : POSITION = entiers bruts sans ca
const hullDoc = hullPath === srcPath ? doc : await io.read(hullPath);
if (hullDoc !== doc) await hullDoc.transform(dequantize());
const COLLIDER = argOpt("collider", "hull"); // hull (defaut) | chunks (= comportement in-game actuel, baseline)
// surface de marche = collision_walk + floor_patch (l'app collisionne les deux ; le walk seul est erode
// aux seuils de portes -> ilots par piece -> faux "injoignable")
const walk = worldTris(collect(doc, (nm) => /collision_walk|floor_patch/i.test(nm)));
const hull = COLLIDER === "chunks"
  ? worldTris(collect(hullDoc, (nm, inChunk) => inChunk && !/door|hatch/i.test(nm)))
  : worldTris(collect(hullDoc, (nm) => /collision_hull/i.test(nm)));
if (!walk.length) { console.error("collision_walk absent"); process.exit(2); }
if (!hull.length) { console.error(`collider "${COLLIDER}" absent de ` + hullPath); process.exit(2); }
let spawn = null;
for (const s of doc.getRoot().listScenes()) { const st = [...s.listChildren().map((n) => [n, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]])]; while (st.length) { const [n, pm] = st.pop(); const wm = mul(pm, n.getMatrix()); if (n.getName() === "spawn_point") spawn = [wm[12], wm[13], wm[14]]; for (const c of n.listChildren()) st.push([c, wm]); } }
if (!spawn) { console.error("spawn_point absent"); process.exit(2); }

// grille voxel bornee par le WALK seul (+3 m) : le hull peut contenir des vertices aberrants tres loin
// (debris du simplify) qui exploseraient la grille ; hors grille = ignore (pas clampe, sinon les plans
// de bord deviendraient solides)
let mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
for (let i = 0; i < walk.length; i += 3) for (let k = 0; k < 3; k++) { if (walk[i+k] < mn[k]) mn[k] = walk[i+k]; if (walk[i+k] > mx[k]) mx[k] = walk[i+k]; }
for (let k = 0; k < 3; k++) { mn[k] -= 3; mx[k] += 3; }
const nx = Math.ceil((mx[0]-mn[0])/CELL), ny = Math.ceil((mx[1]-mn[1])/CELL), nz = Math.ceil((mx[2]-mn[2])/CELL);
const solid = new Uint8Array(nx * ny * nz);
const vid = (x, y, z) => x + nx * (z + nz * y); // y en dernier (plans y contigus par (x,z))
const inb = (x, y, z) => x >= mn[0] && x < mx[0] && y >= mn[1] && y < mx[1] && z >= mn[2] && z < mx[2];
const ix = (v) => Math.floor((v - mn[0]) / CELL);
const iy = (v) => Math.floor((v - mn[1]) / CELL);
const iz = (v) => Math.floor((v - mn[2]) / CELL);

// voxelisation par echantillonnage barycentrique de la surface (pas d'AABB conservatif : les gros tris
// deformes marqueraient des boites entieres en solide)
function voxelize(tris, mark) {
  const STEP = CELL * 0.45;
  for (let t = 0; t < tris.length; t += 9) {
    const ax = tris[t], ay = tris[t+1], az = tris[t+2], bx = tris[t+3], by = tris[t+4], bz = tris[t+5], cx = tris[t+6], cy = tris[t+7], cz = tris[t+8];
    const e1 = Math.hypot(bx-ax, by-ay, bz-az), e2 = Math.hypot(cx-ax, cy-ay, cz-az);
    const nu = Math.max(1, Math.ceil(e1 / STEP)), nv = Math.max(1, Math.ceil(e2 / STEP));
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv - Math.floor(i * nv / nu); j++) {
      const u = i / nu, v = j / nv; if (u + v > 1.0001) continue;
      mark(ax + u*(bx-ax) + v*(cx-ax), ay + u*(by-ay) + v*(cy-ay), az + u*(bz-az) + v*(cz-az));
    }
  }
}
voxelize(hull, (x, y, z) => { if (inb(x, y, z)) solid[vid(ix(x), iy(y), iz(z))] = 1; });

// cellules de marche : (ix,iz) -> ys distincts (multi-pont). walkVox = voxels qui SONT de la surface de
// marche (marche d'escalier, rampe) : ils ne comptent PAS comme obstacle dans la colonne d'air — sinon
// chaque escalier "bloque" les marches du dessous et les ponts se deconnectent (faux negatif massif).
const walkVox = new Uint8Array(nx * ny * nz);
const cells = new Map(); // key ix+iz*nx -> array de y
voxelize(walk, (x, y, z) => {
  if (!inb(x, y, z)) return;
  const vx = ix(x), vy = iy(y), vz = iz(z);
  walkVox[vid(vx, vy, vz)] = 1; if (vy + 1 < ny) walkVox[vid(vx, vy + 1, vz)] = 1; // + contremarche au-dessus
  const k = vx + vz * nx;
  let ys = cells.get(k); if (!ys) { ys = []; cells.set(k, ys); }
  for (const yy of ys) if (Math.abs(yy - y) < 0.35) return;
  ys.push(y);
});

// franchissable : bande d'air 0.5-1.7 m au-dessus du pied, sans voxel hull (hors surface de marche).
// avec CAPSULE_R>0 : tout le disque horizontal de rayon CAPSULE_R autour de (cx,cz) doit etre libre
// (replique le check capsule de l'app : embrasure remeshee < diametre => bloquee).
const RC = CAPSULE_R > 0 ? Math.round(CAPSULE_R / CELL) : 0;
const passable = (cx, cz, y) => {
  for (let h = 0.5; h <= 1.7; h += CELL) {
    const yy = iy(y + h);
    for (let dx = -RC; dx <= RC; dx++) for (let dz = -RC; dz <= RC; dz++) {
      if (dx*dx + dz*dz > RC*RC) continue;
      const gx = cx + dx, gz = cz + dz; if (gx < 0 || gx >= nx || gz < 0 || gz >= nz) continue;
      const v = vid(gx, yy, gz); if (solid[v] && !walkVox[v]) return false;
    }
  }
  return true;
};

// BFS depuis la cellule franchissable la plus proche du spawn
let total = 0, pass = 0;
const passSet = new Map(); // key ix|iz|yq -> y
for (const [k, ys] of cells) { const cx = k % nx, cz = Math.floor(k / nx); for (const y of ys) { total++; if (passable(cx, cz, y)) { pass++; passSet.set(`${cx}|${cz}|${Math.round(y/0.35)}`, y); } } }
let start = null, bd = 1e9;
for (const [key, y] of passSet) { const [cx, , ] = key.split("|").map(Number); const czz = Number(key.split("|")[1]);
  const wx = mn[0] + cx * CELL, wz = mn[2] + czz * CELL;
  const d = (wx-spawn[0])**2 + (y-spawn[1])**2 + (wz-spawn[2])**2; if (d < bd) { bd = d; start = key; } }
if (!start) { console.error("aucune cellule franchissable pres du spawn"); process.exit(1); }
// BFS avec SAUT DE TROU : le filet walk est erode aux seuils de portes (ilots par piece) — on autorise
// jusqu'a 4 cellules (1 m) de filet manquant SI la bande d'air 0.5-1.7 m est libre a chaque pas
// intermediaire (une membrane/mur scelle dans la bande REJETTE le saut : pas de traversee de mur).
const seen = new Set([start]); const q = [start];
while (q.length) {
  const key = q.pop(); const [cx, cz] = key.split("|").map(Number); const y = passSet.get(key);
  for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    for (let d = 1; d <= 4; d++) {
      const nkx = cx + dx * d, nkz = cz + dz * d; const ys = cells.get(nkx + nkz * nx);
      if (!ys) continue;
      for (const ny2 of ys) {
        if (Math.abs(ny2 - y) > 0.7) continue;
        const nk = `${nkx}|${nkz}|${Math.round(ny2/0.35)}`;
        if (!passSet.has(nk) || seen.has(nk)) continue;
        let clear = true;
        for (let i = 1; i < d && clear; i++) { const yi = y + ((ny2 - y) * i) / d; if (!passable(cx + dx * i, cz + dz * i, yi)) clear = false; }
        if (!clear) continue;
        seen.add(nk); q.push(nk);
      }
    }
  }
}
const dumpPath = argOpt("dump", null);
if (dumpPath) {
  const { writeFileSync } = await import("node:fs");
  const cellsOut = [...seen].map((key) => { const [cx, cz] = key.split("|").map(Number); const y = passSet.get(key); return [+(mn[0]+cx*CELL).toFixed(2), +y.toFixed(2), +(mn[2]+cz*CELL).toFixed(2)]; });
  writeFileSync(dumpPath, JSON.stringify({ start, spawn, reachable: cellsOut }));
}
const pct = (100 * seen.size / (passSet.size || 1));
console.log(`${srcPath.split(/[\\/]/).pop()} : cellules walk ${total} · franchissables ${pass} (${(100*pass/total).toFixed(0)}%) · ATTEIGNABLES depuis spawn ${seen.size}/${passSet.size} = ${pct.toFixed(1)}%  [seuil ${MIN_PCT}%]`);
if (LIST && pct < MIN_PCT) {
  // frontieres : cellules atteintes adjacentes a du franchissable non-atteint = points de blocage
  const spots = new Map();
  for (const key of seen) { const [cx, cz] = key.split("|").map(Number); const y = passSet.get(key);
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nk2 = `${cx+dx}|${cz+dz}`; const ys = cells.get((cx+dx) + (cz+dz) * nx) || [];
      for (const ny2 of ys) { const nk = `${cx+dx}|${cz+dz}|${Math.round(ny2/0.35)}`; if (passSet.has(nk) && !seen.has(nk)) { const wx = (mn[0]+(cx)*CELL).toFixed(0), wz = (mn[2]+cz*CELL).toFixed(0); spots.set(`${wx},${y.toFixed(0)},${wz}`, 1); } } } }
  console.log("  frontieres de blocage (monde x,y,z) : " + [...spots.keys()].slice(0, 12).join(" | "));
}
process.exit(pct >= MIN_PCT ? 0 : 1);
