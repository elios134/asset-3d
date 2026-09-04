import { test, expect, vi } from "vitest";
import { runExtract } from "./extract";
import type { ExtractItem, ExtractEvent } from "../shared/types";

const item = (p: Partial<ExtractItem> & { key: string }): ExtractItem => ({
  key: p.key, name: p.name ?? p.key, lengthM: p.lengthM ?? 30,
  wantExterior: p.wantExterior ?? false, wantInterior: p.wantInterior ?? false,
});

// faux runStream : émet un result "1 ok" et résout, sans spawner
const fakeRun = (script: string, args: string[], o: { onEvent: (e: ExtractEvent) => void }) => {
  o.onEvent({ type: "progress", key: args[0], step: "start" });
  o.onEvent({ type: "progress", key: args[0], step: "done" });
  return { done: Promise.resolve<ExtractEvent>({ type: "result", ok: 1, ko: 0, skipped: 0 }), kill: () => {} };
};

test("traite chaque vaisseau, skippe les capitaux, agrège le summary", async () => {
  const items = [
    item({ key: "MISC_Freelancer", wantInterior: true, lengthM: 38 }),
    item({ key: "AEGS_Idris_P", wantInterior: true, lengthM: 240 }), // capital -> skip
  ];
  const events: ExtractEvent[] = [];
  const s = await runExtract(items, {
    cwd: "/x", onEvent: (e) => events.push(e), isCancelled: () => false, run: fakeRun,
  });
  expect(s).toEqual({ ok: 1, ko: 0, skipped: 1, cancelled: false });
  expect(events.some((e) => e.type === "progress" && e.step === "skip" && e.key === "AEGS_Idris_P")).toBe(true);
});

test("annulation après le vaisseau en cours : stoppe la file, émet cancelled", async () => {
  const items = [item({ key: "A", wantExterior: true }), item({ key: "B", wantExterior: true })];
  const events: ExtractEvent[] = [];
  let calls = 0;
  const s = await runExtract(items, {
    cwd: "/x", onEvent: (e) => events.push(e), isCancelled: () => calls > 0,
    run: (sc, ar, o) => { calls++; return fakeRun(sc, ar, o); },
  });
  expect(calls).toBe(1); // B jamais lancé
  expect(s.cancelled).toBe(true);
  expect(events.some((e) => e.type === "cancelled")).toBe(true);
});
