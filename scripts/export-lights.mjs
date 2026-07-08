#!/usr/bin/env node
// export-lights.mjs — sidecar lumieres : extrait les KHR_lights_punctual des exports StarBreaker
// vers models/<KEY>.lights.json (le pipeline .glb les STRIPPE : three.js ne survit pas a 2000+
// punctual lights ; l'app rallume dynamiquement les N plus proches du joueur depuis ce JSON).
//
// CONTRAT APP (valide par la session app) :
//   - repere = celui du .glb INTERIEUR PUBLIE (metres, Y-up, meme origine) -> on applique la meme
//     reposition que le pipeline pour les vaisseaux ancres (interior-anchors.json) ;
//   - color [r,g,b] LINEAIRE 0-1 ; intensity = candela KHR BRUTE (aucun scaling — l'app calibre un
//     gain global unique) ; range en metres, 0 si absente/infinie (l'app clampe) ;
//   - spots : dir [x,y,z] monde normalise (axe -Z local KHR) + innerConeAngle/outerConeAngle (rad) ;
//   - directional ignorees (rarissimes en interieur, comptees dans le log) ; TOUT est livre, pas de cap.
//
// Usage : node scripts/export-lights.mjs [KEY...] | --all   (defaut : les 62 habitables)

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = join(ROOT, "models");
const STARBREAKER = "C:/Users/andre/Documents/starbreaker/starbreaker.exe";
const P4K = "D:/Program Files/RSI Launcher/StarCitizen/LIVE/Data.p4k";
const kinds = JSON.parse(readFileSync(join(ROOT, "interior-kinds.json"), "utf8")).kinds;
const anchored = new Set(Object.keys(JSON.parse(readFileSync(join(ROOT, "interior-anchors.json"), "utf8"))).filter((k) => k !== "_comment"));

let keys = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (process.argv.includes("--all") || !keys.length)
  keys = Object.entries(kinds).filter(([, v]) => v.kind === "habitable").map(([k]) => k);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };

const r3 = (v) => Math.round(v * 1000) / 1000;
let totalLights = 0, fails = 0;
console.log(`sidecar lumieres : ${keys.length} vaisseau(x)\n`);
for (const key of keys) {
  const tmp = join(MODELS, `_lights_${key}.glb`);
  const fixed = tmp.replace(/\.glb$/, ".fixed.glb");
  try {
    // export leger (le LOD/les materiaux n'affectent pas les entites lumiere) + meme reposition
    // que le pipeline interieur pour rester dans le repere du .glb publie
    execFileSync(STARBREAKER, ["entity", "export", key, tmp, "--materials", "colors", "--lod", "2"], { env: { ...process.env, SC_DATA_P4K: P4K }, stdio: "ignore", timeout: 600000 });
    let path = tmp;
    if (anchored.has(key)) { execFileSync("node", ["scripts/reposition-interior.mjs", tmp, fixed, `--key=${key}`], { cwd: ROOT, stdio: "ignore" }); path = fixed; }
    const doc = await io.read(path);
    const nodes = doc.getRoot().listNodes();
    const pm = new Map(); for (const n of nodes) for (const c of n.listChildren()) pm.set(c, n);
    const wm = (n) => { let mm = n.getMatrix(), p = pm.get(n), seen = new Set([n]), d = 0; while (p && !seen.has(p) && d < 200) { mm = mul(p.getMatrix(), mm); seen.add(p); p = pm.get(p); d++; } return mm; };
    const lights = [];
    let directionals = 0;
    for (const n of nodes) {
      const l = n.getExtension("KHR_lights_punctual");
      if (!l) continue;
      const type = l.getType();
      if (type === "directional") { directionals++; continue; }
      const M = wm(n);
      const e = {
        type,
        pos: [r3(M[12]), r3(M[13]), r3(M[14])],
        color: l.getColor().map(r3),
        intensity: l.getIntensity(),
        range: l.getRange() ?? 0,
      };
      if (type === "spot") {
        // KHR : le spot eclaire selon -Z local -> 3e colonne monde negee, normalisee
        const dx = -M[8], dy = -M[9], dz = -M[10]; const len = Math.hypot(dx, dy, dz) || 1;
        e.dir = [r3(dx / len), r3(dy / len), r3(dz / len)];
        e.innerConeAngle = r3(l.getInnerConeAngle());
        e.outerConeAngle = r3(l.getOuterConeAngle());
      }
      lights.push(e);
    }
    writeFileSync(join(MODELS, `${key}.lights.json`), JSON.stringify({ key, count: lights.length, lights }));
    totalLights += lights.length;
    console.log(`  ✓ ${key.padEnd(30)} ${String(lights.length).padStart(5)} lumieres${directionals ? ` (+${directionals} directional ignorees)` : ""}`);
  } catch (e) {
    fails++;
    console.log(`  ✗ ${key.padEnd(30)} ECHEC : ${e.message.split("\n")[0]}`);
  } finally {
    for (const f of [tmp, fixed]) if (existsSync(f)) rmSync(f);
  }
}
console.log(`\n${keys.length - fails}/${keys.length} OK, ${totalLights} lumieres au total.`);
process.exit(fails ? 1 : 0);
