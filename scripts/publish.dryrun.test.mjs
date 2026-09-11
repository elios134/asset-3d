import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// GLB minimal (chunk JSON seul) : 1 mesh / 1 primitive / accessor indices count=3 => 1 triangle.
function miniGlb() {
  const json = JSON.stringify({ asset: { version: "2.0" }, accessors: [{ count: 3 }], meshes: [{ primitives: [{ indices: 0, mode: 4 }] }] });
  const jbuf = Buffer.from(json, "utf8");
  const pad = (4 - (jbuf.length % 4)) % 4;
  const jchunk = Buffer.concat([jbuf, Buffer.alloc(pad, 0x20)]);
  const buf = Buffer.alloc(12 + 8 + jchunk.length);
  buf.writeUInt32LE(0x46546c67, 0); buf.writeUInt32LE(2, 4); buf.writeUInt32LE(buf.length, 8);
  buf.writeUInt32LE(jchunk.length, 12); buf.writeUInt32LE(0x4e4f534a, 16);
  jchunk.copy(buf, 20);
  return buf;
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "pub-"));
  const models = join(dir, "models");
  writeFileSync(join(dir, ".gitkeep"), "");
  execFileSync("node", ["-e", `require('fs').mkdirSync(${JSON.stringify(models)},{recursive:true})`]);
  writeFileSync(join(models, "TARGET_Ship.clay-exterior.glb"), miniGlb());
  writeFileSync(join(models, "ORPHAN_Test.clay-exterior.glb"), miniGlb()); // orphelin : ne doit JAMAIS etre publie
  const indexPath = join(dir, "index.json");
  writeFileSync(indexPath, JSON.stringify({
    schemaVersion: 2, patchVersion: "sc-4.1", levels: [], ships: [
      { key: "KEEP_Untouched", name: "Keep", manufacturer: "X", variants: [{ level: "exterior", sha256: "old", tris: 1, sizeBytes: 1 }] },
      { key: "TARGET_Ship", name: "Target", manufacturer: "X", dims: { l: 1, b: 1, h: 1 }, variants: [{ level: "exterior", modelUrl: "u", sha256: "STALE", tris: 999, sizeBytes: 999, render: "clay" }] },
    ],
  }, null, 2) + "\n");
  const metaPath = join(dir, "meta.json");
  writeFileSync(metaPath, JSON.stringify({ TARGET_Ship: { name: "Target", manufacturer: "X", dims: { l: 2, b: 2, h: 2 } }, ORPHAN_Test: { name: "Orphan", manufacturer: "X" } }));
  return { dir, models, indexPath, metaPath };
}

test("refuse de publier sans --only ni --manifest (pas de publication globale)", () => {
  let code = 0;
  try { execFileSync("node", ["scripts/publish.mjs", "--json"], { cwd: ROOT, encoding: "utf8" }); }
  catch (e) { code = e.status; }
  assert.equal(code, 2);
});

test("--dry-run --json : plan chirurgical, aucun effet de bord, index.json intact", () => {
  const fx = fixture();
  const before = readFileSync(fx.indexPath, "utf8");
  const out = execFileSync("node", [
    "scripts/publish.mjs", "--only=TARGET_Ship", "--json",
    `--index=${fx.indexPath}`, `--meta=${fx.metaPath}`, `--models=${fx.models}`,
  ], { cwd: ROOT, encoding: "utf8" });
  const ev = out.trim().split("\n").map((l) => JSON.parse(l));

  // plan emis pour la cible uniquement
  assert.ok(ev.some((e) => e.type === "plan" && e.key === "TARGET_Ship" && e.level === "exterior"));
  const done = ev.find((e) => e.type === "done");
  assert.equal(done.dryRun, true);
  assert.deepEqual(done.wouldPatch, ["TARGET_Ship"]);
  // GARDE-FOU : l'orphelin present dans models/ n'est jamais embarque
  assert.ok(!done.wouldUpload.some((f) => f.includes("ORPHAN")));
  assert.ok(done.wouldUpload.includes("TARGET_Ship.clay-exterior.glb"));
  // dry-run = zero ecriture disque
  assert.equal(readFileSync(fx.indexPath, "utf8"), before);
});
