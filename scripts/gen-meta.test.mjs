import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDims } from "./gen-meta.mjs";
import { measureCleanDims } from "./lib/glb-bbox.mjs";

// ---- resolveDims : la regle de decision (pure) ----

test("garde ShipData quand la geometrie confirme (le gros du catalogue)", () => {
  const sd = { l: 20, b: 10, h: 6 };
  const r = resolveDims({ shipData: sd, ext: { l: 20.4, b: 9.8, h: 6.1 }, int: { l: 19, b: 9, h: 5.5 } });
  assert.equal(r.source, "shipdata");
  assert.equal(r.held, false);
  assert.deepEqual(r.dims, sd);
});

test("recale sur la geometrie quand ShipData diverge mais ext~int coherents (cas Avenger)", () => {
  const r = resolveDims({
    shipData: { l: 20, b: 15, h: 6.5 },
    ext: { l: 24.6, b: 16.8, h: 7.2 },
    int: { l: 24.1, b: 16.2, h: 6.0 },
  });
  assert.equal(r.source, "geometry");
  assert.equal(r.held, false);
  assert.deepEqual(r.dims, { l: 24.6, b: 16.8, h: 7.2 });
});

test("meta ShipData = 0 mais geometrie coherente : on recale (MOTH/Javelin)", () => {
  // ext~int se confirment => on croit la geometrie meme si ShipData est nul.
  const r = resolveDims({ shipData: { l: 0, b: 0, h: 0 }, ext: { l: 100, b: 20, h: 15 }, int: { l: 98, b: 19, h: 14 } });
  assert.equal(r.source, "geometry");
  assert.equal(r.held, false);
  assert.deepEqual(r.dims, { l: 100, b: 20, h: 15 });
});

test("TIENT quand ext et int divergent (geometrie non fiable)", () => {
  const r = resolveDims({ shipData: { l: 30, b: 20, h: 8 }, ext: { l: 50, b: 20, h: 8 }, int: { l: 30, b: 12, h: 8 } });
  assert.equal(r.held, true);
  assert.match(r.note, /divergent/);
});

test("ShipData tres faux mais geometrie coherente : on croit la geometrie (Aurora/Clipper)", () => {
  // ShipData b=27.4 alors que le mesh fait ~11 (ratio 2.5) ; ext~int coherents => recal.
  const r = resolveDims({ shipData: { l: 27.7, b: 27.4, h: 8 }, ext: { l: 27, b: 11, h: 5 }, int: { l: 26.5, b: 10.7, h: 4.6 } });
  assert.equal(r.source, "geometry");
  assert.equal(r.held, false);
  assert.deepEqual(r.dims, { l: 27, b: 11, h: 5 });
});

test("override vete a la main : priorite absolue", () => {
  const override = { l: 1, b: 2, h: 3 };
  const r = resolveDims({ shipData: { l: 20, b: 10, h: 6 }, ext: { l: 20, b: 10, h: 6 }, int: { l: 20, b: 10, h: 6 }, override });
  assert.equal(r.source, "override");
  assert.deepEqual(r.dims, override);
});

test("sans clay-exterior : ShipData valide conserve, pas de held", () => {
  const sd = { l: 42, b: 8, h: 5 };
  const r = resolveDims({ shipData: sd, ext: null, int: null });
  assert.equal(r.source, "shipdata");
  assert.equal(r.held, false);
  assert.deepEqual(r.dims, sd);
});

test("recalage exige un clay-interior (pas d'auto-recal sur ext seul)", () => {
  const r = resolveDims({ shipData: { l: 20, b: 15, h: 6.5 }, ext: { l: 24.6, b: 16.8, h: 7.2 }, int: null });
  assert.equal(r.held, true);
  assert.match(r.note, /interior/);
});

// ---- measureCleanDims : dequant + exclusion d'aberrant ----

function glb(gltf) {
  const jsonBuf = Buffer.from(JSON.stringify(gltf), "utf8");
  const pad = (4 - (jsonBuf.length % 4)) % 4;
  const chunk = Buffer.concat([jsonBuf, Buffer.alloc(pad, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + chunk.length, 8);
  const ch = Buffer.alloc(8); ch.writeUInt32LE(chunk.length, 0); ch.writeUInt32LE(0x4e4f534a, 4);
  return Buffer.concat([header, ch, chunk]);
}

test("measureCleanDims dequantifie les accessors normalises (KHR_mesh_quantization)", () => {
  const dir = mkdtempSync(join(tmpdir(), "gm-"));
  try {
    // POSITION int16 normalise + scale [5,3,10] => reel x[-5,5] y[-3,3] z[-10,10]
    // => b=10 (x), h=6 (y), l=20 (z).
    const g = {
      asset: { version: "2.0" }, scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, scale: [5, 3, 10] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ type: "VEC3", componentType: 5122, normalized: true, count: 8, min: [-32767, -32767, -32767], max: [32767, 32767, 32767] }],
    };
    const p = join(dir, "m.glb");
    writeFileSync(p, glb(g));
    assert.deepEqual(measureCleanDims(p), { l: 20, b: 10, h: 6 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("measureCleanDims exclut un mesh aberrant (>1.5x) du calcul des dims", () => {
  const dir = mkdtempSync(join(tmpdir(), "gm-"));
  try {
    // Coque saine z[-10,10] (l=20) + un mesh parasite tres long z[-50,50] (l=100 > 1.5x).
    const g = {
      asset: { version: "2.0" }, scenes: [{ nodes: [0, 1] }],
      nodes: [{ mesh: 0 }, { mesh: 1 }],
      meshes: [
        { primitives: [{ attributes: { POSITION: 0 } }] },
        { primitives: [{ attributes: { POSITION: 1 } }] },
      ],
      accessors: [
        { type: "VEC3", componentType: 5126, count: 8, min: [-5, -3, -10], max: [5, 3, 10] },
        { type: "VEC3", componentType: 5126, count: 8, min: [-1, -1, -50], max: [1, 1, 50] },
      ],
    };
    const p = join(dir, "m.glb");
    writeFileSync(p, glb(g));
    // Amorce ShipData 20/10/6 (comme qa.mjs) : le parasite l=100 (>1.5x) est exclu
    // -> dims propres = coque saine 20/10/6.
    assert.deepEqual(measureCleanDims(p, { l: 20, b: 10, h: 6 }), { l: 20, b: 10, h: 6 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
