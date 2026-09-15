#!/usr/bin/env node
// rotate-glb.mjs — reoriente un glb par N quarts de tour autour de +Y (recette de reorientation).
//
// Pourquoi : certains exports StarBreaker sortent avec la LONGUEUR sur X alors que la convention du
// catalogue (qa.mjs) attend longueur sur Z / largeur sur X. Le DRAK_Clipper en est le cas : brut =
// l49.5 sur X / b25.3 sur Z ; publie = tourne Y+90 (nez sur Z). Ce post-traitement etait fait a la
// MAIN hors depot (commit de8f3a3, "re-uploade nez sur Z, pas de regen") -> non reproductible par le
// pipeline. Ce script le rend reproductible et data-driven (build-clay: table REORIENT).
//
// La rotation est appliquee comme un TRANSFORM prefixe a chaque enfant racine de la scene (pas de bake
// dans les sommets) -> l'instancing (rails/panneaux repetes des interieurs) est preserve, et wm()/lm()
// de generate-floor + qa, ainsi que le loader glTF de l'app, l'honorent. Les flatten()/join() de
// build-clay le folderont normalement ensuite.
//
// Usage : node scripts/rotate-glb.mjs <in.glb> <out.glb> [--turns=1]   (1 = +90, 2 = 180, 3 = -90)

// N quarts de tour autour de +Y, sur un vecteur. Trig ENTIERE (0/±1) -> exact, 4 tours = identite stricte.
export function rotateYVec(turns, x, y, z) {
  const t = ((turns % 4) + 4) % 4;
  switch (t) {
    case 1: return [z, y, -x];   // +90
    case 2: return [-x, y, -z];  // 180
    case 3: return [-z, y, x];   // -90
    default: return [x, y, z];   // 0
  }
}

// produit de matrices 4x4 colonne-major (convention glTF / build-clay)
const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };

// matrice de rotation +Y de N quarts de tour, colonne-major, coefficients exacts (c,s ∈ {0,±1})
function rotYMatrix(turns) {
  const t = ((turns % 4) + 4) % 4;
  const c = [1, 0, -1, 0][t], s = [0, 1, 0, -1][t];
  return [c, 0, -s, 0,  0, 1, 0, 0,  s, 0, c, 0,  0, 0, 0, 1];
}

// Reoriente un Document EN PLACE : prefixe la rotation a chaque enfant racine de la scene.
// turns normalise mod 4 ; turns=0 = no-op. Retourne le doc.
export function reorientDoc(doc, turns) {
  if (((turns % 4) + 4) % 4 === 0) return doc;
  const R = rotYMatrix(turns);
  for (const scene of doc.getRoot().listScenes()) {
    for (const node of scene.listChildren()) {
      node.setMatrix(mul(R, node.getMatrix()));
    }
  }
  return doc;
}

// --- CLI ---
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("rotate-glb.mjs")) {
  const args = process.argv.slice(2);
  const inPath = args[0], outPath = args[1];
  const turnsArg = args.find((a) => a.startsWith("--turns="));
  const turns = turnsArg ? parseInt(turnsArg.split("=")[1], 10) : 1;
  if (!inPath || !outPath) { console.error("usage: rotate-glb.mjs <in.glb> <out.glb> [--turns=1]"); process.exit(1); }
  const { NodeIO } = await import("@gltf-transform/core");
  const { ALL_EXTENSIONS } = await import("@gltf-transform/extensions");
  const { MeshoptEncoder, MeshoptDecoder } = await import("meshoptimizer");
  await MeshoptEncoder.ready; await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
  const doc = await io.read(inPath);
  reorientDoc(doc, turns);
  await io.write(outPath, doc);
  console.log(`rotate-glb : ${turns} quart(s) de tour +Y -> ${outPath}`);
}
