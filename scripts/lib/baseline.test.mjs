import { test } from "node:test";
import assert from "node:assert/strict";
import { adoptBaseline, publishedKeys } from "./baseline.mjs";

test("publishedKeys : clés ayant au moins une variante exterior", () => {
  const idx = { ships: [
    { key: "A", variants: [{ level: "exterior" }] },
    { key: "B", variants: [{ level: "interior" }] }, // pas d'exterior -> exclu
    { key: "C", variants: [{ level: "exterior" }, { level: "interior" }] },
  ] };
  assert.deepEqual(publishedKeys(idx).sort(), ["A", "C"]);
});

test("adoptBaseline : fixe l'empreinte des clés données, conserve le reste", () => {
  const prev = { A: "old", Z: "keep" };
  const cur = { A: "new", B: "b", C: "c" };
  const out = adoptBaseline(prev, cur, ["A", "B"]);
  assert.deepEqual(out, { A: "new", B: "b", Z: "keep" });
});

test("adoptBaseline : ignore une clé sans empreinte courante", () => {
  const out = adoptBaseline({}, { A: "a" }, ["A", "B"]);
  assert.deepEqual(out, { A: "a" }); // B absent de cur -> non ajouté
});

test("adoptBaseline : n'altère pas les objets d'entrée", () => {
  const prev = { A: "old" };
  const cur = { A: "new" };
  adoptBaseline(prev, cur, ["A"]);
  assert.deepEqual(prev, { A: "old" });
});
