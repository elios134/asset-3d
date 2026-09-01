import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { checkPrereqs } from "./prereqs.mjs";

const thisFile = fileURLToPath(import.meta.url);

test("checkPrereqs détecte fichiers présents/absents et commandes", () => {
  const r = checkPrereqs({
    paths: { starbreaker: thisFile, p4k: "Z:/nope/Data.p4k" },
    which: (cmd) => cmd === "git",
  });
  assert.equal(r.node, true);
  assert.equal(r.starbreaker, true);   // le fichier de test existe
  assert.equal(r.p4k, false);
  assert.equal(r.git, true);
  assert.equal(r.gh, false);
});
