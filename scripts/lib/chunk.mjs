// chunk.mjs — CHUNKER partagé (build-clay / build-hd), contrat « bulle » de l'app : segmente la géométrie
// visuelle en cellules spatiales de `cell` m. On PRÉSERVE l'instancing (StarBreaker répète lourdement
// rambardes/panneaux/props ; baker = x2-3 la taille) : flatten() bake les transforms parents dans le matrix
// LOCAL de chaque nœud-mesh (hiérarchie plate, meshes toujours PARTAGÉS) puis on REPARENTE chaque nœud-mesh
// sous un chunk `chunk_gx_gy_gz` selon le centroïde MONDE de sa bbox. Chunk = transform identité ; l'enfant
// garde son matrix (= monde). L'app calcule la Box3 tight par chunk et toggle sa visibilité. HORS chunks :
// portes (isDoorFn) + specials ajoutés APRÈS (shell/collision_walk/spawn_point/floor_patch).
// Pas de join/simplify -> détail max, fichier léger (instancing conservé).
import { flatten } from "@gltf-transform/functions";

const ap = (m, x, y, z) => [m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]];

const docTris = (doc) => {
  let t = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const a = p.getIndices() ?? p.getAttribute("POSITION"); const c = a ? a.getCount() : 0;
    t += p.getMode() === 4 ? Math.floor(c / 3) : Math.max(0, c - 2);
  }
  return t;
};

/** Cellule d'un point monde (`gx_gy_gz`, cellules de `cell` m). */
export const chunkKey = (x, y, z, cell) => `${Math.floor(x / cell)}_${Math.floor(y / cell)}_${Math.floor(z / cell)}`;

export const chunkVisual = async (doc, cell, isDoorFn) => {
  await doc.transform(flatten()); // noeuds-mesh -> enfants directs de la scene, transform monde bakee en local
  const root = doc.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  const chunks = new Map(); const P = [0, 0, 0];
  const targets = root.listNodes().filter((n) => n.getMesh() && !isDoorFn(n.getName() || "") && !isDoorFn(n.getMesh().getName() || ""));
  for (const node of targets) {
    const M = node.getMatrix(); // = monde (post-flatten)
    const mesh = node.getMesh(); let xn = 1/0, yn = 1/0, zn = 1/0, xx = -1/0, yx = -1/0, zx = -1/0;
    for (const pr of mesh.listPrimitives()) { const a = pr.getAttribute("POSITION"); if (!a) continue; const c = a.getCount(); const step = Math.max(1, Math.floor(c / 24)); for (let i = 0; i < c; i += step) { a.getElement(i, P); if (P[0]<xn)xn=P[0]; if (P[1]<yn)yn=P[1]; if (P[2]<zn)zn=P[2]; if (P[0]>xx)xx=P[0]; if (P[1]>yx)yx=P[1]; if (P[2]>zx)zx=P[2]; } }
    if (!isFinite(xn)) continue;
    const wc = ap(M, (xn+xx)/2, (yn+yx)/2, (zn+zx)/2); // centroide monde de la bbox locale
    const key = chunkKey(wc[0], wc[1], wc[2], cell);
    let cn = chunks.get(key); if (!cn) { cn = doc.createNode(`chunk_${key}`); scene.addChild(cn); chunks.set(key, cn); }
    scene.removeChild(node); cn.addChild(node); // instancing preserve (mesh partage inchange)
  }
  return { nChunks: chunks.size, nTris: docTris(doc) };
};
