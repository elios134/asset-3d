import { test, expect } from "vitest";
import { initPublishKeys, addPublishKey, removePublishKey, publishCandidates, canPublish } from "./publishSelection";

test("initPublishKeys part des clés de session, dédupliquées", () => {
  expect(initPublishKeys(["A", "B", "A"])).toEqual(["A", "B"]);
  expect(initPublishKeys([])).toEqual([]);
});

test("addPublishKey ajoute une clé absente, immuable", () => {
  const a = ["A"];
  const b = addPublishKey(a, "B");
  expect(b).toEqual(["A", "B"]);
  expect(a).toEqual(["A"]); // immuable
});

test("addPublishKey ne duplique pas une clé déjà présente", () => {
  expect(addPublishKey(["A", "B"], "A")).toEqual(["A", "B"]);
});

test("addPublishKey ignore une clé vide", () => {
  expect(addPublishKey(["A"], "")).toEqual(["A"]);
});

test("removePublishKey retire une clé, immuable", () => {
  const a = ["A", "B", "C"];
  expect(removePublishKey(a, "B")).toEqual(["A", "C"]);
  expect(a).toEqual(["A", "B", "C"]);
});

test("removePublishKey sur clé absente = inchangé", () => {
  expect(removePublishKey(["A"], "Z")).toEqual(["A"]);
});

test("publishCandidates = clés catalogue non déjà sélectionnées, ordre préservé", () => {
  const all = ["A", "B", "C", "D"];
  expect(publishCandidates(all, ["B", "D"])).toEqual(["A", "C"]);
  expect(publishCandidates(all, [])).toEqual(["A", "B", "C", "D"]);
  expect(publishCandidates([], ["A"])).toEqual([]);
});

test("canPublish : vrai ssi au moins une clé", () => {
  expect(canPublish([])).toBe(false);
  expect(canPublish(["A"])).toBe(true);
});
