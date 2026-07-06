#!/usr/bin/env node
// release-patch.mjs — regenere toute la flotte pour un nouveau patch SC (etapes locales).
//
// A LANCER APRES avoir mis a jour `patchVersion` dans config.json (ex. "sc-4.2").
// Enchaine : gen-meta (DB -> meta) -> batch-export --all (export + optimize) -> build-index.
// Puis affiche les commandes de publication (gh release) a lancer a la main (action externe).
//
// Prerequis : env SC_DATA_P4K, StarBreaker, Node, gh connecte. Voir docs/RUNBOOK.md.
// Usage : node scripts/release-patch.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { patchVersion } = JSON.parse(readFileSync(join(ROOT, "config.json"), "utf8"));

function step(label, args) {
  console.log(`\n=== ${label} ===`);
  execFileSync("node", args, { cwd: ROOT, stdio: "inherit" });
}

console.log(`Regeneration flotte pour patch : ${patchVersion}`);
step("1/3 metadonnees (ShipData -> ships.meta.json)", ["scripts/gen-meta.mjs"]);
step("2/3 export + optimisation de toute la flotte (long)", ["scripts/batch-export.mjs", "--all"]);
step("3/3 catalogue (index.json)", ["scripts/build-index.mjs"]);

console.log(`
=== Publication (a lancer a la main — action externe) ===
  gh release create ${patchVersion} --title "SC ${patchVersion}" --notes "Flotte ${patchVersion}"   # si le tag n'existe pas
  gh release upload ${patchVersion} models/*.exterior.glb --clobber
  git add index.json ships.meta.json && git commit -m "Flotte ${patchVersion}" && git push

Intérieurs (cas par cas, voir docs/RUNBOOK.md) : reposition-interior.mjs puis optimize --compress-only.
`);
