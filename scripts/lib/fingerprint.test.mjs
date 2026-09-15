import { test } from "node:test";
import assert from "node:assert/strict";
import { normPath, parseLoadoutGeoms, parseP4kList, computeFingerprint } from "./fingerprint.mjs";

// ── normPath : casse/slashs unifiés, préfixe Data/ retiré ──
test("normPath : minuscule, slashs avant, sans préfixe data/", () => {
  assert.equal(normPath("Data\\Objects\\Ships\\A.cga"), "objects/ships/a.cga");
  assert.equal(normPath("objects/ships/a.cga"), "objects/ships/a.cga");
  assert.equal(normPath("Objects\\Ships\\A.cga"), "objects/ships/a.cga");
});

// ── parseLoadoutGeoms : extrait les geom= réels, ignore "-", dédoublonne, trie ──
test("parseLoadoutGeoms : chemins normalisés, uniques, triés ; ignore geom=-", () => {
  const txt = [
    "EntityClassDefinition.X [] geom=Objects\\Ships\\Hull.cga",
    "  Part_A [hp] geom=objects/ships/thruster.cga",
    "  Screen [hp] geom=-",
    "  Part_B [hp] geom=Objects\\Ships\\Thruster.cga", // doublon (casse) de thruster
  ].join("\n");
  assert.deepEqual(parseLoadoutGeoms(txt), [
    "objects/ships/hull.cga",
    "objects/ships/thruster.cga",
  ]);
});

test("parseLoadoutGeoms : aucune géométrie -> tableau vide", () => {
  assert.deepEqual(parseLoadoutGeoms("Root [] geom=-\n  Child [hp] geom=-"), []);
});

// ── parseP4kList : "chemin<TAB>taille" -> Map normalisée ──
test("parseP4kList : map chemin normalisé -> taille (number)", () => {
  const txt = "Data\\Objects\\Ships\\Hull.cga\t6335856\nData\\Objects\\Ships\\Thruster.cga\t1024\n";
  const m = parseP4kList(txt);
  assert.equal(m.get("objects/ships/hull.cga"), 6335856);
  assert.equal(m.get("objects/ships/thruster.cga"), 1024);
  assert.equal(m.size, 2);
});

test("parseP4kList : ignore lignes vides / sans taille", () => {
  const m = parseP4kList("Data\\A.cga\t10\n\nData\\B.cga\nData\\C.cga\t20\n");
  assert.equal(m.size, 2);
  assert.equal(m.get("a.cga"), 10);
  assert.equal(m.get("c.cga"), 20);
});

// ── computeFingerprint : hash stable, sensible à taille/ajout/retrait, insensible à l'ordre ──
test("computeFingerprint : déterministe et indépendant de l'ordre des geoms", () => {
  const sizes = new Map([["objects/a.cga", 100], ["objects/b.cga", 200]]);
  const f1 = computeFingerprint(["objects/a.cga", "objects/b.cga"], sizes);
  const f2 = computeFingerprint(["objects/b.cga", "objects/a.cga"], sizes);
  assert.equal(f1, f2);
  assert.match(f1, /^[0-9a-f]{16,}$/); // hex
});

test("computeFingerprint : change si une taille change", () => {
  const a = computeFingerprint(["objects/a.cga"], new Map([["objects/a.cga", 100]]));
  const b = computeFingerprint(["objects/a.cga"], new Map([["objects/a.cga", 101]]));
  assert.notEqual(a, b);
});

test("computeFingerprint : change si une géométrie est ajoutée/retirée", () => {
  const one = computeFingerprint(["objects/a.cga"], new Map([["objects/a.cga", 100]]));
  const two = computeFingerprint(["objects/a.cga", "objects/b.cga"], new Map([["objects/a.cga", 100], ["objects/b.cga", 50]]));
  assert.notEqual(one, two);
});

test("computeFingerprint : géométrie absente du p4k marquée (pas confondue avec taille 0)", () => {
  const missing = computeFingerprint(["objects/a.cga"], new Map());
  const zero = computeFingerprint(["objects/a.cga"], new Map([["objects/a.cga", 0]]));
  assert.notEqual(missing, zero);
});
