#!/usr/bin/env node
// batch-export.mjs — export en masse des exterieurs "Detaille" + optimisation.
//
// Pour chaque vaisseau (classNameCig) : StarBreaker entity export (exterieur, LOD selon taille)
// -> optimisation gltf-transform (join meshes + meshopt) -> mesure tris/taille/draw calls.
// Robuste aux echecs (continue, log les KO).
//
// Usage :
//   node scripts/batch-export.mjs                 # batch de validation : 15 vaisseaux varies
//   node scripts/batch-export.mjs KEY1 KEY2 ...    # keys (classNameCig) explicites
//   node scripts/batch-export.mjs --all            # toute la flotte (ships.meta.json)

import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, prune, flatten, weld, join, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync, rmSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join as pjoin } from "node:path";

const ROOT = pjoin(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = pjoin(ROOT, "models");
const STARBREAKER = "C:/Users/andre/Documents/starbreaker/starbreaker.exe";
const P4K = "D:/Program Files/RSI Launcher/StarCitizen/LIVE/Data.p4k";

const meta = JSON.parse(readFileSync(pjoin(ROOT, "ships.meta.json"), "utf8"));
const keys = Object.keys(meta).filter((k) => k !== "_comment");

// --- selection du batch ---
const NO_OPTIMIZE = process.argv.includes("--no-optimize");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const ALL = process.argv.includes("--all");
let batch;
if (ALL) batch = keys;
else if (args.length) batch = args;
else {
  // 15 vaisseaux repartis sur toute la plage de tailles (longueur)
  const sorted = keys.filter((k) => meta[k].dims?.l).sort((a, b) => meta[a].dims.l - meta[b].dims.l);
  batch = Array.from({ length: 15 }, (_, i) => sorted[Math.floor((i * (sorted.length - 1)) / 14)]);
  batch = [...new Set(batch)];
}

// Exclusion des editions speciales / peintures (teste sur name + classNameCig, underscores -> espaces)
const EXCLUDE = /\bwikelo\b|\bpyam\b|best in show|\bbis\d*\b|\bexecutive\b|\bexec\b/;
const isExcluded = (k) => EXCLUDE.test(`${meta[k]?.name ?? ""} ${k}`.replace(/_/g, " ").toLowerCase());
{
  const before = batch.length;
  batch = batch.filter((k) => !isExcluded(k));
  if (before - batch.length > 0) console.log(`Exclus (editions wikelo/pyam/bis/exec) : ${before - batch.length}`);
}

// LOD selon la longueur (paliers bruts de StarBreaker)
const lodFor = (l) => (l >= 100 ? 3 : 2);

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression])
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

const results = [];
console.log(`Batch : ${batch.length} vaisseaux\n`);

for (const key of batch) {
  const m = meta[key];
  const l = m.dims?.l ?? 0;
  const lod = lodFor(l);
  const out = pjoin(MODELS, `${key}.exterior.glb`);
  const label = `${key} (${m.name}, ${l}m, LOD${lod})`;
  try {
    // 1) export exterieur detaille
    execFileSync(STARBREAKER, ["entity", "export", key, out,
      "--materials", "colors", "--no-interior", "--lod", String(lod), "--mip", "4"],
      { env: { ...process.env, SC_DATA_P4K: P4K }, stdio: "ignore", timeout: 120000 });
    if (!existsSync(out)) throw new Error("aucun .glb produit");
    const rawSize = statSync(out).size;

    // 2) optimisation (sauf --no-optimize : garde le brut pour passer la QA dessus avant compression)
    if (NO_OPTIMIZE) {
      const doc = await io.read(out);
      const s = stats(doc);
      results.push({ key, name: m.name, ok: true, lod, prims: s.prims, tris: s.tris, mb: mb(rawSize) });
      console.log(`  ✓ ${label.padEnd(48)} BRUT ${s.prims} draw, ${s.tris.toLocaleString()} tris, ${mb(rawSize)} Mo`);
    } else {
      const doc = await io.read(out);
      const primsBefore = countPrims(doc);
      await doc.transform(dedup(), weld({ tolerance: 0.0001 }), flatten(), join(), prune(),
        meshopt({ encoder: MeshoptEncoder, level: "high" }));
      const tmp = out.replace(/\.glb$/, ".opt.glb");
      await io.write(tmp, doc);
      rmSync(out); renameSync(tmp, out);
      const size = statSync(out).size;
      const s = stats(doc);
      results.push({ key, name: m.name, ok: true, lod, primsBefore, prims: s.prims, tris: s.tris, rawMB: mb(rawSize), mb: mb(size) });
      console.log(`  ✓ ${label.padEnd(48)} draw ${primsBefore}->${s.prims}, ${s.tris.toLocaleString()} tris, ${mb(rawSize)}->${mb(size)}`);
    }
  } catch (e) {
    results.push({ key, name: m.name, ok: false, err: e.message.split("\n")[0] });
    console.log(`  ✗ ${label.padEnd(48)} ECHEC : ${e.message.split("\n")[0]}`);
  }
}

const ok = results.filter((r) => r.ok);
const totalMB = ok.reduce((s, r) => s + parseFloat(r.mb), 0);
console.log(`\n${ok.length}/${results.length} OK. Total optimise : ${totalMB.toFixed(1)} Mo` +
  (ok.length ? ` (moyenne ${(totalMB / ok.length).toFixed(2)} Mo/vaisseau -> extrapolation 273 = ~${Math.round(totalMB / ok.length * 273)} Mo)` : ""));
const ko = results.filter((r) => !r.ok);
if (ko.length) console.log(`Echecs : ${ko.map((r) => r.key).join(", ")}`);

function countPrims(doc) { let n = 0; for (const me of doc.getRoot().listMeshes()) n += me.listPrimitives().length; return n; }
function stats(doc) {
  let prims = 0, tris = 0;
  for (const me of doc.getRoot().listMeshes()) for (const p of me.listPrimitives()) {
    prims++; const idx = p.getIndices(), pos = p.getAttribute("POSITION");
    tris += Math.floor((idx ? idx.getCount() : (pos ? pos.getCount() : 0)) / 3);
  }
  return { prims, tris };
}
function mb(b) { return (b / 1048576).toFixed(2); }
