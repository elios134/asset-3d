#!/usr/bin/env node
// scan-interior-convention.mjs — repere les vaisseaux dont l'interieur suit la convention
// d'ancrage du Cutlass (hardpoint_int_* + modules interior_base_int_*_main), donc corrigeables
// automatiquement par reposition-interior.mjs.
//
// Utilise le dump-hierarchy (leger, ~100KB) plutot qu'un export geometrie complet.
// Sortie : interior-scan.json { convention:[], modulesNoHp:[], none:[], failed:[] } + resume.
//
// Usage : node scripts/scan-interior-convention.mjs [max]

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STARBREAKER = "C:/Users/andre/Documents/starbreaker/starbreaker.exe";
const P4K = "D:/Program Files/RSI Launcher/StarCitizen/LIVE/Data.p4k";
const TMP = join(ROOT, ".scan-tmp");
if (!existsSync(TMP)) mkdirSync(TMP);

const meta = JSON.parse(readFileSync(join(ROOT, "ships.meta.json"), "utf8"));
const keys = Object.keys(meta).filter((k) => k !== "_comment");
const max = process.argv[2] ? parseInt(process.argv[2]) : keys.length;
const batch = keys.slice(0, max);

const out = { convention: [], modulesNoHp: [], none: [], failed: [] };
console.log(`Scan convention interieur sur ${batch.length} vaisseaux...\n`);

let i = 0;
for (const key of batch) {
  i++;
  const jf = join(TMP, `${key}.json`);
  try {
    execFileSync(STARBREAKER, ["entity", "export", key, jf, "--dump-hierarchy", "--lod", "3", "--materials", "colors"],
      { env: { ...process.env, SC_DATA_P4K: P4K }, stdio: "ignore", timeout: 90000 });
    const txt = readFileSync(jf, "utf8");
    const hp = new Set(txt.match(/hardpoint_int_[a-z]+/gi) || []).size;
    const mod = new Set(txt.match(/base_int_[a-z]+_main/gi) || []).size;
    const cat = hp > 0 && mod > 0 ? "convention" : (mod > 0 ? "modulesNoHp" : "none");
    out[cat].push({ key, name: meta[key].name, hp, mod });
    if (cat === "convention") console.log(`  [${i}/${batch.length}] ✓ ${key} (${meta[key].name}) — ${hp} hardpoint_int, ${mod} modules`);
  } catch (e) {
    out.failed.push({ key, name: meta[key].name, err: e.message.split("\n")[0] });
  } finally {
    if (existsSync(jf)) rmSync(jf);
  }
}
try { rmSync(TMP, { recursive: true, force: true }); } catch {}

writeFileSync(join(ROOT, "interior-scan.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`\n=== RESUME ===`);
console.log(`  convention (corrigeable auto) : ${out.convention.length}`);
console.log(`  modules sans hardpoint_int    : ${out.modulesNoHp.length}`);
console.log(`  ni l'un ni l'autre            : ${out.none.length}`);
console.log(`  echecs export                 : ${out.failed.length}`);
console.log(`\nVaisseaux "convention" : ${out.convention.map((s) => s.name).join(", ")}`);
console.log(`\nDetail complet -> interior-scan.json`);
