#!/usr/bin/env node
// fingerprint.mjs — calcule l'empreinte de source de chaque vaisseau et écrit .cache/fingerprints.json.
//
// Empreinte = hash de (chemin, taille) des géométries du vaisseau :
//   chemins  ← `starbreaker entity loadout <key>` (arbre geom=…)
//   tailles  ← `starbreaker p4k list` (un seul appel, chemin<TAB>taille, sans décompression)
//
// Usage :
//   node scripts/fingerprint.mjs                 # toutes les clés de ships.meta.json
//   node scripts/fingerprint.mjs KEY1 KEY2       # clés explicites
//   node scripts/fingerprint.mjs --all --adopt   # backfill : adopte l'empreinte actuelle comme
//                                                  baseline pour tout ce qui est déjà en prod
//   node scripts/fingerprint.mjs --json          # NDJSON de progression (pilotage par l'app)
//   options : --concurrency N (def. 6)
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { loadConfig } from "./lib/config.mjs";
import { parseLoadoutGeoms, parseP4kList, computeFingerprint } from "./lib/fingerprint.mjs";
import { adoptBaseline, publishedKeys } from "./lib/baseline.mjs";
import { readLocalGameVersion } from "./lib/game-version.mjs";

const execFileP = promisify(execFile);
const ROOT = process.cwd();
const JSON_MODE = process.argv.includes("--json");
const ADOPT = process.argv.includes("--adopt");
const ALL = process.argv.includes("--all");
const ccIdx = process.argv.indexOf("--concurrency");
const CONCURRENCY = ccIdx >= 0 ? Math.max(1, Number(process.argv[ccIdx + 1]) || 6) : 6;
const explicit = process.argv.slice(2).filter((a) => !a.startsWith("--") && a !== process.argv[ccIdx + 1]);

const emit = (o) => { if (JSON_MODE) process.stdout.write(JSON.stringify(o) + "\n"); };
const log = (...a) => { if (!JSON_MODE) console.log(...a); };

const readJson = (p, fb) => (existsSync(join(ROOT, p)) ? JSON.parse(readFileSync(join(ROOT, p), "utf8")) : fb);

const cfg = loadConfig({ root: ROOT });
const SB = cfg.paths.starbreaker;
const P4K = cfg.paths.p4k;
const env = { ...process.env, SC_DATA_P4K: P4K };

const meta = JSON.parse(readFileSync(join(ROOT, "ships.meta.json"), "utf8"));
const metaKeys = Object.keys(meta).filter((k) => k !== "_comment");
const keys = explicit.length ? explicit : metaKeys;

log(`Empreintes : ${keys.length} vaisseau(x) · concurrence ${CONCURRENCY}`);
emit({ type: "start", total: keys.length });

// 1) index des tailles du p4k (un seul appel) — géométries uniquement (.cga/.cgf).
let sizeMap = new Map();
try {
  const { stdout } = await execFileP(SB, ["p4k", "list", "--filter", "**/*.cg*"], { env, maxBuffer: 256 * 1024 * 1024 });
  sizeMap = parseP4kList(stdout);
  log(`p4k : ${sizeMap.size} géométries indexées`);
} catch (e) {
  log(`⚠ p4k list a échoué (${e.message.split("\n")[0]}) — tailles inconnues, empreintes dégradées`);
}

// 2) loadout par vaisseau -> empreinte (pool de concurrence).
const fingerprints = {};
let done = 0;
async function one(key) {
  try {
    const { stdout } = await execFileP(SB, ["entity", "loadout", key], { env, timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
    const geoms = parseLoadoutGeoms(stdout);
    const fp = computeFingerprint(geoms, sizeMap);
    fingerprints[key] = fp;
    emit({ type: "progress", key, geoms: geoms.length, fingerprint: fp, done: ++done, total: keys.length });
    log(`  ✓ ${key.padEnd(42)} ${geoms.length} geoms  ${fp.slice(0, 12)}`);
  } catch (e) {
    emit({ type: "progress", key, error: e.message.split("\n")[0], done: ++done, total: keys.length });
    log(`  ✗ ${key.padEnd(42)} ${e.message.split("\n")[0]}`);
  }
}
// pool
const queue = [...keys];
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
  while (queue.length) await one(queue.shift());
}));

// 3) écrit le cache courant.
const version = readLocalGameVersion(P4K);
mkdirSync(join(ROOT, ".cache"), { recursive: true });
writeFileSync(join(ROOT, ".cache", "fingerprints.json"),
  JSON.stringify({ version, generatedAt: new Date().toISOString(), fingerprints }, null, 2));
log(`\n.cache/fingerprints.json écrit (${Object.keys(fingerprints).length} empreintes, version ${version ?? "?"})`);

// 4) backfill/adoption optionnelle de la baseline.
if (ADOPT) {
  const index = readJson("index.json", null);
  const prev = readJson("source-baseline.json", {}).fingerprints ?? {};
  const targets = ALL ? publishedKeys(index) : keys.filter((k) => k in fingerprints);
  const next = adoptBaseline(prev, fingerprints, targets);
  writeFileSync(join(ROOT, "source-baseline.json"),
    JSON.stringify({ _comment: "Empreintes de source de référence (état publié). Généré par scripts/fingerprint.mjs --adopt.", version, fingerprints: next }, null, 2));
  log(`source-baseline.json mis à jour (${targets.length} clé(s) adoptée(s), ${Object.keys(next).length} au total)`);
  emit({ type: "adopted", keys: targets.length, total: Object.keys(next).length });
}

emit({ type: "done", fingerprints: Object.keys(fingerprints).length });
