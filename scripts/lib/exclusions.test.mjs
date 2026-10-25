import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadExclusions } from "./exclusions.mjs";

const scratch = (content) => {
  const dir = mkdtempSync(join(tmpdir(), "excl-"));
  if (content !== undefined) writeFileSync(join(dir, "exclusions.json"), content);
  return dir;
};

test("loadExclusions lit les cles de exclusions.json", () => {
  const set = loadExclusions(scratch(JSON.stringify({ _comment: "x", keys: ["ARGO_MOLE_BTALA", "DRAK_Golem_BTALA"] })));
  assert.deepEqual([...set], ["ARGO_MOLE_BTALA", "DRAK_Golem_BTALA"]);
});

test("loadExclusions renvoie un ensemble vide si le fichier manque ou est invalide", () => {
  assert.equal(loadExclusions(scratch()).size, 0);
  assert.equal(loadExclusions(scratch("{pas du json")).size, 0);
  assert.equal(loadExclusions(scratch(JSON.stringify({ keys: "nope" }))).size, 0);
});

test("loadExclusions ignore les entrees qui ne sont pas des chaines", () => {
  assert.deepEqual([...loadExclusions(scratch(JSON.stringify({ keys: ["A", 3, null] })))], ["A"]);
});

test("makeExcluder applique les regles de l'app (Alliance, evenements) et la liste manuelle", async () => {
  const { makeExcluder } = await import("./exclusions.mjs");
  const meta = {
    ARGO_MOLE_BTALA: { name: "MOLE Alliance" },
    AEGS_Idris_P_Collector_Military: { name: "Idris-P Wikelo War Special" },
    ORIG_600i_Executive_Edition: { name: "600i Executive Edition" },
    ANVL_Carrack: { name: "Carrack" },
  };
  const isExcluded = makeExcluder(scratch(JSON.stringify({ keys: ["ORIG_600i_Executive_Edition"] })), meta);
  assert.equal(isExcluded("ARGO_MOLE_BTALA"), true);
  assert.equal(isExcluded("AEGS_Idris_P_Collector_Military"), true);
  assert.equal(isExcluded("ORIG_600i_Executive_Edition"), true);
  assert.equal(isExcluded("ANVL_Carrack"), false);
});
