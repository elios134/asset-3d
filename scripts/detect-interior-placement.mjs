#!/usr/bin/env node
// detect-interior-placement.mjs — detecte les int  erieurs dont des MODULES depassent de la coque.
//
// Pour chaque vaisseau ayant un interieur : coque de reference = bbox monde de la variante
// exterior. Pour chaque module interior_base_int_*_main : bbox monde. Si le module depasse la
// coque de plus de TOL sur une face -> "depasse" (module mal place / sort du vaisseau).
// Note s'il a un hardpoint_int_* (=> corrigible auto) ou non.
//
// Lit les .glb compresses via gltf-transform (decode meshopt). Ecrit interior-placement.json.
//
// Usage : node scripts/detect-interior-placement.mjs [max]

import { NodeIO, getBounds } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = join(ROOT, "models");
const TOL = 2.0; // m de depassement tolere

const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const meta = JSON.parse(readFileSync(join(ROOT, "ships.meta.json"), "utf8"));
const keys = Object.keys(meta).filter((k) => k !== "_comment" && existsSync(join(MODELS, `${k}.interior.glb`)));
const max = process.argv[2] ? parseInt(process.argv[2]) : keys.length;

const out = { protruding: [], ok: [], noExterior: [], error: [] };
let i = 0;
for (const key of keys.slice(0, max)) {
  i++;
  try {
    const extPath = join(MODELS, `${key}.exterior.glb`);
    if (!existsSync(extPath)) { out.noExterior.push(key); continue; }
    const hull = getBounds((await io.read(extPath)).getRoot().listScenes()[0]);
    const intDoc = await io.read(join(MODELS, `${key}.interior.glb`));
    const nodes = intDoc.getRoot().listNodes();
    const hasHp = nodes.some((n) => /^hardpoint_int_/i.test(n.getName() || ""));
    const modules = nodes.filter((n) => /^interior_base_int_.+_main$/i.test(n.getName() || ""));
    const bad = [];
    for (const m of modules) {
      const b = getBounds(m);
      if (!b || !isFinite(b.min[0])) continue;
      const over = Math.max(
        hull.min[0] - b.min[0], b.max[0] - hull.max[0],
        hull.min[1] - b.min[1], b.max[1] - hull.max[1],
        hull.min[2] - b.min[2], b.max[2] - hull.max[2],
      );
      if (over > TOL) bad.push({ module: m.getName(), over: +over.toFixed(1) });
    }
    if (bad.length) {
      out.protruding.push({ key, name: meta[key].name, hasHp, modules: modules.length, bad });
      console.log(`  ✗ ${key.padEnd(30)} ${bad.length} module(s) depassent (${hasHp ? "convention" : "sans hardpoint"}) max +${Math.max(...bad.map((x) => x.over))}m`);
    } else {
      out.ok.push({ key, modules: modules.length });
    }
  } catch (e) { out.error.push({ key, err: e.message.split("\n")[0] }); }
}

writeFileSync(join(ROOT, "interior-placement.json"), JSON.stringify(out, null, 2) + "\n");
const conv = out.protruding.filter((s) => s.hasHp).length;
console.log(`\n=== RESUME (${i} vaisseaux) ===`);
console.log(`  modules qui depassent : ${out.protruding.length}  (dont ${conv} convention = corrigibles auto, ${out.protruding.length - conv} sans hardpoint)`);
console.log(`  OK (rien ne depasse)  : ${out.ok.length}`);
console.log(`  sans exterior / erreur: ${out.noExterior.length} / ${out.error.length}`);
console.log(`Detail -> interior-placement.json`);
