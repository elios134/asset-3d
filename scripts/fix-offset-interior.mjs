#!/usr/bin/env node
// fix-offset-interior.mjs — recale un interieur MONO-MODULE decale en masse.
//
// Pour un vaisseau dont l'unique module (interior_base_int_*_main) est translate en bloc hors de la
// coque (transform casse), on aligne le CENTRE de bbox du module sur le CENTRE de bbox de la coque
// (variante exterior). Heuristique valable quand l'interieur = 1 seul module (il remplit la coque).
// NE PAS utiliser sur un interieur multi-modules (les modules se piletaient).
//
// Bounds via gltf-transform (decode meshopt) ; edition de la matrice du noeud via surgery JSON
// (le chunk BIN meshopt est preserve tel quel). Ecrit en place.
//
// Usage : node scripts/fix-offset-interior.mjs KEY1 KEY2 ...

import { NodeIO, getBounds } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = join(ROOT, "models");
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ "meshopt.decoder": MeshoptDecoder });

for (const key of process.argv.slice(2)) {
  // 1) bounds via gltf-transform
  const ext = await io.read(join(MODELS, `${key}.exterior.glb`));
  const hull = getBounds(ext.getRoot().listScenes()[0]);
  const hullC = [(hull.min[0] + hull.max[0]) / 2, (hull.min[1] + hull.max[1]) / 2, (hull.min[2] + hull.max[2]) / 2];
  const intDoc = await io.read(join(MODELS, `${key}.interior.glb`));
  const mods = intDoc.getRoot().listNodes().filter((n) => /^interior_base_int_.+_main$/i.test(n.getName() || ""));
  if (mods.length !== 1) { console.log(`  ⚠ ${key} : ${mods.length} modules (attendu 1) — saute (multi-module => methode inadaptee)`); continue; }
  const mb = getBounds(mods[0]);
  const modC = [(mb.min[0] + mb.max[0]) / 2, (mb.min[1] + mb.max[1]) / 2, (mb.min[2] + mb.max[2]) / 2];
  const delta = [hullC[0] - modC[0], hullC[1] - modC[1], hullC[2] - modC[2]];
  const moduleName = mods[0].getName();

  // 2) surgery JSON du .glb interieur (BIN meshopt preserve)
  const path = join(MODELS, `${key}.interior.glb`);
  const buf = readFileSync(path);
  let off = 12, jsonBytes = null, binBytes = null;
  while (off < buf.length) { const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4), s = off + 8; if (type === 0x4e4f534a) jsonBytes = buf.subarray(s, s + len); else if (type === 0x004e4942) binBytes = buf.subarray(s, s + len); off = s + len; }
  const json = JSON.parse(jsonBytes.toString("utf8"));
  const nodes = json.nodes ?? [];
  const parent = new Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (parent[c] = i)));
  const lm = (n) => { if (n.matrix) return n.matrix.slice(); const t = n.translation ?? [0, 0, 0], r = n.rotation ?? [0, 0, 0, 1], s = n.scale ?? [1, 1, 1]; const [x, y, z, w] = r, x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2, [sx, sy, sz] = s; return [(1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0, (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0, (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0, t[0], t[1], t[2], 1]; };
  const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
  const wm = (i) => { let m = lm(nodes[i]), p = parent[i]; while (p !== -1) { m = mul(lm(nodes[p]), m); p = parent[p]; } return m; };
  const inv = (m) => { const a = m, b = new Array(16); const s0 = a[0] * a[5] - a[1] * a[4], s1 = a[0] * a[6] - a[2] * a[4], s2 = a[0] * a[7] - a[3] * a[4], s3 = a[1] * a[6] - a[2] * a[5], s4 = a[1] * a[7] - a[3] * a[5], s5 = a[2] * a[7] - a[3] * a[6]; const c5 = a[10] * a[15] - a[11] * a[14], c4 = a[9] * a[15] - a[11] * a[13], c3 = a[9] * a[14] - a[10] * a[13], c2 = a[8] * a[15] - a[11] * a[12], c1 = a[8] * a[14] - a[10] * a[12], c0 = a[8] * a[13] - a[9] * a[12]; let d = s0 * c5 - s1 * c4 + s2 * c3 + s3 * c2 - s4 * c1 + s5 * c0; d = 1 / d; b[0] = (a[5] * c5 - a[6] * c4 + a[7] * c3) * d; b[1] = (-a[1] * c5 + a[2] * c4 - a[3] * c3) * d; b[2] = (a[13] * s5 - a[14] * s4 + a[15] * s3) * d; b[3] = (-a[9] * s5 + a[10] * s4 - a[11] * s3) * d; b[4] = (-a[4] * c5 + a[6] * c2 - a[7] * c1) * d; b[5] = (a[0] * c5 - a[2] * c2 + a[3] * c1) * d; b[6] = (-a[12] * s5 + a[14] * s2 - a[15] * s1) * d; b[7] = (a[8] * s5 - a[10] * s2 + a[11] * s1) * d; b[8] = (a[4] * c4 - a[5] * c2 + a[7] * c0) * d; b[9] = (-a[0] * c4 + a[1] * c2 - a[3] * c0) * d; b[10] = (a[12] * s4 - a[13] * s2 + a[15] * s0) * d; b[11] = (-a[8] * s4 + a[9] * s2 - a[11] * s0) * d; b[12] = (-a[4] * c3 + a[5] * c1 - a[6] * c0) * d; b[13] = (a[0] * c3 - a[1] * c1 + a[2] * c0) * d; b[14] = (-a[12] * s3 + a[13] * s1 - a[14] * s0) * d; b[15] = (a[8] * s3 - a[9] * s1 + a[10] * s0) * d; return b; };
  const T = (dx, dy, dz) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, dx, dy, dz, 1];

  const mi = nodes.findIndex((n) => (n.name || "") === moduleName);
  const pW = parent[mi] === -1 ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] : wm(parent[mi]);
  const newLocal = mul(inv(pW), mul(T(...delta), mul(pW, lm(nodes[mi]))));
  delete nodes[mi].translation; delete nodes[mi].rotation; delete nodes[mi].scale;
  nodes[mi].matrix = newLocal.map((v) => Math.abs(v) < 1e-9 ? 0 : v);

  const nj = Buffer.from(JSON.stringify(json), "utf8");
  const jc = Buffer.concat([nj, Buffer.alloc((4 - (nj.length % 4)) % 4, 0x20)]);
  const bc = Buffer.concat([binBytes, Buffer.alloc((4 - (binBytes.length % 4)) % 4, 0)]);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + jc.length + 8 + bc.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jc.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bc.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  writeFileSync(path, Buffer.concat([head, jh, jc, bh, bc]));
  console.log(`  ✓ ${key.padEnd(28)} ${moduleName} recentré, delta (${delta.map((v) => v.toFixed(1)).join(", ")})`);
}
