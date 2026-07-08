#!/usr/bin/env node
// build-clay.mjs — pipeline PIVOT « visite impression 3D resine » par vaisseau.
//
// Principe (valide sur le Cutlass, bout-en-bout in-app) : on abandonne les textures. Le rendu est un
// MATCAP procedural cote app -> la geometrie n'a besoin que de POSITION + NORMAL propres. Ca debloque un
// simplify agressif (plus de coutures UV qui bloquent) et un fichier leger. La collision est HYBRIDE :
// l'app collisionne le MESH VISUEL (murs + vraies marches/escaliers) PLUS un plancher genere collision_walk
// (filet qui bouche les trous plats). On emet aussi un noeud spawn_point (zone la plus degagee).
//
// EXTERIEUR : export --materials colors --no-interior --no-attachments -> toClay -> simplify -> KEY.clay-exterior.glb
// INTERIEUR : export --materials colors -> (reposition si ancre) -> cull coque ext leakee + strays ->
//   preserver noms de portes (l'app skippe leur collision par nom) -> toClay -> simplify(lockBorder) ->
//   generate-floor (collision_walk + spawn_point) -> merge -> KEY.clay-interior.glb
//   INVARIANT : collision_walk vide => ship SKIP (signale, exclu du lot jouable).
//
// Usage : node scripts/build-clay.mjs [KEY...]   |   node scripts/build-clay.mjs --all   (62 habitables)
//   --int-lod=N  force le LOD interieur   --ceil=5.0 --clear=1.9 --cell=0.5  passes a generate-floor
//   --tris=600000 budget tris post-simplify (ext et int)

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, flatten, join as joinPrims, simplify, unpartition, mergeDocuments, getBounds, meshopt, dequantize } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from "meshoptimizer";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = join(ROOT, "models");
const STARBREAKER = "C:/Users/andre/Documents/starbreaker/starbreaker.exe";
const P4K = "D:/Program Files/RSI Launcher/StarCitizen/LIVE/Data.p4k";
const meta = JSON.parse(readFileSync(join(ROOT, "ships.meta.json"), "utf8"));
const anchored = new Set(Object.keys(JSON.parse(readFileSync(join(ROOT, "interior-anchors.json"), "utf8"))).filter((k) => k !== "_comment"));
const tryReadJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const kindsFile = tryReadJson(join(ROOT, "interior-kinds.json"));
const habitable = kindsFile ? new Set(Object.entries(kindsFile.kinds).filter(([, v]) => v.kind === "habitable").map(([k]) => k)) : null;

const opt = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const INT_LOD_OVERRIDE = opt("int-lod", null) != null ? parseInt(opt("int-lod"), 10) : null;
const CEIL = opt("ceil", "5.0"), CLEAR = opt("clear", "1.9"), CELL = opt("cell", "0.5");
const TRIS = parseInt(opt("tris", "600000"), 10);
const PROP_MIN = parseFloat(opt("prop-min", "0.4")); // cull clutter cosmetique < Nm (gobelets/boulons/boutons ; 0 = off)
const SOFT = process.argv.includes("--soft"); // simplify DOUX : lockBorder seul, jamais la 2e passe (qui perce)
const OUT_TAG = opt("out-tag", ""); // suffixe fichier (ex. "soft" -> KEY.clay-soft-interior.glb) pour variantes hors-index
const CHUNK = process.argv.includes("--chunk"); // segmente la geo visuelle en chunks spatiaux (bulle app) ; pas de join/simplify
const CHUNK_SIZE = parseFloat(opt("chunk-size", "10")); // taille cellule chunk (m) — contrat app = 10
const EXT_ONLY = process.argv.includes("--ext-only"); // ne construire QUE l'exterieur clay (galerie resine ; ships sans interieur)
const MODULES = process.argv.includes("--modules"); // inclure les attachements (armes/propulseurs/tourelles) dans l'exterieur — bug StarBreaker corrige (placement OK)

const keys = Object.keys(meta).filter((k) => k !== "_comment" && meta[k].dims?.l);
let batch;
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (process.argv.includes("--all")) batch = (habitable && !EXT_ONLY) ? keys.filter((k) => habitable.has(k)) : keys; // ext-only --all = TOUS les ships (galerie resine)
else if (args.length) batch = args;
else { console.error("usage: build-clay.mjs [KEY...] | --all"); process.exit(1); }

await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
const mb = (b) => (b / 1048576).toFixed(1) + " Mo";
const docTris = (doc) => { let t = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const a = p.getIndices() ?? p.getAttribute("POSITION"); t += a ? Math.floor(a.getCount() / 3) : 0; } return t; };
const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const ap = (m, x, y, z) => [m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]];
const exp = (key, out, extra) => execFileSync(STARBREAKER, ["entity", "export", key, out, "--materials", "colors", "--mip", "4", ...extra], { env: { ...process.env, SC_DATA_P4K: P4K }, stdio: "ignore", timeout: 600000 });
const intLod = (l) => (l >= 30 ? 2 : 1);

// strip vers clay : ne garder que POSITION+NORMAL, un seul materiau gris (le matcap app ignore la couleur,
// mais un GLB exige un materiau ; un seul = fusion join() maximale). Les NORMALES d'origine sont conservees
// (elles portent les aretes dures/douces = facettes "resine" voulues ; on ne re-lisse PAS, ca applatirait).
const toClay = (doc) => {
  const root = doc.getRoot();
  const clay = doc.createMaterial("clay").setBaseColorFactor([0.4, 0.42, 0.45, 1]).setRoughnessFactor(1).setMetallicFactor(0);
  for (const mesh of root.listMeshes()) for (const pr of mesh.listPrimitives()) {
    for (const sem of pr.listSemantics()) if (sem !== "POSITION" && sem !== "NORMAL") pr.setAttribute(sem, null);
    pr.setMaterial(clay);
  }
  for (const t of root.listTextures()) t.dispose();
  for (const m of root.listMaterials()) if (m !== clay) m.dispose();
  for (const e of root.listExtensionsUsed()) if (e.extensionName !== "KHR_materials_unlit") { try { e.dispose(); } catch {} }
};
const simplifyTo = async (doc) => {
  let t = docTris(doc);
  if (t > TRIS) { await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.max(0.05, TRIS / t), error: 0.005, lockBorder: true })); t = docTris(doc); }
  // lockBorder bloque les interieurs ultra-fragmentes (milliers de shells separees = tout est un bord)
  // -> capitaux coinces a plusieurs M de tris (Ironclad 4.3M = 33 Mo + lag Visite). 2e passe SANS
  // lockBorder au-dessus de 1.5x budget : trous visuels mineurs acceptables (collision separee via
  // collision_walk, matcap masque) vs lag ingerable. Le plancher est genere APRES, sur ce mesh.
  if (!SOFT && t > TRIS * 1.5) { await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.max(0.05, TRIS / t), error: 0.03, lockBorder: false })); t = docTris(doc); }
  return t;
};
// bug gltf-transform 4.4.1 : reorder+quantize (interne meshopt) corrompt les accessors PARTAGES entre
// prims -> donner a chaque prim son clone avant meshopt ; le dedup de quantize re-fusionne (cout nul).
const unshareAccessors = (doc) => { const seen = new Set(); for (const mesh of doc.getRoot().listMeshes()) for (const pr of mesh.listPrimitives()) { for (const sem of pr.listSemantics()) { const a = pr.getAttribute(sem); if (!a) continue; if (seen.has(a)) pr.setAttribute(sem, a.clone()); else seen.add(a); } const idx = pr.getIndices(); if (idx) { if (seen.has(idx)) pr.setIndices(idx.clone()); else seen.add(idx); } } };
const compress = async (doc) => { await doc.transform(dedup(), unpartition()); unshareAccessors(doc); await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "high" })); };
const ap3 = (m, x, y, z) => [m[0]*x+m[4]*y+m[8]*z, m[1]*x+m[5]*y+m[9]*z, m[2]*x+m[6]*y+m[10]*z]; // 3x3 (normales, sans translation)

// CHUNKER (contrat bulle app) : segmente la geo visuelle en cellules spatiales de `cell` m. On PRESERVE
// l'instancing (StarBreaker repete lourdement rambardes/panneaux/props ; baker = x2-3 la taille) : flatten()
// bake les transforms parents dans le matrix LOCAL de chaque noeud-mesh (hierarchie plate, meshes toujours
// PARTAGES) puis on REPARENTE chaque noeud-mesh sous un chunk `chunk_gx_gy_gz` selon le centroide MONDE de
// sa bbox. Chunk = transform identite ; l'enfant garde son matrix (= monde). L'app calcule la Box3 tight par
// chunk et toggle sa visibilite. HORS chunks : portes (isDoorFn) + specials ajoutes APRES (shell/collision_
// walk/spawn_point/floor_patch). Pas de join/simplify -> detail max, fichier leger (instancing conserve).
const chunkVisual = async (doc, cell, isDoorFn) => {
  await doc.transform(flatten()); // noeuds-mesh -> enfants directs de la scene, transform monde bakee en local
  const root = doc.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  const chunks = new Map(); const P = [0,0,0];
  const targets = root.listNodes().filter((n) => n.getMesh() && !isDoorFn(n.getName() || "") && !isDoorFn(n.getMesh().getName() || ""));
  for (const node of targets) {
    const M = node.getMatrix(); // = monde (post-flatten)
    const mesh = node.getMesh(); let xn = 1/0, yn = 1/0, zn = 1/0, xx = -1/0, yx = -1/0, zx = -1/0;
    for (const pr of mesh.listPrimitives()) { const a = pr.getAttribute("POSITION"); if (!a) continue; const c = a.getCount(); const step = Math.max(1, Math.floor(c / 24)); for (let i = 0; i < c; i += step) { a.getElement(i, P); if (P[0]<xn)xn=P[0]; if (P[1]<yn)yn=P[1]; if (P[2]<zn)zn=P[2]; if (P[0]>xx)xx=P[0]; if (P[1]>yx)yx=P[1]; if (P[2]>zx)zx=P[2]; } }
    if (!isFinite(xn)) continue;
    const wc = ap(M, (xn+xx)/2, (yn+yx)/2, (zn+zx)/2); // centroide monde de la bbox locale
    const key = `${Math.floor(wc[0]/cell)}_${Math.floor(wc[1]/cell)}_${Math.floor(wc[2]/cell)}`;
    let cn = chunks.get(key); if (!cn) { cn = doc.createNode(`chunk_${key}`); scene.addChild(cn); chunks.set(key, cn); }
    scene.removeChild(node); cn.addChild(node); // instancing preserve (mesh partage inchange)
  }
  return { nChunks: chunks.size, nTris: docTris(doc) };
};

const results = [];
console.log(`Pipeline CLAY : ${batch.length} vaisseaux (tris<=${TRIS}, ceil=${CEIL})\n`);
for (const key of batch) {
  const l = meta[key]?.dims?.l ?? 25;
  const tagPart = OUT_TAG ? `${OUT_TAG}-` : "";
  const extOut = join(MODELS, `${key}.clay-${tagPart}exterior.glb`);
  const intOut = join(MODELS, `${key}.clay-${tagPart}interior.glb`);
  const tmpExt = join(MODELS, `_c_${key}_ext.glb`), tmpInt = join(MODELS, `_c_${key}_int.glb`);
  const tmpIntClay = join(MODELS, `_c_${key}_intclay.glb`), tmpFloor = join(MODELS, `_c_${key}_floor.glb`);
  const tmpPre = join(MODELS, `_c_${key}_pre.glb`); // interieur PRE-chunk (pour generer le plancher : le flatten degrade la couverture)
  const cleanup = () => { for (const f of [tmpExt, tmpInt, tmpIntClay, tmpFloor, tmpPre, tmpInt.replace(/\.glb$/, ".fixed.glb")]) if (existsSync(f)) rmSync(f); };
  try {
    // 1) EXTERIEUR clay (sert aussi de reference coque pour le cull interieur : noms de nodes)
    exp(key, tmpExt, ["--no-interior", ...(MODULES ? [] : ["--no-attachments"]), "--lod", "1"]);
    const extDoc = await io.read(tmpExt);
    const hullNames = new Set(); for (const n of extDoc.getRoot().listNodes()) if (n.getMesh()) hullNames.add(n.getName() || "");
    const hull = getBounds(extDoc.getRoot().listScenes()[0]);
    toClay(extDoc);
    await extDoc.transform(dedup(), prune(), flatten(), joinPrims());
    const extTris = await simplifyTo(extDoc);
    await compress(extDoc);
    await io.write(extOut, extDoc);

    // mode EXT_ONLY (galerie resine des ships sans interieur) : on s'arrete a l'exterieur
    if (EXT_ONLY) {
      if (existsSync(tmpExt)) rmSync(tmpExt);
      results.push({ key, ok: true, ext: statSync(extOut).size, int: 0, extTris, extOnly: true });
      console.log(`  ✓ ${key.padEnd(26)} ext ${mb(statSync(extOut).size)} (${extTris}t) [ext-only]`);
      continue;
    }

    // 2) INTERIEUR clay
    const lod = INT_LOD_OVERRIDE != null ? INT_LOD_OVERRIDE : intLod(l);
    exp(key, tmpInt, ["--lod", String(lod)]);
    let intPath = tmpInt;
    if (anchored.has(key)) { const fx = tmpInt.replace(/\.glb$/, ".fixed.glb"); execFileSync("node", ["scripts/reposition-interior.mjs", tmpInt, fx, `--key=${key}`], { cwd: ROOT, stdio: "ignore" }); intPath = fx; }
    const intDoc = await io.read(intPath);

    // INDICE SPAWN COCKPIT : position monde du siege pilote (hardpoint_seat_pilot / *_Seat_Pilot),
    // capturee AVANT les culls/prune (noeud vide -> sinon prune). Passee a generate-floor pour ancrer
    // spawn_point au cockpit (demande user : commencer pres du siege pilote, pas au centre d'un moteur).
    let spawnHint = null;
    {
      const nn = intDoc.getRoot().listNodes();
      const ppm = new Map(); for (const n of nn) for (const c of n.listChildren()) ppm.set(c, n);
      const wmSeat = (n) => { let m = n.getMatrix(), p = ppm.get(n), s = new Set([n]), d = 0; while (p && !s.has(p) && d < 200) { m = mul(p.getMatrix(), m); s.add(p); p = ppm.get(p); d++; } return m; };
      const seat = nn.find((n) => /seat_pilot/i.test(n.getName() || ""));
      if (seat) { const M = wmSeat(seat); spawnHint = `${M[12].toFixed(2)},${M[14].toFixed(2)}`; console.log(`  ⌖ ${key} : siege pilote @ (${M[12].toFixed(1)}, ${M[14].toFixed(1)}) -> indice spawn`); }
    }

    // cull coque ext leakee (identite de node ; setMesh(null) preserve la hierarchie, prune apres)
    let culledHull = 0;
    for (const node of intDoc.getRoot().listNodes()) if (node.getMesh() && hullNames.has(node.getName() || "")) { node.setMesh(null); culledHull++; }

    // cull MECANISMES EXTERIEURS leakes : train d'atterrissage + baies (RLG/FLG/MLG/NLG + BONE_*LG).
    // `--no-attachments` (ref coque) SKIP le train -> ses noms ne sont pas dans hullNames -> il leake dans
    // l'interieur en geometrie "porte batarde" mal placee (Carrack : RLG_Door_*, RLGB_Door_Hinge...).
    // Ce ne sont PAS des portes interieures (celles-la = mesh_door_*) -> on les retire du parcours.
    const EXT_MECH = /(^|_)(RLG|FLG|MLG|NLG)B?(_|$)|(^|_)BONE_[FRMN]LG/i;
    let culledMech = 0;
    for (const node of intDoc.getRoot().listNodes()) if (node.getMesh() && EXT_MECH.test(node.getName() || "")) { node.setMesh(null); culledMech++; }

    // cull strays : tout mesh qui deborde l'enveloppe ext de >2m (module englobant, debris flottant)
    const nodes = intDoc.getRoot().listNodes(); const pm = new Map(); for (const n of nodes) for (const c of n.listChildren()) pm.set(c, n);
    const wm = (n) => { let mm = n.getMatrix(), p = pm.get(n), seen = new Set([n]), d = 0; while (p && !seen.has(p) && d < 200) { mm = mul(p.getMatrix(), mm); seen.add(p); p = pm.get(p); d++; } return mm; };
    const candidates = []; let meshCount = 0; const PT = [0, 0, 0];
    for (const node of nodes) { const mesh = node.getMesh(); if (!mesh) continue; meshCount++; let xn=1/0,yn=1/0,zn=1/0,xx=-1/0,yx=-1/0,zx=-1/0; const M = wm(node); for (const pr of mesh.listPrimitives()) { const a = pr.getAttribute("POSITION"); if (!a) continue; const cn = a.getCount(); for (let i = 0; i < cn; i += 13) { a.getElement(i, PT); const w = ap(M, PT[0], PT[1], PT[2]); xn=Math.min(xn,w[0]);yn=Math.min(yn,w[1]);zn=Math.min(zn,w[2]);xx=Math.max(xx,w[0]);yx=Math.max(yx,w[1]);zx=Math.max(zx,w[2]); } } if (!isFinite(xn)) continue;
      const prot = Math.max(hull.min[0]-xn, xx-hull.max[0], hull.min[1]-yn, yx-hull.max[1], hull.min[2]-zn, zx-hull.max[2]);
      if (prot > 2) candidates.push(node); }
    if (candidates.length <= meshCount * 0.3) for (const n of candidates) n.setMesh(null);

    // cull CLUTTER COSMETIQUE : meshes minuscules (gobelets, bouteilles, boutons, boulons, cables) —
    // inutiles en visite clay/resine et responsables de millions de tris "confetti" (coques deconnectees
    // NON simplifiables par edge-collapse) sur les capitaux. Seuil = plus grande dimension de la bbox
    // MONDE du node. Les portes (>2m), sieges, consoles, murs, planchers passent le seuil -> intacts.
    if (PROP_MIN > 0) {
      let culledProp = 0;
      for (const node of nodes) { const mesh = node.getMesh(); if (!mesh) continue; let xn=1/0,yn=1/0,zn=1/0,xx=-1/0,yx=-1/0,zx=-1/0; const M = wm(node); for (const pr of mesh.listPrimitives()) { const a = pr.getAttribute("POSITION"); if (!a) continue; const cn = a.getCount(); for (let i = 0; i < cn; i += 7) { a.getElement(i, PT); const w = ap(M, PT[0], PT[1], PT[2]); xn=Math.min(xn,w[0]);yn=Math.min(yn,w[1]);zn=Math.min(zn,w[2]);xx=Math.max(xx,w[0]);yx=Math.max(yx,w[1]);zx=Math.max(zx,w[2]); } } if (!isFinite(xn)) continue;
        if (Math.max(xx-xn, yx-yn, zx-zn) < PROP_MIN) { node.setMesh(null); culledProp++; } }
      if (culledProp) console.log(`  ⌫ ${key} : ${culledProp} clutter <${PROP_MIN}m retires`);
    }

    // preserver les noms de PORTES (l'app skippe leur collision par nom) a travers flatten+join.
    // On garde visibles (repere) les vrais vantaux ; on anonymise tout le reste pour fusionner un max.
    // isDoor DOIT matcher EXACTEMENT la regex de skip-collision de l'app : /door|hatch/ SANS exclusion.
    // On preserve le nom des portes -> join() les garde en mesh SEPARE -> l'app les identifie et skippe
    // leur collision (passables + visibles). Les murs (int_bulkhead : ni "door" ni "hatch") sont
    // anonymises et fusionnes -> collisionnes par defaut = containment correct. Ne PAS exclure "bulkhead"
    // ici sinon le vantail drak_door_bulkhead.cga perd son nom, l'app le collisionne, il bloque le passage.
    const DOOR = /door|hatch/i;
    const isDoor = (nm) => DOOR.test(nm);
    const tag = (node, name) => { if (node.getMesh() && !isDoor(node.getName() || "")) node.setName(name); for (const c of node.listChildren()) tag(c, name); };
    for (const n of intDoc.getRoot().listNodes()) { const nm = n.getName() || ""; if (isDoor(nm)) tag(n, nm); }
    for (const n of intDoc.getRoot().listNodes()) if (!isDoor(n.getName() || "")) n.setName("");
    for (const m of intDoc.getRoot().listMeshes()) if (!isDoor(m.getName() || "")) m.setName("");

    toClay(intDoc);
    let intTris; let floorSrc = tmpIntClay;
    if (CHUNK) {
      // mode BULLE : segmentation spatiale, PAS de join/simplify (detail max). Portes hors chunks.
      await intDoc.transform(dedup(), prune());
      // FIX plancher : le generer sur la geo PRE-chunk (le flatten du chunker fait perdre ~la moitie de la
      // couverture ; positions monde identiques -> valide de generer avant). tmpPre = interieur non-chunke.
      await io.write(tmpPre, intDoc);
      floorSrc = tmpPre;
      const { nChunks, nTris } = await chunkVisual(intDoc, CHUNK_SIZE, isDoor);
      await intDoc.transform(prune());
      intTris = nTris;
      console.log(`  ▦ ${key} : ${nChunks} chunks de ${CHUNK_SIZE}m, ${nTris} tris (detail max, hors portes)`);
    } else {
      await intDoc.transform(dedup(), prune(), flatten(), joinPrims({ keepNamed: true }));
      intTris = await simplifyTo(intDoc);
      await intDoc.transform(prune());
    }
    await io.write(tmpIntClay, intDoc);

    // 3) plancher collision_walk + spawn_point (generate-floor). En mode chunk : sur la geo PRE-chunk.
    execFileSync("node", ["scripts/generate-floor.mjs", floorSrc, tmpFloor, `--lift=0`, `--ceil=${CEIL}`, `--clear=${CLEAR}`, `--cell=${CELL}`, ...(spawnHint ? [`--spawn-hint=${spawnHint}`] : [])], { cwd: ROOT, stdio: "ignore" });
    const fdoc = await io.read(tmpFloor);
    let walkTris = 0; for (const n of fdoc.getRoot().listNodes()) if (/collision_walk/i.test(n.getName() || "") && n.getMesh()) for (const p of n.getMesh().listPrimitives()) walkTris += Math.floor((p.getIndices()?.getCount() ?? 0) / 3);
    // INVARIANT : plancher vide => interieur inexploitable => SKIP (exclu du lot jouable)
    if (walkTris === 0) { if (existsSync(extOut)) rmSync(extOut); cleanup(); results.push({ key, ok: false, skip: true, err: "collision_walk vide (interieur non jouable)" }); console.log(`  ⊘ ${key.padEnd(26)} SKIP : collision_walk vide`); continue; }

    // 4) merge clay interieur + plancher (collision_walk + spawn_point) + SHELL OCCULTEUR -> intOut
    const main = await io.read(tmpIntClay);
    const mainScene = main.getRoot().getDefaultScene() || main.getRoot().listScenes()[0];
    const map = mergeDocuments(main, fdoc);
    for (const srcNode of fdoc.getRoot().listScenes()[0].listChildren()) { const d = map.get(srcNode); if (d) mainScene.addChild(d); }

    // SHELL OCCULTEUR (comme HD, comme le cobaye valide) : la coque ext bouche les trous vus de
    // l'interieur (montre la coque, pas le fond etoile) ET rend le vaisseau reconnaissable de dehors.
    // Regression corrigee : build-clay le mergeait pas -> retour user "on ne voit pas la coque + trous".
    // Source = clay-exterior (extOut, deja clay+simplifie). dequantize AVANT merge (extOut est meshopt-
    // quantize) sinon 2e quantization au compress final. Anonymiser (aucun nom door/hatch) + join +
    // nommer occluder_shell (contrat app : render-only, EXCLU du collider, matcap en mode clay).
    const shellDoc = await io.read(extOut);
    for (const n of shellDoc.getRoot().listNodes()) n.setName("");
    for (const m of shellDoc.getRoot().listMeshes()) m.setName("");
    await shellDoc.transform(dequantize(), prune(), flatten(), joinPrims());
    for (const n of shellDoc.getRoot().listNodes()) if (n.getMesh()) n.setName("occluder_shell");
    for (const m of shellDoc.getRoot().listMeshes()) m.setName("occluder_shell");
    const shellMap = mergeDocuments(main, shellDoc);
    for (const srcNode of shellDoc.getRoot().listScenes()[0].listChildren()) { const d = shellMap.get(srcNode); if (d) mainScene.addChild(d); }

    for (const s of main.getRoot().listScenes()) if (s !== mainScene) s.dispose();
    main.getRoot().setDefaultScene(mainScene);
    await compress(main);
    await io.write(intOut, main);

    cleanup();
    const spawn = main.getRoot().listNodes().some((n) => n.getName() === "spawn_point");
    results.push({ key, ok: true, ext: statSync(extOut).size, int: statSync(intOut).size, extTris, intTris, walkTris, spawn });
    console.log(`  ✓ ${key.padEnd(26)} ext ${mb(statSync(extOut).size)} (${extTris}t) · int ${mb(statSync(intOut).size)} (${intTris}t) · walk ${walkTris}t${spawn ? " +spawn" : ""}${culledHull ? ` · coque-${culledHull}` : ""}${culledMech ? ` · mech-${culledMech}` : ""}`);
  } catch (e) {
    cleanup();
    results.push({ key, ok: false, err: e.message.split("\n")[0] });
    console.log(`  ✗ ${key.padEnd(26)} ECHEC : ${e.message.split("\n")[0]}`);
  }
}
const ok = results.filter((r) => r.ok);
const tot = ok.reduce((s, r) => s + r.ext + r.int, 0);
console.log(`\n${ok.length}/${results.length} jouables. Total clay : ${mb(tot)} (moy ${mb(tot / (ok.length || 1))}/vaisseau)`);
const skipped = results.filter((r) => r.skip); if (skipped.length) console.log(`SKIP invariant (${skipped.length}) : ${skipped.map((r) => r.key).join(", ")}`);
const ko = results.filter((r) => !r.ok && !r.skip); if (ko.length) console.log(`Echecs (${ko.length}) : ${ko.map((r) => `${r.key} [${r.err}]`).join(", ")}`);
