import { test, expect } from "vitest";
import { initQaState, qaReducer } from "./qaReducer";

test("init : aucune ligne, running=true, pas de summary", () => {
  const s = initQaState();
  expect(s.running).toBe(true);
  expect(s.rows).toEqual([]);
  expect(s.summary).toBeNull();
});

test("ship : mappe hard/warns vers pass/warn/fail et empile la ligne", () => {
  let s = initQaState();
  s = qaReducer(s, { type: "ship", key: "A", name: "Alpha", hard: 0, warns: 0, messages: [] });
  s = qaReducer(s, { type: "ship", key: "B", name: "Bravo", hard: 0, warns: 2, messages: ["m"] });
  s = qaReducer(s, { type: "ship", key: "C", name: "Charlie", hard: 1, warns: 0, messages: ["dépasse"] });
  expect(s.rows.map((r) => r.status)).toEqual(["pass", "warn", "fail"]);
  expect(s.rows.find((r) => r.key === "C")!.messages).toEqual(["dépasse"]);
});

test("result : fige le summary et running=false", () => {
  let s = initQaState();
  s = qaReducer(s, { type: "ship", key: "A", name: "Alpha", hard: 1, warns: 0, messages: ["x"] });
  s = qaReducer(s, { type: "result", conforme: false, ships: 1, hard: 1, warns: 0 });
  expect(s.running).toBe(false);
  expect(s.summary).toEqual({ conforme: false, ships: 1, hard: 1, warns: 0 });
});

test("startFatal : libère le panneau (running=false) et journalise l'erreur", () => {
  let s = initQaState();
  s = qaReducer(s, { type: "startFatal", err: "boom" });
  expect(s.running).toBe(false);
  expect(s.log.at(-1)).toContain("boom");
  expect(s.summary).toBeNull();
});
