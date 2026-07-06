#!/usr/bin/env node
// build-hd.mjs — pipeline HD complet par vaisseau (texture WebP + shell occulteur).
//
// EXTERIEUR (silhouette texturee) : export --materials textures --no-attachments -> dedup + webp512 + meshopt.
// INTERIEUR : export --materials textures -> reposition (si table d'ancrage) -> cull strays -> dedup + webp1024
//   + meshopt -> FUSION de la silhouette exterieure (shell occulteur : les trous montrent la coque, pas les etoiles).
//
// Ecrit models/<key>.exterior.glb et models/<key>.interior.glb (remplace le flat). Robuste aux echecs.
// Usage : node scripts/build-hd.mjs [KEY...]      (defaut : batch test de 8 varies)
//         node scripts/build-hd.mjs --all

import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, prune, textureCompress, meshopt, mergeDocuments, unpartition, getBounds } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync, rmSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = join(ROOT, "models");
const STARBREAKER = "C:/Users/andre/Documents/starbreaker/starbreaker.exe";
const P4K = "D:/Program Files/RSI Launcher/StarCitizen/LIVE/Data.p4k";
const meta = JSON.parse(readFileSync(join(ROOT, "ships.meta.json"), "utf8"));
const anchored = new Set(Object.keys(JSON.parse(readFileSync(join(ROOT, "interior-anchors.json"), "utf8"))).filter((k) => k !== "_comment"));
const EXCLUDE = /\bwikelo\b|\bpyam\b|best in show|\bbis\d*\b|\bexecutive\b|\bexec\b/;
const isExcluded = (k) => EXCLUDE.test(`${meta[k]?.name ?? ""} ${k}`.replace(/_/g, " ").toLowerCase());
const GENERIC = /^(box|cube|plane|cylinder|sphere|cone|circle|icosphere|object|empty)[._]?\d+$/i;
const extLod = (l) => (l >= 100 ? 3 : 2);
const intLod = (l) => (l >= 70 ? 3 : l >= 30 ? 2 : 1);

const keys = Object.keys(meta).filter((k) => k !== "_comment" && !isExcluded(k) && meta[k].dims?.l);
let batch;
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (process.argv.includes("--all")) batch = keys;
else if (args.length) batch = args;
else { const s = keys.slice().sort((a, b) => meta[a].dims.l - meta[b].dims.l); batch = [...new Set(Array.from({ length: 8 }, (_, i) => s[Math.floor(i * (s.length - 1) / 7)]))]; }

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
const exp = (key, out, extra) => execFileSync(STARBREAKER, ["entity", "export", key, out, "--materials", "textures", "--mip", "4", ...extra], { env: { ...process.env, SC_DATA_P4K: P4K }, stdio: "ignore", timeout: 300000 });
const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const ap = (m, x, y, z) => [m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]];

const results = [];
console.log(`Pipeline HD : ${batch.length} vaisseaux\n`);
for (const key of batch) {
  const m = meta[key], l = m.dims.l;
  const extOut = join(MODELS, `${key}.exterior.glb`), intOut = join(MODELS, `${key}.interior.glb`);
  const tmpExt = join(MODELS, `_hd_${key}_ext.glb`), tmpInt = join(MODELS, `_hd_${key}_int.glb`);
  try {
    // 1) EXTERIEUR silhouette texturee
    exp(key, tmpExt, ["--no-interior", "--no-attachments", "--lod", String(extLod(l))]);
    const extDoc = await io.read(tmpExt);
    await extDoc.transform(dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [512, 512], quality: 80 }), meshopt({ encoder: MeshoptEncoder, level: "high" }));
    await io.write(extOut, extDoc);
    const hull = getBounds(extDoc.getRoot().listScenes()[0]);

    // 2) INTERIEUR texture -> reposition (si ancre) -> cull strays -> webp -> shell
    exp(key, tmpInt, ["--lod", String(intLod(l))]);
    let intPath = tmpInt;
    if (anchored.has(key)) { const fx = tmpInt.replace(/\.glb$/, ".fixed.glb"); execFileSync("node", ["scripts/reposition-interior.mjs", tmpInt, fx], { cwd: ROOT, stdio: "ignore" }); intPath = fx; }
    const intDoc = await io.read(intPath);
    // cull strays (generique/anonyme, loin hors coque) — bbox manuelle cycle-safe
    const nodes = intDoc.getRoot().listNodes(); const pm = new Map(); for (const n of nodes) for (const c of n.listChildren()) pm.set(c, n);
    const wm = (n) => { let mm = n.getMatrix(), p = pm.get(n), seen = new Set([n]), d = 0; while (p && !seen.has(p) && d < 200) { mm = mul(p.getMatrix(), mm); seen.add(p); p = pm.get(p); d++; } return mm; };
    for (const node of nodes) { const mesh = node.getMesh(); if (!mesh) continue; let xn=1/0,yn=1/0,zn=1/0,xx=-1/0,yx=-1/0,zx=-1/0; for (const pr of mesh.listPrimitives()) { const a = pr.getAttribute("POSITION"); if (!a) continue; const mn = a.getMinNormalized([]), mx = a.getMaxNormalized([]); if (!mn) continue; const M = wm(node); for (const c of [[mn[0],mn[1],mn[2]],[mx[0],mx[1],mx[2]],[mn[0],mx[1],mn[2]],[mx[0],mn[1],mx[2]]]) { const w = ap(M, ...c); xn=Math.min(xn,w[0]);yn=Math.min(yn,w[1]);zn=Math.min(zn,w[2]);xx=Math.max(xx,w[0]);yx=Math.max(yx,w[1]);zx=Math.max(zx,w[2]); } } if (!isFinite(xn)) continue; const over = Math.max(hull.min[0]-xx, xn-hull.max[0], hull.min[1]-yx, yn-hull.max[1], hull.min[2]-zx, zn-hull.max[2]); const nm = node.getName() || ""; if (over > 10 && (!nm || /^[?]/.test(nm) || GENERIC.test(nm))) node.dispose(); }
    await intDoc.transform(dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 80 }), meshopt({ encoder: MeshoptEncoder, level: "high" }));
    // shell occulteur : fusionner la silhouette exterieure
    const shellDoc = await io.read(extOut);
    mergeDocuments(intDoc, shellDoc);
    const r = intDoc.getRoot(); const scenes = r.listScenes(); const def = r.getDefaultScene() || scenes[0];
    for (const sc of scenes) { if (sc === def) continue; for (const n of sc.listChildren()) def.addChild(n); sc.dispose(); }
    await intDoc.transform(unpartition(), meshopt({ encoder: MeshoptEncoder, level: "high" }));
    await io.write(intOut, intDoc);

    for (const f of [tmpExt, tmpInt, tmpInt.replace(/\.glb$/, ".fixed.glb")]) if (existsSync(f)) rmSync(f);
    results.push({ key, ok: true, ext: statSync(extOut).size, int: statSync(intOut).size });
    console.log(`  ✓ ${key.padEnd(28)} ext ${mb(statSync(extOut).size)} · int ${mb(statSync(intOut).size)} ${anchored.has(key) ? "(reposition)" : ""}`);
  } catch (e) {
    for (const f of [tmpExt, tmpInt, tmpInt.replace(/\.glb$/, ".fixed.glb")]) if (existsSync(f)) rmSync(f);
    results.push({ key, ok: false, err: e.message.split("\n")[0] });
    console.log(`  ✗ ${key.padEnd(28)} ECHEC : ${e.message.split("\n")[0]}`);
  }
}
const ok = results.filter((r) => r.ok);
const tot = ok.reduce((s, r) => s + r.ext + r.int, 0);
console.log(`\n${ok.length}/${results.length} OK. Total HD : ${mb(tot)} (moy ${mb(tot / (ok.length || 1))}/vaisseau -> extrapolation 229 = ~${(tot / (ok.length || 1) * 229 / 1073741824).toFixed(1)} Go)`);
const ko = results.filter((r) => !r.ok); if (ko.length) console.log(`Echecs : ${ko.map((r) => r.key).join(", ")}`);
function mb(b) { return (b / 1048576).toFixed(1) + " Mo"; }
