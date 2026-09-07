import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// qa.mjs ne lit JAMAIS le chunk binaire d'un .glb : il n'utilise que les
// accessor.min/max du chunk JSON. Une fixture GLB "JSON-only" suffit donc.
function glb(gltf) {
  const jsonBuf = Buffer.from(JSON.stringify(gltf), "utf8");
  const pad = (4 - (jsonBuf.length % 4)) % 4;
  const chunk = Buffer.concat([jsonBuf, Buffer.alloc(pad, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);          // version 2
  header.writeUInt32LE(12 + 8 + chunk.length, 8);
  const ch = Buffer.alloc(8);
  ch.writeUInt32LE(chunk.length, 0);
  ch.writeUInt32LE(0x4e4f534a, 4);     // "JSON"
  return Buffer.concat([header, ch, chunk]);
}

// Un noeud/mesh dont la bbox (min/max) tient dans dims l=20,b=10,h=6 :
// x∈[-5,5] (b=10), y∈[-3,3] (h=6), z∈[-10,10] (l=20).
function variant(rootName) {
  return {
    asset: { version: "2.0" },
    scenes: [{ nodes: [0] }],
    nodes: [{ name: rootName, mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ type: "VEC3", componentType: 5126, count: 8, min: [-5, -3, -10], max: [5, 3, 10] }],
  };
}

test("qa --json émet du NDJSON pur (ship* + result) et calcule conforme", () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-"));
  const models = join(dir, "models");
  const metaPath = join(dir, "ships.meta.json");
  try {
    writeFileSync(metaPath, JSON.stringify({ TST_Ship: { name: "Test Ship", dims: { l: 20, b: 10, h: 6 } } }));
    mkdirSync(models, { recursive: true });
    writeFileSync(join(models, "TST_Ship.clay-exterior.glb"), glb(variant("hull")));
    writeFileSync(join(models, "TST_Ship.clay-interior.glb"), glb(variant("interior_base_int_main")));
    // Une variante legacy HD et une variante hors-index : doivent être IGNORÉES.
    writeFileSync(join(models, "TST_Ship.interior.glb"), glb(variant("interior_base_int_legacy")));
    writeFileSync(join(models, "TST_Ship.clay-soft-interior.glb"), glb(variant("interior_base_int_soft")));

    const out = execFileSync(
      "node",
      ["scripts/qa.mjs", "--json", `--models=${models}`, `--meta=${metaPath}`],
      { cwd: ROOT, encoding: "utf8" },
    );
    // JSON.parse par ligne : lève si un log humain a fui sur stdout.
    const lines = out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(lines.every((e) => typeof e.type === "string"), "toutes les lignes sont du JSON typé");

    const ships = lines.filter((e) => e.type === "ship");
    assert.equal(ships.length, 1, "un seul vaisseau clay contrôlé (legacy/soft ignorés)");
    assert.equal(ships[0].key, "TST_Ship");
    assert.equal(ships[0].name, "Test Ship");
    assert.equal(ships[0].hard, 0);
    assert.equal(ships[0].warns, 0);
    assert.ok(Array.isArray(ships[0].messages) && ships[0].messages.length === 0);

    const result = lines.find((e) => e.type === "result");
    assert.ok(result, "un événement result final");
    assert.deepEqual(result, { type: "result", conforme: true, ships: 1, hard: 0, warns: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
