// Banc d'essai recettes collision_hull : depuis un _c_KEY_pre.glb (--keep-pre), genere des candidats
// hull (weld+simplify params) en glb autonomes nommes collision_hull, a passer a verify-walk --hull=...
// usage: node scripts/hull-exp.mjs models/_c_KEY_pre.glb
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, flatten, join as joinPrims, simplify, weld } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from "meshoptimizer";

await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
const src = process.argv[2];
const docTris = (doc) => { let t = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const a = p.getIndices() ?? p.getAttribute("POSITION"); t += a ? Math.floor(a.getCount() / 3) : 0; } return t; };
const DOOR = /door|hatch/i;

async function base() {
  const doc = await io.read(src);
  for (const n of doc.getRoot().listNodes()) if (n.getMesh() && (DOOR.test(n.getName() || "") || DOOR.test(n.getMesh().getName() || ""))) n.dispose();
  for (const n of doc.getRoot().listNodes()) n.setName("");
  for (const m of doc.getRoot().listMeshes()) m.setName("");
  for (const mesh of doc.getRoot().listMeshes()) for (const pr of mesh.listPrimitives()) for (const sem of pr.listSemantics()) if (sem !== "POSITION") pr.setAttribute(sem, null);
  await doc.transform(dedup(), prune(), flatten(), joinPrims(), weld({ tolerance: 0.01 }));
  return doc;
}

const TARGET = 120000;
const trials = [
  { tag: "raw", simp: null },                          // welde seul, pas de simplify (borne haute)
  { tag: "lock-e003", simp: { error: 0.003, lockBorder: true } },
  { tag: "lock-e001", simp: { error: 0.001, lockBorder: true } },
  { tag: "free-e003", simp: { error: 0.003, lockBorder: false } },
  { tag: "free-e001", simp: { error: 0.001, lockBorder: false } },
];
for (const tr of trials) {
  const doc = await base();
  const t0 = docTris(doc);
  if (tr.simp) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.max(0.005, TARGET / t0), error: tr.simp.error, lockBorder: tr.simp.lockBorder }));
  const tf = docTris(doc);
  for (const n of doc.getRoot().listNodes()) if (n.getMesh()) n.setName("collision_hull");
  for (const m of doc.getRoot().listMeshes()) m.setName("collision_hull");
  const out = src.replace(/_pre\.glb$/, `_hull_${tr.tag}.glb`);
  await io.write(out, doc);
  console.log(`${tr.tag.padEnd(10)} ${t0} -> ${tf} tris  (${out.split(/[\\/]/).pop()})`);
}
