#!/usr/bin/env node
// publish.mjs — publication CHIRURGICALE d'un sous-ensemble de vaisseaux.
//
// Contrairement a build-index.mjs (qui REGENERE index.json de zero depuis models/ et
// embarquerait donc tout orphelin/test present sur le disque), ce script part de l'index
// PUBLIE (index.json git-tracke = source de verite) et ne touche QUE les entrees des cles
// passees en --only. C'est le garde-fou build-index, isole et testable.
//
// Pour chaque cle : localise ses .glb clay dans models/, recalcule sha256/taille/tris,
// (--confirm) les upload sur la Release avec --clobber, puis patche en place la variante
// correspondante de index.json (+ dims depuis ships.meta.json). Les autres vaisseaux de
// l'index ne sont jamais modifies.
//
// SECURITE : dry-run par defaut. Rien n'est uploade ni ecrit sans --confirm. Le push git
// (action externe, irreversible) reste OPT-IN via --push (exige --confirm).
//
// Usage :
//   node scripts/publish.mjs --only=DRAK_Clipper[,AEGS_Avenger_Titan] [--json] [--confirm] [--push]
//   node scripts/publish.mjs --manifest=publish.json [...]        (manifest = tableau JSON de cles)
//   (defaut = --dry-run : plan complet, aucun effet de bord)

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeEmitter } from "./lib/emit.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JSON_MODE = process.argv.includes("--json");
const CONFIRM = process.argv.includes("--confirm");
const PUSH = process.argv.includes("--push");
const DRY = !CONFIRM;
const emit = makeEmitter(JSON_MODE);
if (JSON_MODE) console.log = () => {}; // stdout = NDJSON pur

const argVal = (name, def) => {
  const p = process.argv.find((a) => a.startsWith(name + "="));
  return p ? p.slice(name.length + 1) : def;
};

// --- resolution des cles a publier (--only ou --manifest ; refus si ni l'un ni l'autre) ---
let keys = [];
const only = argVal("--only", null);
const manifest = argVal("--manifest", null);
if (only) keys = only.split(",").map((s) => s.trim()).filter(Boolean);
else if (manifest) {
  const m = JSON.parse(readFileSync(join(ROOT, manifest), "utf8"));
  keys = Array.isArray(m) ? m : Array.isArray(m.keys) ? m.keys : [];
}
if (keys.length === 0) {
  const msg = "Aucune cle a publier. Passe --only=KEY[,KEY] ou --manifest=fichier.json (pas de publication globale accidentelle).";
  emit({ type: "error", message: msg });
  console.error(msg);
  process.exit(2);
}

const config = JSON.parse(readFileSync(join(ROOT, "config.json"), "utf8"));
const { githubOwner, githubRepo, patchVersion } = config;
const releaseBase = `https://github.com/${githubOwner}/${githubRepo}/releases/download/${patchVersion}`;
const repoSlug = `${githubOwner}/${githubRepo}`;

// Overrides (tests / usages hors-racine) : --index= --meta= --models=
const indexPath = argVal("--index", join(ROOT, "index.json"));
const index = JSON.parse(readFileSync(indexPath, "utf8"));
const meta = JSON.parse(readFileSync(argVal("--meta", join(ROOT, "ships.meta.json")), "utf8"));
const modelsDir = argVal("--models", join(ROOT, "models"));
const labelOf = Object.fromEntries((config.levels ?? []).map((l) => [l.id, l.label]));
const levelOrder = (config.levels ?? []).map((l) => l.id);

emit({ type: "start", dryRun: DRY, push: PUSH, patchVersion, keys });

// clay-<level> present sur le disque -> niveau canonique de l'index
const LEVELS = [
  { suffix: "clay-exterior", level: "exterior", render: "clay" },
  { suffix: "clay-interior", level: "interior", render: "clay", hasCollision: true },
];

const uploads = [];   // { file, path } a uploader sur la Release
const patched = [];   // cles patchees
const problems = [];

for (const key of keys) {
  const present = LEVELS.map((L) => ({ ...L, file: `${key}.${L.suffix}.glb`, path: join(modelsDir, `${key}.${L.suffix}.glb`) }))
    .filter((L) => existsSync(L.path));
  if (present.length === 0) {
    problems.push(`[FICHIER] ${key} : aucun ${key}.clay-*.glb dans models/`);
    emit({ type: "skip", key, reason: "no-glb" });
    continue;
  }
  if (!meta[key]) {
    problems.push(`[META] ${key} : entree absente de ships.meta.json`);
    emit({ type: "skip", key, reason: "no-meta" });
    continue;
  }

  let ship = index.ships.find((s) => s.key === key);
  const isNew = !ship;
  if (isNew) {
    const m = meta[key];
    ship = {
      key,
      name: m.name,
      manufacturer: m.manufacturer,
      classification: m.classification ?? null,
      dims: m.dims ?? null,
      materials: m.materials ?? "flat",
      patchVersion: m.patchVersion ?? patchVersion,
      variants: [],
    };
    index.ships.push(ship);
    emit({ type: "new-ship", key });
  } else if (meta[key].dims) {
    ship.dims = meta[key].dims; // recale les dims (convention geometrie exterieure, cf. a112953)
  }

  for (const L of present) {
    const buf = readFileSync(L.path);
    const sha256 = createHash("sha256").update(buf).digest("hex");
    const sizeBytes = statSync(L.path).size;
    const tris = countTriangles(buf);

    let v = ship.variants.find((x) => x.level === L.level);
    if (!v) {
      v = { level: L.level, label: labelOf[L.level] ?? L.level, modelUrl: `${releaseBase}/${L.file}`, hasInterior: L.level === "interior" };
      ship.variants.push(v);
    }
    v.modelUrl = `${releaseBase}/${L.file}`;
    v.tris = tris;
    v.sizeBytes = sizeBytes;
    v.sha256 = sha256;
    v.render = L.render;
    if (L.hasCollision) v.hasCollision = true;

    // sidecar lumieres interieur (si present)
    if (L.level === "interior") {
      const lightsFile = `${key}.lights.json`;
      const lightsPath = join(modelsDir, lightsFile);
      if (existsSync(lightsPath)) {
        const lbuf = readFileSync(lightsPath);
        v.lights = {
          url: `${releaseBase}/${lightsFile}`,
          sha256: createHash("sha256").update(lbuf).digest("hex"),
          sizeBytes: statSync(lightsPath).size,
          count: JSON.parse(lbuf.toString("utf8")).count ?? 0,
        };
        uploads.push({ file: lightsFile, path: lightsPath });
      }
    }

    uploads.push({ file: L.file, path: L.path });
    emit({ type: "plan", key, level: L.level, file: L.file, tris, sizeBytes, sha256 });
  }

  ship.variants.sort((a, b) => levelOrder.indexOf(a.level) - levelOrder.indexOf(b.level));
  patched.push(key);
}

if (patched.length === 0) {
  emit({ type: "done", dryRun: DRY, published: [], problems });
  if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
  process.exit(0);
}

if (DRY) {
  emit({ type: "done", dryRun: true, wouldUpload: uploads.map((u) => u.file), wouldPatch: patched, problems });
  console.log(`[dry-run] ${uploads.length} fichier(s) a uploader, ${patched.length} cle(s) a patcher. Rien n'a ete fait.`);
  if (problems.length) console.warn(problems.join("\n"));
  process.exit(0);
}

// --- effets de bord (--confirm) ---
for (const u of uploads) {
  emit({ type: "upload", file: u.file, status: "start" });
  execFileSync("gh", ["release", "upload", patchVersion, u.path, "--clobber", "--repo", repoSlug], { cwd: ROOT, stdio: JSON_MODE ? "ignore" : "inherit" });
  emit({ type: "upload", file: u.file, status: "done" });
}

index.generatedAt = new Date().toISOString();
index.ships.sort((a, b) => a.key.localeCompare(b.key));
writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
emit({ type: "index-written", keys: patched });

if (PUSH) {
  emit({ type: "git", status: "start" });
  execFileSync("git", ["add", "index.json"], { cwd: ROOT, stdio: JSON_MODE ? "ignore" : "inherit" });
  execFileSync("git", ["commit", "-m", `publish: ${patched.join(", ")} (${patchVersion})`], { cwd: ROOT, stdio: JSON_MODE ? "ignore" : "inherit" });
  execFileSync("git", ["push"], { cwd: ROOT, stdio: JSON_MODE ? "ignore" : "inherit" });
  emit({ type: "git", status: "done" });
}

emit({ type: "done", dryRun: false, published: patched, uploaded: uploads.map((u) => u.file), pushed: PUSH, problems });
console.log(`Publie : ${patched.join(", ")} (${uploads.length} fichier(s))${PUSH ? " + push" : " (index.json ecrit, non pousse)"}.`);
if (problems.length) console.warn(problems.join("\n"));

// ---------- helpers ----------
function countTriangles(buf) {
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x46546c67) throw new Error("Pas un fichier GLB valide (magic).");
  let offset = 12, json = null;
  while (offset < buf.length) {
    const chunkLen = buf.readUInt32LE(offset);
    const chunkType = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (chunkType === 0x4e4f534a) { json = JSON.parse(buf.subarray(start, start + chunkLen).toString("utf8")); break; }
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
