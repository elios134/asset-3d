#!/usr/bin/env node
// scan-detailed-qa.mjs — QA de l'export DETAILLE (avec attachments) par rapport a la silhouette.
//
// Le bug StarBreaker deplace des sections entieres sur certains vaisseaux (350r : nez/portes/verriere
// a +10-17m). Critere : un vaisseau est SAIN si aucun mesh du detaille ne deborde de la coque
// silhouette (models/<key>.exterior.glb) de plus de max(3m, 6% de la longueur). Les vaisseaux sains
// pourront passer en vue detaillee ; les casses restent en silhouette.
//
// Sortie : detailed-qa.json { clean:[], broken:[{key,worst,offenders}] } + resume.
// Usage : node scripts/scan-detailed-qa.mjs KEY1 KEY2 ...   ou   --all [--max=N]

import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { getBounds } from "@gltf-transform/functions";
import { MeshoptDecoder } from "meshoptimizer";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = join(ROOT, "models");
const STARBREAKER = "C:/Users/andre/Documents/starbreaker/starbreaker.exe";
const P4K = "D:/Program Files/RSI Launcher/StarCitizen/LIVE/Data.p4k";
const meta = JSON.parse(readFileSync(join(ROOT, "ships.meta.json"), "utf8"));
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ "meshopt.decoder": MeshoptDecoder });

const maxArg = process.argv.find((a) => a.startsWith("--max="));
let keys = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (process.argv.includes("--all")) {
  const EXCLUDE = /\bwikelo\b|\bpyam\b|best in show|\bbis\d*\b|\bexecutive\b|\bexec\b/;
  keys = Object.keys(meta).filter((k) => k !== "_comment" && !EXCLUDE.test(`${meta[k]?.name ?? ""} ${k}`.replace(/_/g, " ").toLowerCase()) && existsSync(join(MODELS, `${k}.exterior.glb`)));
  if (maxArg) keys = keys.slice(0, parseInt(maxArg.split("=")[1]));
}

const lm = (n) => { if (n.matrix) return n.matrix.slice(); const t = n.translation || [0, 0, 0], r = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1]; const [x, y, z, w] = r, x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2, [sx, sy, sz] = s; return [(1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0, (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0, (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0, t[0], t[1], t[2], 1]; };
const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };

const out = { clean: [], broken: [], failed: [] };
let i = 0;
for (const key of keys) {
  i++;
  const tmp = join(tmpdir(), `qa_det_${key}.glb`);
  try {
    const hull = getBounds((await io.read(join(MODELS, `${key}.exterior.glb`))).getRoot().listScenes()[0]);
    execFileSync(STARBREAKER, ["entity", "export", key, tmp, "--materials", "colors", "--no-interior", "--lod", "3"], { env: { ...process.env, SC_DATA_P4K: P4K }, stdio: "ignore", timeout: 300000 });
    const buf = readFileSync(tmp);
    let off = 12, json = null;
    while (off < buf.length) { const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4), s = off + 8; if (type === 0x4e4f534a) { json = JSON.parse(buf.subarray(s, s + len).toString("utf8")); break; } off = s + len; }
    const nodes = json.nodes || [], meshes = json.meshes || [], acc = json.accessors || [];
    const parent = new Array(nodes.length).fill(-1); nodes.forEach((n, idx) => (n.children || []).forEach((c) => (parent[c] = idx)));
    const wm = (idx) => { let m = lm(nodes[idx]), p = parent[idx]; while (p !== -1) { m = mul(lm(nodes[p]), m); p = parent[p]; } return m; };
    const L = meta[key]?.dims?.l ?? 25, TH = Math.max(3, 0.06 * L);
    let worst = 0; const offenders = [];
    nodes.forEach((n, idx) => {
      if (n.mesh == null) return;
      const M = wm(idx);
      let xn = 1 / 0, yn = 1 / 0, zn = 1 / 0, xx = -1 / 0, yx = -1 / 0, zx = -1 / 0;
      for (const p of meshes[n.mesh].primitives || []) {
        const a = acc[p.attributes?.POSITION]; if (!a?.min) continue;
        const [x0, y0, z0] = a.min, [x1, y1, z1] = a.max;
        for (const c of [[x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x0, y0, z1], [x1, y1, z0], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1]]) {
          const px = M[0] * c[0] + M[4] * c[1] + M[8] * c[2] + M[12], py = M[1] * c[0] + M[5] * c[1] + M[9] * c[2] + M[13], pz = M[2] * c[0] + M[6] * c[1] + M[10] * c[2] + M[14];
          xn = Math.min(xn, px); yn = Math.min(yn, py); zn = Math.min(zn, pz); xx = Math.max(xx, px); yx = Math.max(yx, py); zx = Math.max(zx, pz);
        }
      }
      if (!isFinite(xn)) return;
      const over = Math.max(hull.min[0] - xn, xx - hull.max[0], hull.min[1] - yn, yx - hull.max[1], hull.min[2] - zn, zx - hull.max[2]);
      if (over > worst) worst = over;
      if (over > TH) offenders.push({ name: n.name || "(anon)", over: +over.toFixed(1) });
    });
    const clean = offenders.length === 0;
    out[clean ? "clean" : "broken"].push(clean ? { key, worst: +worst.toFixed(1) } : { key, worst: +worst.toFixed(1), th: +TH.toFixed(1), offenders: offenders.slice(0, 8) });
    console.log(`  [${i}/${keys.length}] ${clean ? "✓ SAIN " : "✗ CASSE"} ${key.padEnd(30)} worst=${worst.toFixed(1)}m (seuil ${TH.toFixed(1)}m)${clean ? "" : ` — ${offenders.length} mesh(es) hors coque`}`);
  } catch (e) {
    out.failed.push({ key, err: e.message.split("\n")[0] });
    console.log(`  [${i}/${keys.length}] ⚠ ${key} : ${e.message.split("\n")[0]}`);
  } finally { if (existsSync(tmp)) rmSync(tmp); }
}
writeFileSync(join(ROOT, "detailed-qa.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`\n=== RESUME : ${out.clean.length} sains / ${out.broken.length} casses / ${out.failed.length} echecs ===`);
