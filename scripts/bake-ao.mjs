#!/usr/bin/env node
// bake-ao.mjs — wrapper du bake AO Blender pour un interieur publie.
//
// Blender ne lit pas EXT_meshopt_compression : on DECOMPRESSE (gltf-transform read/write sans
// meshopt), on bake l'AO en vertex colors (bake-ao.py), puis on RECOMPRESSE (meshopt).
// Ecrit models/<key>.interior.glb en place (sauvegarde .bak avant).
// Usage : node scripts/bake-ao.mjs KEY [samples=16]

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import { execFileSync } from "node:child_process";
import { copyFileSync, statSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = join(ROOT, "models");
const BLENDER = "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe";
const key = process.argv[2];
const samples = process.argv[3] || "16";
if (!key) { console.error("Usage : node scripts/bake-ao.mjs KEY [samples]"); process.exit(1); }

const file = join(MODELS, `${key}.interior.glb`);
const dec = join(MODELS, `_ao_${key}_dec.glb`);
const baked = join(MODELS, `_ao_${key}_baked.glb`);

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

console.log(`[1/3] decompression meshopt -> ${dec}`);
const doc = await io.read(file); // lu+decode ; ecrit SANS transform meshopt = non compresse
await io.write(dec, doc);

console.log(`[2/3] bake AO Blender (${samples} samples)...`);
execFileSync(BLENDER, ["--background", "--python", join(ROOT, "scripts/bake-ao.py"), "--", dec, baked, samples], { stdio: "inherit", timeout: 3600000 });

console.log(`[3/3] recompression meshopt`);
const doc2 = await io.read(baked);
await doc2.transform(meshopt({ encoder: MeshoptEncoder, level: "high" }));
copyFileSync(file, file + ".bak");
await io.write(file, doc2);
for (const f of [dec, baked]) if (existsSync(f)) rmSync(f);
console.log(`OK : ${key}.interior.glb ${(statSync(file).size / 1048576).toFixed(1)} Mo (backup .bak)`);
