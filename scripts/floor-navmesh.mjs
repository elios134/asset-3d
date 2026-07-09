#!/usr/bin/env node
// floor-navmesh.mjs — generateur de PLANCHER par FLOOD CAPSULE 3D (qualite navmesh).
//
// POURQUOI : generate-floor.mjs est une heuristique de GRILLE 2D (une hauteur plancher par cellule,
// validee par un test de PLAFOND). Elle ne peut STRUCTURELLEMENT pas capter les escaliers : une cage
// d'escalier est ouverte -> pas de plafond plat dans [L+CLEAR, L+CEIL_MAX] -> les marches sont jetees
// -> les ponts d'un capital haut (Javelin 8 ponts) restent DECONNECTES (mesure : --multi-deck plafonne
// a 16% atteignables depuis spawn ; --spawn-largest 1.9%).
//
// PRINCIPE (qualite navmesh) : on VOXELISE la vraie geometrie de collision interieure (0.25 m), on
// identifie les surfaces ou une capsule joueur TIENT DEBOUT (bande d'air libre au-dessus du pied), puis
// on FLOOD-FILL depuis le spawn en autorisant les marches <= STEP par pas lateral. On emet le sol
// UNIQUEMENT aux voxels ATTEINTS -> plancher CONNECTE PAR CONSTRUCTION (verify-walk ~100% garanti) ;
// escaliers/rampes captes (le flood grimpe) ; toit / coque ouverte / soutes scellees jamais emis (non
// atteints). Meme reachability que la capsule in-game (memes rayons) -> pas de divergence heuristique.
// Sortie IDENTIQUE a generate-floor : collision_walk + floor_patch + spawn_point (app inchangee).
//
// usage: node scripts/floor-navmesh.mjs <in-interior.glb> <out-floor.glb> --spawn-hint=x,y,z
//        [--cell=0.25] [--cell-out=0.5] [--step=0.5] [--capsule=0.3] [--lift=0.1]
//        [--clear-lo=0.3] [--clear-hi=1.7] [--jump=4] [--no-patch] [--dump=reach.json]

import { NodeIO, Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dequantize } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

const argv = process.argv.slice(2);
const inPath = argv[0], outPath = argv[1];
const optS = (k, d) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const optN = (k, d) => { const v = optS(k, null); return v == null ? d : parseFloat(v); };
const CELL = optN("cell", 0.25);        // resolution du flood (fine = escaliers precis)
const CELL_OUT = optN("cell-out", 0.5); // resolution des quads emis (0.5 = taille comparable a generate-floor)
const STEP = optN("step", 0.45);        // (retro) marche symetrique si --step-up/--drop absents
const STEP_UP = optN("step-up", STEP);  // MONTEE max par pas (marche grimpable capsule). Trop haut => corniche => le joueur ne monte pas.
const STEP_DOWN = optN("drop", STEP);   // DESCENTE max par pas. Defaut = STEP_UP (symetrique = SUR : tout lien est bidirectionnel, pas de joueur coince). Monter --drop pour capter les sauts vers le bas (asymetrique).
const CAPSULE_R = optN("capsule", 0.3); // rayon capsule joueur (m)
const LIFT = optN("lift", 0.1);         // le pied = haut du voxel solide ; on remonte un peu au niveau de marche
const CLEAR_LO = optN("clear-lo", 0.3); // bas de la bande d'air (au-dessus du pied)
const CLEAR_HI = optN("clear-hi", 1.7); // haut de la bande d'air (hauteur capsule effective)
const JUMP = Math.round(optN("jump", 4)); // saut de trou max (cellules) : traverse les seuils erodes
const YQ = 0.35;                        // quantum vertical pour distinguer les ponts (deux niveaux < YQ = meme surface)

const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const ap = (m, x, y, z) => [m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]];

// collecte les prims solides (obstacles) : tout SAUF coque (occluder_shell), portes/hatches (retirees ->
// passages ouverts), et les couches deja generees (collision_walk/floor_patch/spawn_point).
function collectSolid(doc) {
  const out = [];
  for (const scene of doc.getRoot().listScenes()) {
    const st = scene.listChildren().map((n) => [n, [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]]);
    while (st.length) {
      const [node, pm] = st.pop();
      const wm = mul(pm, node.getMatrix());
      const nm = node.getName() || "";
      const mesh = node.getMesh();
      const isExcluded = (s) => /occluder_shell|collision_walk|floor_patch|spawn_point|door|hatch/i.test(s);
      if (mesh && !isExcluded(nm) && !isExcluded(mesh.getName() || "")) for (const pr of mesh.listPrimitives()) {
        const pos = pr.getAttribute("POSITION"); if (!pos) continue;
        out.push({ wm, pos: pos.getArray(), idx: pr.getIndices()?.getArray() ?? null });
      }
      for (const c of node.listChildren()) st.push([c, wm]);
    }
  }
  return out;
}
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

const doc = await io.read(inPath);
await doc.transform(dequantize());
const solidTris = worldTris(collectSolid(doc));
if (!solidTris.length) { console.error("aucune geometrie solide (interieur vide ?)"); process.exit(2); }

// bbox monde (+ marge) -> grille voxel
let mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
for (let i = 0; i < solidTris.length; i += 3) for (let k = 0; k < 3; k++) { if (solidTris[i+k] < mn[k]) mn[k] = solidTris[i+k]; if (solidTris[i+k] > mx[k]) mx[k] = solidTris[i+k]; }
for (let k = 0; k < 3; k++) { mn[k] -= 1; mx[k] += 1; }
const nx = Math.ceil((mx[0]-mn[0])/CELL), ny = Math.ceil((mx[1]-mn[1])/CELL), nz = Math.ceil((mx[2]-mn[2])/CELL);
const solid = new Uint8Array(nx * ny * nz);
const vid = (x, y, z) => x + nx * (z + nz * y);
const ix = (v) => Math.floor((v - mn[0]) / CELL);
const iy = (v) => Math.floor((v - mn[1]) / CELL);
const iz = (v) => Math.floor((v - mn[2]) / CELL);
const inb = (x, y, z) => x >= 0 && x < nx && y >= 0 && y < ny && z >= 0 && z < nz;
console.log(`grille ${nx}x${ny}x${nz} = ${(nx*ny*nz/1e6).toFixed(1)}M voxels · ${(solidTris.length/9|0)} tris solides`);

// voxelisation par echantillonnage barycentrique de surface (comme verify-walk : pas d'AABB conservatif)
{
  const STEP_S = CELL * 0.45;
  for (let t = 0; t < solidTris.length; t += 9) {
    const ax = solidTris[t], ay = solidTris[t+1], az = solidTris[t+2], bx = solidTris[t+3], by = solidTris[t+4], bz = solidTris[t+5], cx = solidTris[t+6], cy = solidTris[t+7], cz = solidTris[t+8];
    const e1 = Math.hypot(bx-ax, by-ay, bz-az), e2 = Math.hypot(cx-ax, cy-ay, cz-az);
    const nu = Math.max(1, Math.ceil(e1 / STEP_S)), nv = Math.max(1, Math.ceil(e2 / STEP_S));
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv - Math.floor(i * nv / nu); j++) {
      const u = i / nu, v = j / nv; if (u + v > 1.0001) continue;
      const px = ax + u*(bx-ax) + v*(cx-ax), py = ay + u*(by-ay) + v*(cy-ay), pz = az + u*(bz-az) + v*(cz-az);
      const gx = ix(px), gy = iy(py), gz = iz(pz);
      if (inb(gx, gy, gz)) solid[vid(gx, gy, gz)] = 1;
    }
  }
}

// candidats "surface de station debout" : voxel solide dont le voxel du dessus est libre (= haut de pile).
// pied monde = haut du voxel solide. On stocke par colonne (ix,iz) la liste des Y-pied candidats.
const CLEAR_HI_VOX = Math.ceil(CLEAR_HI / CELL);
const cols = new Map(); // ix + iz*nx -> [footY,...]
for (let gz = 0; gz < nz; gz++) for (let gx = 0; gx < nx; gx++) {
  let list = null;
  for (let gy = 0; gy < ny - 1; gy++) {
    if (solid[vid(gx, gy, gz)] && !solid[vid(gx, gy + 1, gz)]) {
      const footY = mn[1] + (gy + 1) * CELL; // haut du voxel solide
      if (!list) { list = []; cols.set(gx + gz * nx, list); }
      list.push(footY);
    }
  }
}

// capsule debout : disque de rayon CAPSULE_R, bande [CLEAR_LO, CLEAR_HI] au-dessus du pied, sans solide.
const RC = Math.max(0, Math.round(CAPSULE_R / CELL));
const standing = (gx, gz, footY) => {
  for (let h = CLEAR_LO; h <= CLEAR_HI + 1e-6; h += CELL) {
    const gy = iy(footY + h);
    for (let dx = -RC; dx <= RC; dx++) for (let dz = -RC; dz <= RC; dz++) {
      if (dx*dx + dz*dz > RC*RC) continue;
      const x = gx + dx, z = gz + dz; if (x < 0 || x >= nx || z < 0 || z >= nz || gy < 0 || gy >= ny) continue;
      if (solid[vid(x, gy, z)]) return false;
    }
  }
  return true;
};

// ensemble des candidats DEBOUT : key ix|iz|round(footY/YQ) -> footY
const stand = new Map();
for (const [k, ys] of cols) { const gx = k % nx, gz = (k / nx) | 0; for (const fy of ys) if (standing(gx, gz, fy)) stand.set(`${gx}|${gz}|${Math.round(fy / YQ)}`, fy); }
console.log(`candidats debout : ${stand.size}`);

// seed : indice spawn-hint (x,y,z du siege). On snappe au candidat le plus proche (privilegie meme colonne,
// puis Y le plus proche du hint). Sinon fallback : plus grande composante (part de chaque candidat non visite).
const hintA = argv.find((x) => x.startsWith("--spawn-hint="));
const hint = hintA ? hintA.split("=")[1].split(",").map(Number) : null;
const worldFoot = (key) => { const [gx, gz] = key.split("|").map(Number); return [mn[0] + gx*CELL + CELL/2, stand.get(key), mn[2] + gz*CELL + CELL/2]; };
let seed = null;
if (hint && hint.length >= 3 && hint.every(isFinite)) {
  let bd = 1e18;
  for (const key of stand.keys()) { const [wx, wy, wz] = worldFoot(key);
    // pondere Y fort : a une meme colonne XZ, la passerelle (haut) et le pont bas coexistent ; le hint Y desambigue
    const d = (wx-hint[0])**2 + 3*(wy-hint[1])**2 + (wz-hint[2])**2; if (d < bd) { bd = d; seed = key; } }
  if (seed) { const [wx, wy, wz] = worldFoot(seed); console.log(`seed (hint 3D -> candidat @ ${wx.toFixed(1)},${wy.toFixed(1)},${wz.toFixed(1)}, dist ${Math.sqrt(bd).toFixed(2)}m)`); }
}

// FLOOD BFS sur les candidats debout. Directions 4 ; saut de trou d=1..JUMP (seuils de portes erodes) avec
// passabilite intermediaire ; marche |ΔfootY| <= STEP par HOP (grimpe escaliers/rampes). Connecte PAR
// construction : tout candidat atteint est joignable a la capsule depuis le seed.
const floodFrom = (startKey, visited) => {
  const s = new Set([startKey]); const q = [startKey];
  while (q.length) {
    const key = q.pop(); const [cx, cz] = key.split("|").map(Number); const y = stand.get(key);
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      for (let d = 1; d <= JUMP; d++) {
        const nkx = cx + dx*d, nkz = cz + dz*d, ck = nkx + nkz*nx;
        const ys = cols.get(ck); if (!ys) continue;
        for (const ny2 of ys) {
          const nk = `${nkx}|${nkz}|${Math.round(ny2 / YQ)}`;
          if (!stand.has(nk) || s.has(nk)) continue;
          const dyv = ny2 - y;                    // marche franchissable (montee/descente asymetriques)
          if (dyv > STEP_UP || -dyv > STEP_DOWN) continue;
          let ok = true; // passabilite intermediaire (le saut ne traverse pas un mur)
          for (let i = 1; i < d && ok; i++) { const yi = y + ((ny2 - y) * i) / d; if (!standing(cx + dx*i, cz + dz*i, yi)) ok = false; }
          if (!ok) continue;
          s.add(nk); q.push(nk); if (visited) visited.add(nk);
        }
      }
    }
  }
  return s;
};

let reached, seedKey = seed;
if (seed) reached = floodFrom(seed);
else {
  // fallback sans hint : plus grande composante connexe (le seed = son point de depart, garde pour spawn)
  const visited = new Set(); let best = new Set(), bestStart = null;
  for (const k of stand.keys()) { if (visited.has(k)) continue; visited.add(k); const comp = floodFrom(k, visited); if (comp.size > best.size) { best = comp; bestStart = k; } }
  reached = best; seedKey = bestStart;
  if (seedKey) { const [wx, wy, wz] = worldFoot(seedKey); console.log(`seed (fallback + grande composante @ ${wx.toFixed(1)},${wy.toFixed(1)},${wz.toFixed(1)})`); }
}
console.log(`atteints depuis seed : ${reached.size}/${stand.size} candidats debout (${(100*reached.size/stand.size).toFixed(1)}%)`);

// DUMP diagnostic (points monde atteints)
const dumpA = argv.find((x) => x.startsWith("--dump="));
if (dumpA) { const { writeFileSync } = await import("node:fs"); writeFileSync(dumpA.split("=")[1], JSON.stringify({ seed: seedKey ? worldFoot(seedKey) : null, reached: [...reached].map(worldFoot) })); }

// DOWNSAMPLE emission : les voxels atteints (fins) -> une nappe par cellule de sortie CELL_OUT et par
// niveau de pont (bucket YQ). footY median du groupe. Taille comparable a generate-floor tout en gardant
// la connectivite du flood fin.
const outCells = new Map(); // ox|oz|yb -> [footY,...]
for (const key of reached) {
  const [wx, wy, wz] = worldFoot(key);
  const ox = Math.floor(wx / CELL_OUT), oz = Math.floor(wz / CELL_OUT), yb = Math.round(wy / YQ);
  const ok = `${ox}|${oz}|${yb}`; let arr = outCells.get(ok); if (!arr) outCells.set(ok, arr = []); arr.push(wy);
}
const quads = [];
for (const [ok, ys] of outCells) { const [ox, oz] = ok.split("|").map(Number); ys.sort((a, b) => a - b); quads.push([ox, oz, ys[ys.length >> 1]]); }

// ecrit le GLB plancher (collision_walk + floor_patch + spawn_point) — format identique a generate-floor
const out = new Document();
const scene = out.createScene();
if (quads.length > 0) {
  const positions = [], normals = [], indices = []; let vi = 0;
  for (const [ox, oz, h] of quads) {
    const y = h + LIFT, x0 = ox*CELL_OUT, z0 = oz*CELL_OUT, x1 = x0 + CELL_OUT, z1 = z0 + CELL_OUT;
    positions.push(x0,y,z0, x1,y,z0, x1,y,z1, x0,y,z1);
    normals.push(0,1,0, 0,1,0, 0,1,0, 0,1,0);
    indices.push(vi, vi+2, vi+1, vi, vi+3, vi+2); vi += 4;
  }
  const buf = out.createBuffer();
  const acc = out.createAccessor("floorPos").setType("VEC3").setArray(new Float32Array(positions)).setBuffer(buf);
  const nrm = out.createAccessor("floorNrm").setType("VEC3").setArray(new Float32Array(normals)).setBuffer(buf);
  const idx = out.createAccessor("floorIdx").setType("SCALAR").setArray(new Uint32Array(indices)).setBuffer(buf);
  const mat = out.createMaterial("floor_mat").setBaseColorFactor([0.37, 0.4, 0.44, 1]).setRoughnessFactor(1).setMetallicFactor(0).setDoubleSided(true);
  const prim = out.createPrimitive().setAttribute("POSITION", acc).setAttribute("NORMAL", nrm).setIndices(idx).setMaterial(mat);
  scene.addChild(out.createNode("collision_walk").setMesh(out.createMesh("collision_walk").addPrimitive(prim)));

  if (!argv.includes("--no-patch")) {
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
  // spawn_point : position du seed (hint 3D snappe au sol reel, ou depart de la grande composante en fallback)
  const sp = seedKey ? worldFoot(seedKey) : (hint && hint.length >= 3 ? hint : null);
  if (sp) scene.addChild(out.createNode("spawn_point").setTranslation([sp[0], sp[1] + LIFT, sp[2]]));
}
await io.write(outPath, out);
const areaM2 = (quads.length * CELL_OUT * CELL_OUT).toFixed(0);
console.log(`plancher navmesh : ${quads.length} cellules -> ${areaM2} m2 · ${quads.length*4} verts · CELL=${CELL} CELL_OUT=${CELL_OUT} STEP=${STEP}`);
