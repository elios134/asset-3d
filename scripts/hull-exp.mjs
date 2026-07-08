// Experimentation recette collision_hull : trouve weld+simplify qui reduit vraiment (~100-150k tris)
// en restant watertight-ish. Lit un _c_KEY_pre.glb (interieur clay PRE-chunk garde via --keep-pre).
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, flatten, join as joinPrims, simplify, weld, getBounds } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from "meshoptimizer";

await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
const src = process.argv[2];
const docTris = (doc) => { let t = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const a = p.getIndices() ?? p.getAttribute("POSITION"); t += a ? Math.floor(a.getCount() / 3) : 0; } return t; };
const DOOR = /door|hatch/i;

// base commune : retirer portes, anonymiser, flatten+join (une seule geo bakee)
async function base() {
  const doc = await io.read(src);
  for (const n of doc.getRoot().listNodes()) if (DOOR.test(n.getName() || "") && n.getMesh()) n.dispose();
  for (const n of doc.getRoot().listNodes()) n.setName("");
  for (const m of doc.getRoot().listMeshes()) m.setName("");
  // STRIP normales : un collider n'en a pas besoin, ET weld refuse de fusionner des sommets coincidents
  // aux normales differentes (facettes clay) -> soupe de triangles non-reductible. Position seule = weld
  // reconnecte les shells -> simplify efficace.
  for (const mesh of doc.getRoot().listMeshes()) for (const pr of mesh.listPrimitives()) for (const sem of pr.listSemantics()) if (sem !== "POSITION") pr.setAttribute(sem, null);
  await doc.transform(dedup(), prune(), flatten(), joinPrims());
  return doc;
}

const TARGET = 120000;
const bstr = (b) => `[${b.min.map((v)=>v.toFixed(1))}]..[${b.max.map((v)=>v.toFixed(1))}] (${(b.max[0]-b.min[0]).toFixed(1)}x${(b.max[1]-b.min[1]).toFixed(1)}x${(b.max[2]-b.min[2]).toFixed(1)})`;
const ref = await base();
const b0 = getBounds(ref.getRoot().listScenes()[0]);
console.log(`BOUNDS source : ${bstr(b0)}`);
const trials = [
  { lock: true, error: 0.05 },
  { lock: false, error: 0.05 },
];
for (const tr of trials) {
  const doc = await base();
  const t0 = docTris(doc);
  await doc.transform(weld({ tolerance: 0.01 }));
  const ratio = Math.max(0.005, TARGET / docTris(doc));
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: tr.error, lockBorder: tr.lock }));
  const tf = docTris(doc);
  const b = getBounds(doc.getRoot().listScenes()[0]);
  console.log(`lock=${tr.lock}  bake ${t0} -> simplify ${tf} (x${(t0/tf).toFixed(1)})  BOUNDS ${bstr(b)}`);
}
