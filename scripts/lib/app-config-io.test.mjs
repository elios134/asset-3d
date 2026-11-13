import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePath, mergePaths, readAppConfig, writeAppConfig } from "./app-config-io.mjs";

test("validatePath : p4k doit s'appeler Data.p4k et exister", () => {
  const exists = () => true;
  assert.equal(validatePath("p4k", "D:/SC/LIVE/Data.p4k", exists), null);
  assert.match(validatePath("p4k", "D:/SC/LIVE/jeu.exe", exists), /Data\.p4k/);
  assert.match(validatePath("p4k", "D:/SC/LIVE/Data.p4k", () => false), /n'existe pas/);
});

test("validatePath : starbreaker/blender = simple fichier existant", () => {
  assert.equal(validatePath("starbreaker", "C:/sb/starbreaker.exe", () => true), null);
  assert.match(validatePath("blender", "", () => true), /vide/);
  assert.match(validatePath("inconnu", "x", () => true), /inconnue/);
});

test("mergePaths : ajoute sans écraser les autres chemins ni les autres champs", () => {
  const cur = { scfleetDb: "db", paths: { starbreaker: "S", p4k: "ANCIEN" } };
  const next = mergePaths(cur, "p4k", "NOUVEAU");
  assert.equal(next.scfleetDb, "db");
  assert.equal(next.paths.starbreaker, "S");
  assert.equal(next.paths.p4k, "NOUVEAU");
  assert.equal(cur.paths.p4k, "ANCIEN"); // immuable
});

test("readAppConfig : {} si absent ou illisible", () => {
  const dir = mkdtempSync(join(tmpdir(), "ac-"));
  assert.deepEqual(readAppConfig(dir), {});
  writeFileSync(join(dir, "app-config.json"), "{ pas du json");
  assert.deepEqual(readAppConfig(dir), {});
  rmSync(dir, { recursive: true, force: true });
});

test("writeAppConfig puis readAppConfig : aller-retour fidèle", () => {
  const dir = mkdtempSync(join(tmpdir(), "ac-"));
  writeAppConfig(dir, { paths: { p4k: "X" } });
  assert.deepEqual(readAppConfig(dir), { paths: { p4k: "X" } });
  assert.ok(readFileSync(join(dir, "app-config.json"), "utf8").endsWith("\n"));
  rmSync(dir, { recursive: true, force: true });
});
