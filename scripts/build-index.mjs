#!/usr/bin/env node
// build-index.mjs — genere index.json a partir des .glb presents dans models/.
//
// Convention de nommage : models/<key>.<level>.glb
//   ex. DRAK_Cutlass_Black.silhouette.glb, DRAK_Cutlass_Black.exterior.glb, DRAK_Cutlass_Black.interior.glb
// key   = className CIG (peut contenir des underscores, jamais de point)
// level = un id declare dans config.json > levels (silhouette | exterior | interior)
//
// Pour chaque fichier : sha256, taille (octets), triangles (parse GLB, zero dependance).
// Les fichiers sont regroupes par key ; chaque vaisseau expose un tableau `variants`
// (un par bouton de niveau de detail cote app), ordonne selon config.levels.
//
// Usage : node scripts/build-index.mjs [--strict]

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STRICT = process.argv.includes("--strict");
const SCHEMA_VERSION = 2;

const config = readJson(join(ROOT, "config.json"));
const meta = readJson(join(ROOT, "ships.meta.json"));
const modelsDir = join(ROOT, "models");
// classification d'habitabilite (surface de plancher praticable) — optionnelle
const interiorKinds = tryReadJson(join(ROOT, "interior-kinds.json"))?.kinds ?? {};

const { githubOwner, githubRepo, patchVersion, levels, budget } = config;
const releaseBase = `https://github.com/${githubOwner}/${githubRepo}/releases/download/${patchVersion}`;
const levelOrder = levels.map((l) => l.id);
const labelOf = Object.fromEntries(levels.map((l) => [l.id, l.label]));

const glbFiles = readdirSync(modelsDir).filter((f) => f.toLowerCase().endsWith(".glb"));
if (glbFiles.length === 0) {
  console.error(`Aucun .glb dans ${modelsDir}. Rien a faire.`);
  process.exit(0);
}

const byKey = new Map(); // key -> [variant, ...]
const problems = [];

for (const file of glbFiles.sort()) {
  const stem = file.slice(0, -4); // enleve .glb
  const dot = stem.lastIndexOf(".");
  if (dot < 0) {
    problems.push(`[NOM] ${file} : attendu <key>.<level>.glb (ex. DRAK_Cutlass_Black.silhouette.glb)`);
    continue;
  }
  const key = stem.slice(0, dot);
  const level = stem.slice(dot + 1);

  if (!levelOrder.includes(level)) {
    problems.push(`[LEVEL] ${file} : niveau "${level}" inconnu (config.levels = ${levelOrder.join(", ")})`);
    continue;
  }
  if (!meta[key]) {
    problems.push(`[META MANQUANTE] ${file} : ajoute une entree "${key}" dans ships.meta.json`);
    continue;
  }

  const buf = readFileSync(join(modelsDir, file));
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const sizeBytes = statSync(join(modelsDir, file)).size;
  const tris = countTriangles(buf);

  const b = budget[level];
  if (b && tris > b.maxTris) {
    problems.push(`[BUDGET TRIS] ${file} : ${tris.toLocaleString()} > max ${b.maxTris.toLocaleString()} (${level})`);
  }
  if (b && sizeBytes > b.maxSizeBytes) {
    problems.push(`[BUDGET TAILLE] ${file} : ${fmtMB(sizeBytes)} > max ${fmtMB(b.maxSizeBytes)} (${level})`);
  }

  if (!byKey.has(key)) byKey.set(key, []);
  const variant = {
    level,
    label: labelOf[level],
    modelUrl: `${releaseBase}/${file}`,
    tris,
    sizeBytes,
    hasInterior: level === "interior",
    sha256,
  };
  if (level === "interior" && interiorKinds[key]) {
    variant.interiorKind = interiorKinds[key].kind;              // "habitable" | "cockpit"
    variant.interiorWalkableM2 = interiorKinds[key].walkableM2;  // surface plancher praticable (m2) — pour reglage du seuil cote app
  }
  // sidecar lumieres (export-lights.mjs) : KHR_lights_punctual strippees du .glb, relivrees en JSON
  // (repere du .glb interieur publie) — l'app allume les N plus proches du joueur.
  if (level === "interior") {
    const lightsFile = `${key}.lights.json`;
    const lightsPath = join(modelsDir, lightsFile);
    try {
      const lbuf = readFileSync(lightsPath);
      variant.lights = {
        url: `${releaseBase}/${lightsFile}`,
        sha256: createHash("sha256").update(lbuf).digest("hex"),
        sizeBytes: statSync(lightsPath).size,
        count: JSON.parse(lbuf.toString("utf8")).count ?? 0,
      };
    } catch { /* pas de sidecar pour ce vaisseau */ }
  }
  byKey.get(key).push(variant);

  console.log(`  ${file.padEnd(40)} ${String(tris).padStart(9)} tris  ${fmtMB(sizeBytes).padStart(9)}`);
}

const ships = [];
for (const [key, variants] of byKey) {
  const m = meta[key];
  variants.sort((a, b) => levelOrder.indexOf(a.level) - levelOrder.indexOf(b.level));
  ships.push({
    key,
    name: m.name,
    manufacturer: m.manufacturer,
    classification: m.classification ?? null,
    dims: m.dims ?? null,
    materials: m.materials ?? "flat",
    patchVersion: m.patchVersion ?? patchVersion,
    variants,
  });
}
ships.sort((a, b) => a.key.localeCompare(b.key));

const index = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  patchVersion,
  levels, // ordre + libelles par defaut (l'app peut les localiser via l'id)
  ships,
};

writeFileSync(join(ROOT, "index.json"), JSON.stringify(index, null, 2) + "\n");
const totalVariants = ships.reduce((n, s) => n + s.variants.length, 0);
console.log(`\nindex.json ecrit : ${ships.length} vaisseau(x), ${totalVariants} variante(s), patch ${patchVersion}.`);

if (problems.length > 0) {
  console.warn(`\n${problems.length} avertissement(s) :`);
  for (const p of problems) console.warn("  - " + p);
  if (STRICT) {
    console.error("\n--strict : echec a cause des avertissements ci-dessus.");
    process.exit(1);
  }
}

// ---------- helpers ----------

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function tryReadJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function fmtMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + " Mo";
}

// Parse un GLB binaire et compte les triangles de toute la geometrie (meshes uniques).
function countTriangles(buf) {
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x46546c67) throw new Error("Pas un fichier GLB valide (magic).");
  let offset = 12;
  let json = null;
  while (offset < buf.length) {
    const chunkLen = buf.readUInt32LE(offset);
    const chunkType = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (chunkType === 0x4e4f534a) {
      json = JSON.parse(buf.subarray(start, start + chunkLen).toString("utf8"));
      break;
    }
    offset = start + chunkLen;
  }
  if (!json) throw new Error("Chunk JSON introuvable dans le GLB.");

  const accessors = json.accessors ?? [];
  let tris = 0;
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const mode = prim.mode ?? 4;
      let count;
      if (prim.indices != null) count = accessors[prim.indices]?.count ?? 0;
      else if (prim.attributes?.POSITION != null) count = accessors[prim.attributes.POSITION]?.count ?? 0;
      else count = 0;
      if (mode === 4) tris += Math.floor(count / 3);
      else if (mode === 5 || mode === 6) tris += Math.max(0, count - 2);
    }
  }
  return tris;
}
