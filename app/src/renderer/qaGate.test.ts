import { test, expect } from "vitest";
import { qaVerdicts, publishBlockers, canAnalyze } from "./qaGate";

test("qaVerdicts : conforme ssi 0 échec dur", () => {
  const v = qaVerdicts([
    { key: "A", hard: 0 },
    { key: "B", hard: 2 },
    { key: "C", hard: 0 },
  ]);
  expect(v).toEqual({ A: true, B: false, C: true });
});

test("qaVerdicts : liste vide -> record vide", () => {
  expect(qaVerdicts([])).toEqual({});
});

test("publishBlockers : clés non conformes OU sans verdict", () => {
  const v = { A: true, B: false, C: true };
  // B non conforme, Z sans verdict -> bloqueurs ; A et C passent
  expect(publishBlockers(["A", "B", "C", "Z"], v)).toEqual(["B", "Z"]);
});

test("publishBlockers : tout conforme -> aucun bloqueur", () => {
  expect(publishBlockers(["A", "C"], { A: true, B: false, C: true })).toEqual([]);
});

test("canAnalyze : vrai ssi ≥1 clé et aucun bloqueur", () => {
  const v = { A: true, B: false };
  expect(canAnalyze([], v)).toBe(false);         // aucune clé
  expect(canAnalyze(["A"], v)).toBe(true);       // conforme
  expect(canAnalyze(["A", "B"], v)).toBe(false); // B bloque
  expect(canAnalyze(["A", "Z"], v)).toBe(false); // Z sans verdict
});
