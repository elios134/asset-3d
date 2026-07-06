#!/usr/bin/env node
// build-index.mjs — genere index.json a partir des .glb presents dans models/.
//
// Pour chaque models/<key>.glb :
//   - calcule sha256, taille (octets), nombre de triangles (parse le GLB, zero dependance)
//   - joint les metadonnees de ships.meta.json (name, manufacturer, dims, classification, materials)
//   - construit modelUrl vers l'asset de Release GitHub du patch courant
//   - valide le budget (tris / taille) : avertit, ou echoue avec --strict
// Sortie deterministe (clefs triees) pour des diffs propres.
//
// Usage : node scripts/build-index.mjs [--strict]

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STRICT = process.argv.includes("--strict");
const SCHEMA_VERSION = 1;

const config = readJson(join(ROOT, "config.json"));
const meta = readJson(join(ROOT, "ships.meta.json"));
const modelsDir = join(ROOT, "models");

const { githubOwner, githubRepo, patchVersion, budget } = config;
const releaseBase = `https://github.com/${githubOwner}/${githubRepo}/releases/download/${patchVersion}`;

const glbFiles = readdirSync(modelsDir).filter((f) => f.toLowerCase().endsWith(".glb"));
if (glbFiles.length === 0) {
  console.error(`Aucun .glb dans ${modelsDir}. Rien a faire.`);
  process.exit(0);
}

const ships = [];
const problems = [];

for (const file of glbFiles.sort()) {
  const key = basename(file, ".glb");
  const shipMeta = meta[key];
  if (!shipMeta) {
    problems.push(`[META MANQUANTE] ${file} : ajoute une entree "${key}" dans ships.meta.json`);
    continue;
  }

  const buf = readFileSync(join(modelsDir, file));
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const sizeBytes = statSync(join(modelsDir, file)).size;
  const tris = countTriangles(buf);

  if (tris > budget.maxTris) {
    problems.push(`[BUDGET TRIS] ${file} : ${tris.toLocaleString()} tris > max ${budget.maxTris.toLocaleString()}`);
  }
  if (sizeBytes > budget.maxSizeBytes) {
    problems.push(`[BUDGET TAILLE] ${file} : ${fmtMB(sizeBytes)} > max ${fmtMB(budget.maxSizeBytes)}`);
  }

  ships.push({
    key,
    name: shipMeta.name,
    manufacturer: shipMeta.manufacturer,
    classification: shipMeta.classification ?? null,
    modelUrl: `${releaseBase}/${file}`,
    dims: shipMeta.dims ?? null,
    tris,
    sizeBytes,
    materials: shipMeta.materials ?? "flat",
    sha256,
    patchVersion: shipMeta.patchVersion ?? patchVersion,
  });

  console.log(`  ${file.padEnd(34)} ${String(tris).padStart(7)} tris  ${fmtMB(sizeBytes).padStart(9)}`);
}

const index = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  patchVersion,
  ships: ships.sort((a, b) => a.key.localeCompare(b.key)),
};

writeFileSync(join(ROOT, "index.json"), JSON.stringify(index, null, 2) + "\n");
console.log(`\nindex.json ecrit : ${ships.length} vaisseau(x), patch ${patchVersion}.`);

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

function fmtMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + " Mo";
}

// Parse un GLB binaire et compte les triangles de toute la geometrie (meshes uniques).
function countTriangles(buf) {
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x46546c67) throw new Error("Pas un fichier GLB valide (magic).");
  // Chunks : [uint32 length][uint32 type][data...]
  let offset = 12;
  let json = null;
  while (offset < buf.length) {
    const chunkLen = buf.readUInt32LE(offset);
    const chunkType = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (chunkType === 0x4e4f534a) {
      // "JSON"
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
      const mode = prim.mode ?? 4; // 4 = TRIANGLES par defaut
      let count;
      if (prim.indices != null) {
        count = accessors[prim.indices]?.count ?? 0;
      } else if (prim.attributes?.POSITION != null) {
        count = accessors[prim.attributes.POSITION]?.count ?? 0;
      } else {
        count = 0;
      }
      if (mode === 4) tris += Math.floor(count / 3);
      else if (mode === 5 || mode === 6) tris += Math.max(0, count - 2); // strip / fan
      // autres modes (points, lignes) : 0 triangle
    }
  }
  return tris;
}
