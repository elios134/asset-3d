import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLocalGameVersion } from "./game-version.mjs";

test("renvoie null si le p4k ou le manifest est absent", () => {
  assert.equal(readLocalGameVersion("Z:/nope/Data.p4k"), null);
});

test("extrait une version sc-x.y depuis un build_manifest.id frère", () => {
  const live = mkdtempSync(join(tmpdir(), "live-"));
  writeFileSync(join(live, "Data.p4k"), "x");
  writeFileSync(join(live, "build_manifest.id"), JSON.stringify({ Data: { Branch: "sc-alpha-4.2" } }));
  assert.equal(readLocalGameVersion(join(live, "Data.p4k")), "sc-4.2");
  rmSync(live, { recursive: true, force: true });
});

test("renvoie null si aucun champ de version reconnaissable", () => {
  const live = mkdtempSync(join(tmpdir(), "live-"));
  writeFileSync(join(live, "Data.p4k"), "x");
  writeFileSync(join(live, "build_manifest.id"), JSON.stringify({ Data: { Foo: "bar" } }));
  assert.equal(readLocalGameVersion(join(live, "Data.p4k")), null);
  rmSync(live, { recursive: true, force: true });
});
