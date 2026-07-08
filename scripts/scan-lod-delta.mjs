#!/usr/bin/env node
// scan-lod-delta.mjs — compare les exports BRUTS interieurs LOD1 vs LOD2 des 62 habitables.
//
// Objectifs (demande app, proto lodtest Idris/Carrack/Mauler) :
//   (a) generalisation LOD1 : quels ships gagnent beaucoup d'OBJETS au LOD1 (deltaNodes eleve
//       = cloisons/planchers droppes par le LOD2, cf. Idris +1061) ;
//   (b) interieurs ~vides a gater cote app (EMPTY_INTERIOR) : densite d'objets tres faible pour
//       la taille du vaisseau quel que soit le LOD (cf. Mauler 156 nodes pour 486 m).
// Ecrit lod-delta.json + table triee. Lecture du chunk JSON seulement (pas de gltf-transform).
// Usage : node scripts/scan-lod-delta.mjs [KEY...]   (defaut : les 62 habitables)

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STARBREAKER = "C:/Users/andre/Documents/starbreaker/starbreaker.exe";
const P4K = "D:/Program Files/RSI Launcher/StarCitizen/LIVE/Data.p4k";
const meta = JSON.parse(readFileSync(join(ROOT, "ships.meta.json"), "utf8"));
const kinds = JSON.parse(readFileSync(join(ROOT, "interior-kinds.json"), "utf8")).kinds;

let keys = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!keys.length) keys = Object.entries(kinds).filter(([, v]) => v.kind === "habitable").map(([k]) => k);

// ATTENTION : StarBreaker emet TOUS les nodes a tous les LODs ; au LOD2 ce sont les GEOMETRIES
// qui manquent (prims vides / mesh absent), pas les nodes. Le signal est donc :
//   geomNodes = nodes pointant un mesh ayant >=1 prim non vide (c'est ce que prune() garde).
const glbStats = (path) => {
  const buf = readFileSync(path);
  let off = 12, j = null;
  while (off < buf.length) { const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4), s = off + 8; if (type === 0x4e4f534a) { j = JSON.parse(buf.subarray(s, s + len).toString("utf8")); break; } off = s + len; }
  let t = 0, livePrims = 0; const liveMesh = new Set();
  const meshes = j.meshes ?? [];
  for (let mi = 0; mi < meshes.length; mi++) for (const p of meshes[mi].primitives ?? []) {
    const a = j.accessors[p.indices ?? p.attributes?.POSITION]; const c = a ? a.count : 0;
    const tri = (p.mode ?? 4) === 4 ? Math.floor(c / 3) : Math.max(0, c - 2);
    if (tri > 0) { livePrims++; liveMesh.add(mi); }
    t += tri;
  }
  let geomNodes = 0;
  for (const n of j.nodes ?? []) if (n.mesh != null && liveMesh.has(n.mesh)) geomNodes++;
  return { tris: t, prims: livePrims, geomNodes, nodes: (j.nodes || []).length };
};

const out = {};
const tmp = join(ROOT, "_lod_delta_tmp.glb");
console.log(`scan LOD1 vs LOD2 : ${keys.length} vaisseaux\n`);
for (const key of keys) {
  const rec = { lengthM: meta[key]?.dims?.l ?? null, walkableM2: kinds[key]?.walkableM2 ?? null };
  try {
    for (const lod of [2, 1]) {
      execFileSync(STARBREAKER, ["entity", "export", key, tmp, "--materials", "colors", "--lod", String(lod)], { env: { ...process.env, SC_DATA_P4K: P4K }, stdio: "ignore", timeout: 600000 });
      rec[`lod${lod}`] = glbStats(tmp);
      rmSync(tmp);
    }
    rec.deltaNodes = rec.lod1.geomNodes - rec.lod2.geomNodes;
    rec.trisRatio = +(rec.lod1.tris / Math.max(1, rec.lod2.tris)).toFixed(2);
    rec.densite = rec.lengthM ? +(rec.lod1.geomNodes / rec.lengthM).toFixed(2) : null; // geomNodes/m : tres bas = interieur ~vide
    console.log(`${key.padEnd(30)} L2 ${String(rec.lod2.geomNodes).padStart(5)} g / ${(rec.lod2.tris / 1e6).toFixed(2)}M  ->  L1 ${String(rec.lod1.geomNodes).padStart(5)} g / ${(rec.lod1.tris / 1e6).toFixed(2)}M   ΔN=${String(rec.deltaNodes).padStart(5)}  dens=${rec.densite}`);
  } catch (e) {
    rec.err = e.message.split("\n")[0];
    console.log(`${key.padEnd(30)} ECHEC : ${rec.err}`);
    if (existsSync(tmp)) rmSync(tmp);
  }
  out[key] = rec;
}
writeFileSync(join(ROOT, "lod-delta.json"), JSON.stringify(out, null, 1));

const ok = Object.entries(out).filter(([, r]) => !r.err);
console.log(`\n=== TOP delta nodes (candidats LOD1) ===`);
for (const [k, r] of ok.slice().sort((a, b) => b[1].deltaNodes - a[1].deltaNodes).slice(0, 20)) console.log(`  ${k.padEnd(30)} ΔN=${r.deltaNodes}  (${r.lod2.geomNodes} -> ${r.lod1.geomNodes})  x${r.trisRatio} tris`);
console.log(`\n=== Densite la plus faible (candidats gate EMPTY_INTERIOR) ===`);
for (const [k, r] of ok.filter(([, r]) => r.densite != null).sort((a, b) => a[1].densite - b[1].densite).slice(0, 15)) console.log(`  ${k.padEnd(30)} dens=${r.densite} geomNodes/m  (${r.lod1.geomNodes} noeuds geom, ${r.lengthM} m, walkable ${r.walkableM2} m²)`);
console.log(`\nlod-delta.json ecrit (${ok.length}/${keys.length} OK)`);
