import { test, expect } from "vitest";
import { qaVerdicts, keysToVerify, canAnalyze } from "./qaGate";

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

test("keysToVerify : seulement les clés explicitement non conformes (pas les sans-verdict)", () => {
  const v = { A: true, B: false, C: true };
  // B non conforme -> signalé ; Z sans verdict -> PAS signalé (QA optionnelle) ; A/C conformes.
  expect(keysToVerify(["A", "B", "C", "Z"], v)).toEqual(["B"]);
});

test("keysToVerify : aucune QA lancée -> rien à signaler", () => {
  expect(keysToVerify(["A", "C"], {})).toEqual([]);
});

test("canAnalyze : vrai dès ≥1 clé — la QA ne bloque jamais", () => {
  expect(canAnalyze([])).toBe(false);           // aucune clé
  expect(canAnalyze(["A"])).toBe(true);          // conforme ou non, on peut analyser
  expect(canAnalyze(["A", "B", "Z"])).toBe(true); // non conformes/sans verdict : autorisé quand même
});
