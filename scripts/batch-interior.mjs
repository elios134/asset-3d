#!/usr/bin/env node
// batch-interior.mjs — export en masse des INTERIEURS + compression meshopt (Visite 1re personne).
//
// Par vaisseau : StarBreaker entity export (avec interieur, LOD selon taille) -> compression
// meshopt SEULE (weld + meshopt, PAS de join/flatten -> preserve noms de mesh + hardpoints, requis
// par le harnais/visite de l'app). Categorise l'interieur (convention hardpoint_int_* / modules
// sans hardpoint / aucun module) pour savoir lesquels sont corrigibles auto (reposition).
//
// Les vaisseaux presents dans interior-anchors.json sont SAUTES (deja traites/valides a la main).
//
// Usage :
//   node scripts/batch-interior.mjs                # batch test : 15 vaisseaux varies
//   node scripts/batch-interior.mjs KEY1 KEY2 ...   # keys explicites
//   node scripts/batch-interior.mjs --all           # toute la flotte

import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { weld, meshopt } from "@gltf-transform/functions";
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
const anchored = new Set(Object.keys(JSON.parse(readFileSync(pjoin(ROOT, "interior-anchors.json"), "utf8"))).filter((k) => k !== "_comment"));
const EXCLUDE = /\bwikelo\b|\bpyam\b|best in show|\bbis\d*\b|\bexecutive\b|\bexec\b/;
const isExcluded = (k) => EXCLUDE.test(`${meta[k]?.name ?? ""} ${k}`.replace(/_/g, " ").toLowerCase());

const keys = Object.keys(meta).filter((k) => k !== "_comment" && !isExcluded(k) && !anchored.has(k) && meta[k].dims?.l);

let batch;
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (process.argv.includes("--all")) batch = keys;
else if (args.length) batch = args;
else {
  const sorted = keys.slice().sort((a, b) => meta[a].dims.l - meta[b].dims.l);
  batch = [...new Set(Array.from({ length: 15 }, (_, i) => sorted[Math.floor((i * (sorted.length - 1)) / 14)]))];
}

// LOD interieur selon la taille (compromis detail walkable / poids ; LOD2 trop lourd >70m)
const lodFor = (l) => (l >= 70 ? 3 : l >= 30 ? 2 : 1);

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression])
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

const results = [];
console.log(`Batch interieurs : ${batch.length} vaisseaux\n`);

for (const key of batch) {
  const m = meta[key];
  const l = m.dims?.l ?? 0;
  const lod = lodFor(l);
  const out = pjoin(MODELS, `${key}.interior.glb`);
  const label = `${key} (${m.name}, ${l}m, LOD${lod})`;
  try {
    execFileSync(STARBREAKER, ["entity", "export", key, out, "--materials", "colors", "--lod", String(lod), "--mip", "4"],
      { env: { ...process.env, SC_DATA_P4K: P4K }, stdio: "ignore", timeout: 180000 });
    if (!existsSync(out)) throw new Error("aucun .glb produit");
    const rawSize = statSync(out).size;

    // categorisation sur le brut (avant compression qui ajoute des noeuds)
    const cat = categorize(out);

    // compression meshopt seule (preserve noms + hardpoints + placement)
    const doc = await io.read(out);
    await doc.transform(weld({ tolerance: 0.0001 }), meshopt({ encoder: MeshoptEncoder, level: "high" }));
    const tmp = out.replace(/\.glb$/, ".opt.glb");
    await io.write(tmp, doc);
    rmSync(out); renameSync(tmp, out);
    const size = statSync(out).size;

    results.push({ key, name: m.name, ok: true, cat, rawMB: +mb(rawSize), mb: +mb(size) });
    console.log(`  ✓ ${label.padEnd(46)} [${cat.padEnd(11)}] ${mb(rawSize)}->${mb(size)} Mo`);
  } catch (e) {
    results.push({ key, name: m.name, ok: false, err: e.message.split("\n")[0] });
    console.log(`  ✗ ${label.padEnd(46)} ECHEC : ${e.message.split("\n")[0]}`);
  }
}

const ok = results.filter((r) => r.ok);
const totalMB = ok.reduce((s, r) => s + r.mb, 0);
const byCat = (c) => ok.filter((r) => r.cat === c).length;
console.log(`\n${ok.length}/${results.length} OK. Total compresse : ${totalMB.toFixed(0)} Mo (moy ${(totalMB / (ok.length || 1)).toFixed(1)} Mo/vaisseau)`);
console.log(`Categories : convention=${byCat("convention")}, modulesNoHp=${byCat("modulesNoHp")}, none=${byCat("none")}`);
const ko = results.filter((r) => !r.ok);
if (ko.length) console.log(`Echecs (${ko.length}) : ${ko.map((r) => r.key).join(", ")}`);

// classe l'interieur selon la convention d'ancrage
function categorize(file) {
  const buf = readFileSync(file);
  let off = 12, jb = null;
  while (off < buf.length) { const l = buf.readUInt32LE(off), t = buf.readUInt32LE(off + 4), s = off + 8; if (t === 0x4e4f534a) { jb = buf.subarray(s, s + l); break; } off = s + l; }
  const names = (JSON.parse(jb.toString("utf8")).nodes ?? []).map((n) => n.name || "");
  const hp = names.some((n) => /^hardpoint_int_/i.test(n));
  const mod = names.some((n) => /^interior_base_int_.+_main$/i.test(n));
  return hp && mod ? "convention" : mod ? "modulesNoHp" : "none";
}
function mb(b) { return (b / 1048576).toFixed(2); }
