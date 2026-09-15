import { test } from "node:test";
import assert from "node:assert/strict";
import { skipModules, NO_MODULES } from "./no-modules.mjs";

test("Nova : modules ignores (l'export --modules sort les roues explosees a 12.9 m)", () => {
  assert.equal(skipModules("TMBL_Nova"), true);
});

test("clef normale : modules gardes (defaut, placement StarBreaker OK)", () => {
  assert.equal(skipModules("AEGS_Avenger_Titan"), false);
  assert.equal(skipModules("DRAK_Clipper"), false);
});

test("NO_MODULES est une table data-driven (Set)", () => {
  assert.ok(NO_MODULES instanceof Set);
  assert.ok(NO_MODULES.has("TMBL_Nova"));
});
