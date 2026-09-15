import { test, expect } from "vitest";
import { indexDiff, type IndexEntry, type DiffPlanRow } from "./indexDiff";

const cur: IndexEntry[] = [
  { key: "A", variants: [
    { level: "exterior", sha256: "aaa", sizeBytes: 100 },
    { level: "interior", sha256: "bbb", sizeBytes: 200 },
  ] },
  { key: "B", variants: [{ level: "exterior", sha256: "ccc", sizeBytes: 300 }] },
];

test("nouveau vaisseau (absent de l'index) : status new-ship, niveaux ajoutés", () => {
  const plan: DiffPlanRow[] = [{ key: "Z", level: "exterior", sha256: "zzz", sizeBytes: 50 }];
  const d = indexDiff(cur, plan, ["Z"]);
  expect(d).toEqual([
    { key: "Z", status: "new-ship", levels: [
      { level: "exterior", status: "added", oldSha: null, newSha: "zzz", oldSize: null, newSize: 50 },
    ] },
  ]);
});

test("variante modifiée (sha différent) : ship updated, niveau changed avec ancien+nouveau", () => {
  const plan: DiffPlanRow[] = [{ key: "A", level: "exterior", sha256: "AAA_new", sizeBytes: 111 }];
  const d = indexDiff(cur, plan, []);
  expect(d).toEqual([
    { key: "A", status: "updated", levels: [
      { level: "exterior", status: "changed", oldSha: "aaa", newSha: "AAA_new", oldSize: 100, newSize: 111 },
    ] },
  ]);
});

test("variante identique (même sha) : ship unchanged, niveau unchanged", () => {
  const plan: DiffPlanRow[] = [{ key: "B", level: "exterior", sha256: "ccc", sizeBytes: 300 }];
  const d = indexDiff(cur, plan, []);
  expect(d).toEqual([
    { key: "B", status: "unchanged", levels: [
      { level: "exterior", status: "unchanged", oldSha: "ccc", newSha: "ccc", oldSize: 300, newSize: 300 },
    ] },
  ]);
});

test("niveau ajouté à un vaisseau existant : ship updated, niveau added", () => {
  const plan: DiffPlanRow[] = [{ key: "B", level: "interior", sha256: "new-int", sizeBytes: 400 }];
  const d = indexDiff(cur, plan, []);
  expect(d).toEqual([
    { key: "B", status: "updated", levels: [
      { level: "interior", status: "added", oldSha: null, newSha: "new-int", oldSize: null, newSize: 400 },
    ] },
  ]);
});

test("un niveau changé + un inchangé sur le même vaisseau : ship updated", () => {
  const plan: DiffPlanRow[] = [
    { key: "A", level: "exterior", sha256: "AAA_new", sizeBytes: 111 },
    { key: "A", level: "interior", sha256: "bbb", sizeBytes: 200 },
  ];
  const d = indexDiff(cur, plan, []);
  expect(d).toEqual([
    { key: "A", status: "updated", levels: [
      { level: "exterior", status: "changed", oldSha: "aaa", newSha: "AAA_new", oldSize: 100, newSize: 111 },
      { level: "interior", status: "unchanged", oldSha: "bbb", newSha: "bbb", oldSize: 200, newSize: 200 },
    ] },
  ]);
});

test("ordre : une ligne par clé, dans l'ordre d'apparition du plan", () => {
  const plan: DiffPlanRow[] = [
    { key: "B", level: "exterior", sha256: "ccc", sizeBytes: 300 },
    { key: "Z", level: "exterior", sha256: "zzz", sizeBytes: 50 },
  ];
  const d = indexDiff(cur, plan, ["Z"]);
  expect(d.map((r) => r.key)).toEqual(["B", "Z"]);
});

test("plan vide : diff vide", () => {
  expect(indexDiff(cur, [], [])).toEqual([]);
});
