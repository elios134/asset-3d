import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersion, analyzeShips } from "./detect.mjs";

test("compareVersion compare sur major.minor", () => {
  assert.equal(compareVersion("sc-4.2", "sc-4.1"), 1);
  assert.equal(compareVersion("sc-4.1", "sc-4.1"), 0);
  assert.equal(compareVersion("sc-4.0", "sc-4.1"), -1);
  assert.equal(compareVersion(null, "sc-4.1"), -1);
});

const meta = {
  _comment: "x",
  AAA_New: { name: "New One", manufacturer: "Acme", dims: { l: 20, b: 10, h: 5 } },
  BBB_Old: { name: "Old One", manufacturer: "Acme", dims: { l: 30, b: 12, h: 6 } },
  CCC_NoInt: { name: "No Interior", manufacturer: "Acme", dims: { l: 40, b: 14, h: 7 } },
  DDD_UpToDate: { name: "Fresh", manufacturer: "Acme", dims: { l: 50, b: 16, h: 8 } },
};

const index = {
  patchVersion: "sc-4.1",
  ships: [
    { key: "BBB_Old", patchVersion: "sc-4.0", variants: [{ level: "exterior" }, { level: "interior" }] },
    { key: "CCC_NoInt", patchVersion: "sc-4.2", variants: [{ level: "exterior" }] },
    { key: "DDD_UpToDate", patchVersion: "sc-4.2", variants: [{ level: "exterior" }, { level: "interior" }] },
  ],
};

test("un vaisseau absent du catalogue = nouveau", () => {
  const ships = analyzeShips({ meta, index, localVersion: "sc-4.2", anchorKeys: new Set() });
  const s = ships.find((x) => x.key === "AAA_New");
  assert.deepEqual(s.reasons, ["nouveau"]);
  assert.equal(s.toProcess, true);
  assert.equal(s.exterior.published, false);
});

test("publié sous une version antérieure = version modifiée", () => {
  const ships = analyzeShips({ meta, index, localVersion: "sc-4.2", anchorKeys: new Set() });
  const s = ships.find((x) => x.key === "BBB_Old");
  assert.ok(s.reasons.includes("version modifiée"));
});

test("extérieur publié sans intérieur = intérieur manquant", () => {
  const ships = analyzeShips({ meta, index, localVersion: "sc-4.2", anchorKeys: new Set() });
  const s = ships.find((x) => x.key === "CCC_NoInt");
  assert.ok(s.reasons.includes("intérieur manquant"));
  assert.equal(s.interior.published, false);
});

test("publié à jour et complet = à jour, non traité", () => {
  const ships = analyzeShips({ meta, index, localVersion: "sc-4.2", anchorKeys: new Set() });
  const s = ships.find((x) => x.key === "DDD_UpToDate");
  assert.deepEqual(s.reasons, []);
  assert.equal(s.status, "à jour");
  assert.equal(s.toProcess, false);
});

test("anchorKeys renseigne interior.anchored", () => {
  const ships = analyzeShips({ meta, index, localVersion: "sc-4.2", anchorKeys: new Set(["BBB_Old"]) });
  assert.equal(ships.find((x) => x.key === "BBB_Old").interior.anchored, true);
  assert.equal(ships.find((x) => x.key === "CCC_NoInt").interior.anchored, false);
});

test("_comment est ignoré", () => {
  const ships = analyzeShips({ meta, index, localVersion: "sc-4.2", anchorKeys: new Set() });
  assert.equal(ships.some((x) => x.key === "_comment"), false);
});
