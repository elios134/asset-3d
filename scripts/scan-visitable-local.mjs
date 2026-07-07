#!/usr/bin/env node
// scan-visitable-local.mjs — reproduit le filtre "visitable" en scannant les .glb interieurs DEJA construits
// (pas de re-export StarBreaker). Convention = au moins 1 hardpoint_int_* ET 1 base_int_*_main.
// Sortie : visitable-scan.json { convention:[keys], modulesNoHp:[keys], none:[keys] } + resume.

import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = join(ROOT, "models");
const meta = JSON.parse(readFileSync(join(ROOT, "ships.meta.json"), "utf8"));
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ "meshopt.decoder": MeshoptDecoder });

const keys = readdirSync(MODELS).filter((f) => f.endsWith(".interior.glb")).map((f) => f.replace(".interior.glb", ""));
const out = { convention: [], modulesNoHp: [], none: [], failed: [] };
let i = 0;
for (const key of keys) {
  i++;
  try {
    const doc = await io.read(join(MODELS, `${key}.interior.glb`));
    const names = doc.getRoot().listNodes().map((n) => n.getName() || "");
    const hp = names.filter((n) => /hardpoint_int_[a-z]+/i.test(n)).length;
    const mod = names.filter((n) => /base_int_[a-z]+_main/i.test(n)).length;
    const cat = hp > 0 && mod > 0 ? "convention" : mod > 0 ? "modulesNoHp" : "none";
    out[cat].push({ key, name: meta[key]?.name ?? key, hp, mod });
  } catch (e) {
    out.failed.push({ key, err: e.message.split("\n")[0] });
  }
  if (i % 40 === 0) console.log(`  ...${i}/${keys.length}`);
}
writeFileSync(join(ROOT, "visitable-scan.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`\n=== RESUME (${keys.length} interieurs scannes) ===`);
console.log(`  convention (hp + module) : ${out.convention.length}`);
console.log(`  module sans hardpoint     : ${out.modulesNoHp.length}`);
console.log(`  aucun marqueur            : ${out.none.length}`);
console.log(`  echecs lecture            : ${out.failed.length}`);
