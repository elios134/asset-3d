import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeShips } from "./detect.mjs";

const META = {
  _comment: "x",
  AAA_New: { name: "New", manufacturer: "Acme", dims: { l: 20, b: 10, h: 5 } },
  BBB_Pub: { name: "Pub", manufacturer: "Acme", dims: { l: 30, b: 12, h: 6 } },
  CCC_ExtOnly: { name: "ExtOnly", manufacturer: "Acme", dims: { l: 15, b: 8, h: 4 } },
};
const INDEX = {
  patchVersion: "sc-4.1",
  ships: [
    { key: "BBB_Pub", variants: [{ level: "exterior" }, { level: "interior" }] },
    { key: "CCC_ExtOnly", variants: [{ level: "exterior" }] },
  ],
};

const find = (ships, k) => ships.find((s) => s.key === k);

test("non publié -> nouveau (absent en prod)", () => {
  const ships = analyzeShips({ meta: META, index: INDEX, baseline: {}, current: {} });
  assert.equal(find(ships, "AAA_New").status, "nouveau");
  assert.equal(find(ships, "AAA_New").toProcess, true);
});

test("publié, empreinte identique -> à jour (prod fait foi)", () => {
  const ships = analyzeShips({
    meta: META, index: INDEX,
    baseline: { BBB_Pub: "abc" }, current: { BBB_Pub: "abc" },
  });
  assert.equal(find(ships, "BBB_Pub").status, "à jour");
  assert.equal(find(ships, "BBB_Pub").toProcess, false);
});

test("publié, empreinte différente -> version modifiée", () => {
  const ships = analyzeShips({
    meta: META, index: INDEX,
    baseline: { BBB_Pub: "abc" }, current: { BBB_Pub: "xyz" },
  });
  assert.equal(find(ships, "BBB_Pub").status, "version modifiée");
  assert.equal(find(ships, "BBB_Pub").toProcess, true);
});

test("publié SANS baseline (prod manuelle) -> à jour, jamais modifié", () => {
  // même si une empreinte courante existe, l'absence de baseline = on adopte l'existant.
  const ships = analyzeShips({
    meta: META, index: INDEX,
    baseline: {}, current: { BBB_Pub: "xyz" },
  });
  assert.equal(find(ships, "BBB_Pub").status, "à jour");
  assert.equal(find(ships, "BBB_Pub").toProcess, false);
});

test("publié, empreinte courante inconnue (non scanné) -> à jour, pas de faux positif", () => {
  const ships = analyzeShips({
    meta: META, index: INDEX,
    baseline: { BBB_Pub: "abc" }, current: {},
  });
  assert.equal(find(ships, "BBB_Pub").status, "à jour");
});

test("intérieur manquant : seulement si visitable connu", () => {
  const withVis = analyzeShips({
    meta: META, index: INDEX, baseline: { CCC_ExtOnly: "a" }, current: { CCC_ExtOnly: "a" },
    visitableKeys: new Set(["CCC_ExtOnly"]),
  });
  assert.equal(find(withVis, "CCC_ExtOnly").status, "intérieur manquant");
  assert.equal(find(withVis, "CCC_ExtOnly").toProcess, true);

  // sans info visitable : pas de bruit « intérieur manquant » sur un ext-only.
  const noVis = analyzeShips({
    meta: META, index: INDEX, baseline: { CCC_ExtOnly: "a" }, current: { CCC_ExtOnly: "a" },
  });
  assert.equal(find(noVis, "CCC_ExtOnly").status, "à jour");
  assert.equal(find(noVis, "CCC_ExtOnly").toProcess, false);
});

test("modifié a priorité, mais intérieur manquant reste listé dans reasons", () => {
  const ships = analyzeShips({
    meta: META, index: INDEX,
    baseline: { CCC_ExtOnly: "a" }, current: { CCC_ExtOnly: "b" },
    visitableKeys: new Set(["CCC_ExtOnly"]),
  });
  const s = find(ships, "CCC_ExtOnly");
  assert.equal(s.status, "version modifiée");
  assert.ok(s.reasons.includes("intérieur manquant"));
});
