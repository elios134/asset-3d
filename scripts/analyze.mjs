#!/usr/bin/env node
// analyze.mjs — compare version locale, catalogue publié et méta ; liste les vaisseaux à traiter.
// Usage : node scripts/analyze.mjs [--json] [--local-version sc-4.2]
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { analyzeShips } from "./lib/detect.mjs";

const ROOT = process.cwd();
const JSON_MODE = process.argv.includes("--json");
const lvIdx = process.argv.indexOf("--local-version");
const localVersion = lvIdx >= 0 ? process.argv[lvIdx + 1] : null;

const readJson = (p, fallback) => (existsSync(join(ROOT, p)) ? JSON.parse(readFileSync(join(ROOT, p), "utf8")) : fallback);
const meta = readJson("ships.meta.json", {});
const index = readJson("index.json", null);
const anchors = readJson("interior-anchors.json", {});
const anchorKeys = new Set(Object.keys(anchors).filter((k) => k !== "_comment"));

const ships = analyzeShips({ meta, index, localVersion, anchorKeys });
const toProcess = ships.filter((s) => s.toProcess);
const publishedVersion = index?.patchVersion ?? null;

if (JSON_MODE) {
  process.stdout.write(JSON.stringify({
    localVersion: localVersion ?? null, publishedVersion,
    counts: { toProcess: toProcess.length, total: ships.length }, ships,
  }));
} else {
  console.log(`Version locale : ${localVersion ?? "(inconnue)"} · publiée : ${publishedVersion ?? "(aucune)"}`);
  console.log(`${toProcess.length}/${ships.length} vaisseaux à traiter :`);
  for (const s of toProcess) console.log(`  - ${s.name.padEnd(28)} ${s.reasons.join(", ")}`);
}
