import { test } from "node:test";
import assert from "node:assert/strict";
import { Document } from "@gltf-transform/core";
import { rotateYVec, reorientDoc } from "./rotate-glb.mjs";

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const vecNear = (got, exp, eps = 1e-6) => got.every((v, i) => near(v, exp[i], eps));

// ---- rotateYVec : la rotation pure (N quarts de tour autour de +Y) ----

test("rotateYVec 1 tour : +X -> -Z (Y+90 standard)", () => {
  assert.ok(vecNear(rotateYVec(1, 1, 0, 0), [0, 0, -1]), JSON.stringify(rotateYVec(1, 1, 0, 0)));
});

test("rotateYVec 1 tour : +Z -> +X (l'extent Z devient X)", () => {
  assert.ok(vecNear(rotateYVec(1, 0, 0, 1), [1, 0, 0]), JSON.stringify(rotateYVec(1, 0, 0, 1)));
});

test("rotateYVec preserve l'axe Y (hauteur inchangee)", () => {
  assert.ok(vecNear(rotateYVec(1, 3, 5, -2), [-2, 5, -3]), JSON.stringify(rotateYVec(1, 3, 5, -2)));
});

test("rotateYVec 4 tours = identite", () => {
  const v = [7, -1.5, 3.2];
  assert.ok(vecNear(rotateYVec(4, ...v), v), JSON.stringify(rotateYVec(4, ...v)));
});

test("rotateYVec normalise turns negatifs/hors bornes (mod 4)", () => {
  assert.ok(vecNear(rotateYVec(-3, 1, 0, 0), rotateYVec(1, 1, 0, 0)));
  assert.ok(vecNear(rotateYVec(5, 0, 0, 1), rotateYVec(1, 0, 0, 1)));
});

// ---- reorientDoc : comportement en ESPACE-MONDE (le contrat lu par generate-floor / qa / le loader) ----

// helper : matrice-monde d'un noeud (produit des matrices ancetres), comme wm() de build-clay/generate-floor
function makeDoc(positions, normals) {
  const doc = new Document();
  const buf = doc.createBuffer();
  const pos = doc.createAccessor().setType("VEC3").setArray(new Float32Array(positions)).setBuffer(buf);
  const prim = doc.createPrimitive().setAttribute("POSITION", pos);
  if (normals) prim.setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(normals)).setBuffer(buf));
  const node = doc.createNode().setMesh(doc.createMesh().addPrimitive(prim));
  doc.createScene().addChild(node);
  return doc;
}

const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };

// bbox MONDE : applique la matrice-monde de chaque noeud-mesh aux positions
function worldBbox(doc) {
  const nodes = doc.getRoot().listNodes();
  const pm = new Map(); for (const n of nodes) for (const c of n.listChildren()) pm.set(c, n);
  const wm = (n) => { let m = n.getMatrix(), p = pm.get(n), d = 0; while (p && d < 200) { m = mul(p.getMatrix(), m); p = pm.get(p); d++; } return m; };
  let xn = Infinity, xx = -Infinity, zn = Infinity, zx = -Infinity, yn = Infinity, yx = -Infinity;
  const P = [0, 0, 0];
  for (const n of nodes) { const mesh = n.getMesh(); if (!mesh) continue; const M = wm(n);
    for (const pr of mesh.listPrimitives()) { const a = pr.getAttribute("POSITION"); const c = a.getCount();
      for (let i = 0; i < c; i++) { a.getElement(i, P); const x = M[0]*P[0]+M[4]*P[1]+M[8]*P[2]+M[12], y = M[1]*P[0]+M[5]*P[1]+M[9]*P[2]+M[13], z = M[2]*P[0]+M[6]*P[1]+M[10]*P[2]+M[14];
        xn = Math.min(xn, x); xx = Math.max(xx, x); yn = Math.min(yn, y); yx = Math.max(yx, y); zn = Math.min(zn, z); zx = Math.max(zx, z); } } }
  return { x: xx - xn, y: yx - yn, z: zx - zn };
}

test("reorientDoc 1 tour croise les extents X<->Z en monde (Clipper : X49.5/Z25.3 -> X25.3/Z49.5)", async () => {
  // brut StarBreaker : longueur 49.5 sur X, largeur 25.3 sur Z, hauteur 13.8 sur Y
  const doc = makeDoc([
    -24.75, -6.9, -12.65,   24.75, -6.9, -12.65,   24.75, 6.9, 12.65,   -24.75, 6.9, 12.65,
  ]);
  await reorientDoc(doc, 1);
  const b = worldBbox(doc);
  assert.ok(near(b.x, 25.3, 1e-3), `x extent ${b.x}`);
  assert.ok(near(b.z, 49.5, 1e-3), `z extent ${b.z}`);
  assert.ok(near(b.y, 13.8, 1e-3), `y extent ${b.y}`);
});

test("reorientDoc applique la rotation a TOUS les enfants racine de la scene", async () => {
  // deux noeuds racine distincts : les deux doivent tourner du meme quart de tour
  const doc = new Document();
  const buf = doc.createBuffer();
  const mk = (pts) => { const a = doc.createAccessor().setType("VEC3").setArray(new Float32Array(pts)).setBuffer(buf); return doc.createNode().setMesh(doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute("POSITION", a))); };
  const scene = doc.createScene();
  scene.addChild(mk([10, 0, 0, 10, 0, 0])); // point sur +X
  scene.addChild(mk([0, 0, 20, 0, 0, 20])); // point sur +Z
  await reorientDoc(doc, 1);
  const b = worldBbox(doc);
  // +X(10) -> -Z, +Z(20) -> +X : extent X domine par l'ancien Z (20), extent Z par l'ancien X (10)
  assert.ok(near(b.x, 20, 1e-3), `x extent ${b.x}`);
  assert.ok(near(b.z, 10, 1e-3), `z extent ${b.z}`);
});

test("reorientDoc 4 tours = identite geometrique (monde)", async () => {
  const doc = makeDoc([-24.75, -6.9, -12.65, 24.75, 6.9, 12.65]);
  const before = worldBbox(doc);
  await reorientDoc(doc, 4);
  const after = worldBbox(doc);
  assert.ok(near(before.x, after.x, 1e-3) && near(before.y, after.y, 1e-3) && near(before.z, after.z, 1e-3),
    `${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
});

test("reorientDoc turns=0 : no-op", async () => {
  const doc = makeDoc([-24.75, -6.9, -12.65, 24.75, 6.9, 12.65]);
  const before = worldBbox(doc);
  await reorientDoc(doc, 0);
  const after = worldBbox(doc);
  assert.deepEqual(before, after);
});
