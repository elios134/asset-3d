import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseName, pickImageUrl, getThumbnail } from "./thumbnails.mjs";

test("baseName retire les suffixes d'édition", () => {
  assert.equal(baseName("Avenger Titan Renegade"), "Avenger Titan");
  assert.equal(baseName("Cutlass Black Best In Show"), "Cutlass Black");
  assert.equal(baseName("Carrack"), "Carrack");
});

test("pickImageUrl extrait la miniature ou null", () => {
  assert.equal(pickImageUrl({ images: [{ thumbnail_url: "http://x/y.jpg" }] }), "http://x/y.jpg");
  assert.equal(pickImageUrl({ images: [] }), null);
  assert.equal(pickImageUrl({}), null);
});

test("getThumbnail télécharge puis met en cache", async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "thumbs-"));
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    if (url.includes("/vehicles")) return { ok: true, json: async () => ({ data: [{ images: [{ thumbnail_url: "http://img/x.jpg" }] }] }) };
    return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  };
  const a = await getThumbnail({ name: "Carrack", cacheDir, fetchImpl, apiBase: "http://api" });
  assert.equal(a.source, "wiki");
  assert.ok(existsSync(a.path));
  const before = calls;
  const b = await getThumbnail({ name: "Carrack", cacheDir, fetchImpl, apiBase: "http://api" });
  assert.equal(b.source, "cache");
  assert.equal(calls, before); // pas de nouvel appel réseau
  rmSync(cacheDir, { recursive: true, force: true });
});

test("getThumbnail ne lève jamais en cas d'échec réseau", async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "thumbs-"));
  const fetchImpl = async () => { throw new Error("offline"); };
  const r = await getThumbnail({ name: "Carrack", cacheDir, fetchImpl, apiBase: "http://api" });
  assert.deepEqual(r, { path: null, source: "none" });
  rmSync(cacheDir, { recursive: true, force: true });
});
