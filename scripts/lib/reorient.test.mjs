import { test } from "node:test";
import assert from "node:assert/strict";
import { reorientTurns, REORIENT } from "./reorient.mjs";

test("Clipper : 1 quart de tour (+Y90, nez sur Z) — reproduit l'etat publie", () => {
  assert.equal(reorientTurns("DRAK_Clipper"), 1);
});

test("Reliant (base + variantes) : 1 quart de tour — l/b inverses a l'export (nez sur X)", () => {
  assert.equal(reorientTurns("MISC_Reliant"), 1);
  assert.equal(reorientTurns("MISC_Reliant_Mako"), 1);
  assert.equal(reorientTurns("MISC_Reliant_Sen"), 1);
  assert.equal(reorientTurns("MISC_Reliant_Tana"), 1);
});

test("Nova : PAS un cas de rotation (hauteur diverge aussi) -> 0", () => {
  // propre 13.3x21.9x5.7 vs reel 20x12x11 : la hauteur 5.7 vs 11 n'est corrigee par aucune rotation 90°.
  assert.equal(reorientTurns("TMBL_Nova"), 0);
});

test("clef inconnue : 0 (aucune reorientation = comportement par defaut)", () => {
  assert.equal(reorientTurns("AEGS_Avenger_Titan"), 0);
  assert.equal(reorientTurns("n_importe_quoi"), 0);
});

test("REORIENT est une table data-driven (une ligne par cas)", () => {
  assert.equal(typeof REORIENT, "object");
  assert.equal(REORIENT.DRAK_Clipper, 1);
});
