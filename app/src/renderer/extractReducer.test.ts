import { test, expect } from "vitest";
import { initExtractState, extractReducer } from "./extractReducer";
import type { ExtractItem } from "../shared/types";

const items: ExtractItem[] = [
  { key: "A", name: "Alpha", lengthM: 30, wantExterior: true, wantInterior: false },
  { key: "B", name: "Bravo", lengthM: 240, wantExterior: false, wantInterior: true },
];

test("init : toutes les lignes en pending, running=true", () => {
  const s = initExtractState(items);
  expect(s.running).toBe(true);
  expect(s.rows.map((r) => r.status)).toEqual(["pending", "pending"]);
});

test("progress start→done marque la ligne, skip et error aussi", () => {
  let s = initExtractState(items);
  s = extractReducer(s, { type: "progress", key: "A", step: "start" });
  expect(s.rows.find((r) => r.key === "A")!.status).toBe("running");
  s = extractReducer(s, { type: "progress", key: "A", step: "done" });
  expect(s.rows.find((r) => r.key === "A")!.status).toBe("done");
  s = extractReducer(s, { type: "progress", key: "B", step: "skip", reason: "capital" });
  const b = s.rows.find((r) => r.key === "B")!;
  expect(b.status).toBe("skip");
  expect(b.detail).toBe("capital");
});

test("result fige le summary et running=false ; cancelled marque l'état", () => {
  let s = initExtractState(items);
  s = extractReducer(s, { type: "result", ok: 1, ko: 0, skipped: 1 });
  expect(s.running).toBe(false);
  expect(s.summary).toEqual({ ok: 1, ko: 0, skipped: 1, cancelled: false });
  s = extractReducer(initExtractState(items), { type: "cancelled", doneCount: 1 });
  expect(s.cancelled).toBe(true);
  expect(s.running).toBe(false);
});

test("startFatal (rejet de startExtract avant tout événement) libère le panneau : running=false et erreur journalisée", () => {
  const s = extractReducer(initExtractState(items), { type: "startFatal", err: "Une extraction est déjà en cours." });
  expect(s.running).toBe(false); // condition pour que le bouton "Fermer" s'affiche
  expect(s.log.at(-1)).toContain("Une extraction est déjà en cours.");
  // aucune ligne n'est modifiée : l'échec est global, pas rattaché à un vaisseau précis
  expect(s.rows.map((r) => r.status)).toEqual(["pending", "pending"]);
});
