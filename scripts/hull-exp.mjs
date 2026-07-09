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

// le levier = budget de tris (le simplify est ratio-driven ; error 0.03 ne mord jamais a 120k).
// budget + genereux = jambages de portes moins deplaces = moins de pincement, au prix du BVH.
const trials = [120000, 200000, 300000, 450000];
for (const T of trials) {
  const doc = await base();
  const t0 = docTris(doc);
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.max(0.005, T / t0), error: 0.03, lockBorder: false }));
  const tf = docTris(doc);
  for (const n of doc.getRoot().listNodes()) if (n.getMesh()) n.setName("collision_hull");
  for (const m of doc.getRoot().listMeshes()) m.setName("collision_hull");
  const tag = `t${Math.round(T/1000)}`;
  const out = src.replace(/_pre\.glb$/, `_hull_${tag}.glb`);
  await io.write(out, doc);
  console.log(`${tag.padEnd(8)} cible ${T} -> ${tf} tris  (${out.split(/[\\/]/).pop()})`);
}
