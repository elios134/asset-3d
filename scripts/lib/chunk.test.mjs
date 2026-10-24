import { test } from "node:test";
import assert from "node:assert/strict";
import { Document } from "@gltf-transform/core";
import { chunkKey, chunkVisual } from "./chunk.mjs";

const tri = (doc, buf, x) => {
  const pos = doc.createAccessor().setType("VEC3").setBuffer(buf).setArray(new Float32Array([x, 0, 0, x + 1, 0, 0, x, 1, 0]));
  return doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute("POSITION", pos));
};

test("chunkKey : cellules de `cell` m, négatifs arrondis vers le bas", () => {
  assert.equal(chunkKey(4, 0, 15, 10), "0_0_1");
  assert.equal(chunkKey(-0.5, -12, 0, 10), "-1_-2_0");
});

test("chunkVisual : un chunk par cellule, portes laissées hors chunks", async () => {
  const doc = new Document(); const buf = doc.createBuffer(); const scene = doc.createScene();
  scene.addChild(doc.createNode("a").setMesh(tri(doc, buf, 1)));
  scene.addChild(doc.createNode("b").setMesh(tri(doc, buf, 3)));
  scene.addChild(doc.createNode("c").setMesh(tri(doc, buf, 25)));
  scene.addChild(doc.createNode("Door_L").setMesh(tri(doc, buf, 2)));
  const { nChunks } = await chunkVisual(doc, 10, (n) => /door/i.test(n));
  assert.equal(nChunks, 2);
  const roots = scene.listChildren().map((n) => n.getName()).sort();
  assert.deepEqual(roots, ["Door_L", "chunk_0_0_0", "chunk_2_0_0"]);
  assert.equal(scene.listChildren().find((n) => n.getName() === "chunk_0_0_0").listChildren().length, 2);
});
