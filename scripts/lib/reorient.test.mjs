import { test } from "node:test";
import assert from "node:assert/strict";
import { reorientTurns, REORIENT } from "./reorient.mjs";

test("Clipper : 1 quart de tour (+Y90, nez sur Z) — reproduit l'etat publie", () => {
  assert.equal(reorientTurns("DRAK_Clipper"), 1);
});

test("clef inconnue : 0 (aucune reorientation = comportement par defaut)", () => {
  assert.equal(reorientTurns("AEGS_Avenger_Titan"), 0);
  assert.equal(reorientTurns("n_importe_quoi"), 0);
});

test("REORIENT est une table data-driven (une ligne par cas)", () => {
  assert.equal(typeof REORIENT, "object");
  assert.equal(REORIENT.DRAK_Clipper, 1);
});
