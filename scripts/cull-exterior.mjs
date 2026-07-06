#!/usr/bin/env node
// cull-exterior.mjs — retire des .glb EXTERIEURS les noeuds parasites pour la vitrine (Apercu) :
//   1) primitives orphelines (artefacts Blender/StarBreaker : Box204, Cube.001...) qui depassent
//      de la coque -> TOUJOURS retires (jamais de vraies pieces).
//   2) mobilier purement interieur (sieges, lit, console, ecrans, boutons) -> inutile en vitrine
//      exterieure, parfois visible a travers la verriere. Composants fonctionnels (powr/qdrv/cool/
//      life) CONSERVES (dans la coque, invisibles).
//
// Fonctionne sur les exterieurs deja optimises (le join a conserve les noms de noeuds).
// Lit (meshopt decode auto) -> retire -> re-compresse meshopt. Ecrit <name>.culled.glb.
//
// Usage : node scripts/cull-exterior.mjs <fichier.glb> [autre ...]   (defaut : tous models/*.exterior.glb)

import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { prune, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import { readdirSync, statSync, rmSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join as pjoin } from "node:path";

const ROOT = pjoin(dirname(fileURLToPath(import.meta.url)), "..");
const IN_PLACE = process.argv.includes("--in-place");

// artefacts orphelins (regex de l'app, 0 faux positif constate)
const ORPHAN = /^(box|cube|plane|cylinder|sphere|cone|circle|icosphere|object|empty)[._]?\d+$/i;
// mobilier interieur (retire de la vitrine exterieure) ; NE PAS toucher aux composants fonctionnels
const FURNITURE = /(^|_)(bed|seat|console|screen_ui|btn|hud|monitor|keyboard|mousepad|cushion|blanket|pillow)(_|$|\d)/i;

let inputs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (inputs.length === 0) inputs = readdirSync(pjoin(ROOT, "models")).filter((f) => f.endsWith(".exterior.glb")).map((f) => pjoin(ROOT, "models", f));

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression])
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

let totalRemoved = 0;
for (const path of inputs) {
  const doc = await io.read(path);
  const root = doc.getRoot();
  const removed = [];
  for (const node of root.listNodes()) {
    const name = node.getName() || "";
    if (node.getMesh() && (ORPHAN.test(name) || FURNITURE.test(name))) { removed.push(name); node.dispose(); }
  }
  await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: "high" }));
  const sizeBefore = statSync(path).size;
  const out = IN_PLACE ? path.replace(/\.glb$/, ".culled.glb") : path.replace(/\.glb$/, ".culled.glb");
  await io.write(out, doc);
  if (IN_PLACE) { rmSync(path); renameSync(out, path); }
  const sizeAfter = statSync(IN_PLACE ? path : out).size;
  totalRemoved += removed.length;
  const name = path.split(/[\\/]/).pop();
  const orph = removed.filter((n) => ORPHAN.test(n));
  console.log(`  ${name.padEnd(42)} -${removed.length} noeuds (${orph.length} orphelins) ${mb(sizeBefore)}->${mb(sizeAfter)} Mo`);
  if (removed.length && inputs.length <= 3) console.log(`      retires: ${removed.slice(0, 20).join(", ")}${removed.length > 20 ? "…" : ""}`);
}
console.log(`\nTotal retire : ${totalRemoved} noeuds sur ${inputs.length} fichier(s).`);
function mb(b) { return (b / 1048576).toFixed(2); }
