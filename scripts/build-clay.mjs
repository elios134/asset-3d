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

const keys = Object.keys(meta).filter((k) => k !== "_comment" && meta[k].dims?.l);
let batch;
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (process.argv.includes("--all")) batch = habitable ? keys.filter((k) => habitable.has(k)) : keys;
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
  if (t > TRIS * 1.5) { await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.max(0.05, TRIS / t), error: 0.03, lockBorder: false })); t = docTris(doc); }
  return t;
};
// bug gltf-transform 4.4.1 : reorder+quantize (interne meshopt) corrompt les accessors PARTAGES entre
// prims -> donner a chaque prim son clone avant meshopt ; le dedup de quantize re-fusionne (cout nul).
const unshareAccessors = (doc) => { const seen = new Set(); for (const mesh of doc.getRoot().listMeshes()) for (const pr of mesh.listPrimitives()) { for (const sem of pr.listSemantics()) { const a = pr.getAttribute(sem); if (!a) continue; if (seen.has(a)) pr.setAttribute(sem, a.clone()); else seen.add(a); } const idx = pr.getIndices(); if (idx) { if (seen.has(idx)) pr.setIndices(idx.clone()); else seen.add(idx); } } };
const compress = async (doc) => { await doc.transform(dedup(), unpartition()); unshareAccessors(doc); await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "high" })); };

const results = [];
console.log(`Pipeline CLAY : ${batch.length} vaisseaux (tris<=${TRIS}, ceil=${CEIL})\n`);
for (const key of batch) {
  const l = meta[key]?.dims?.l ?? 25;
  const extOut = join(MODELS, `${key}.clay-exterior.glb`);
  const intOut = join(MODELS, `${key}.clay-interior.glb`);
  const tmpExt = join(MODELS, `_c_${key}_ext.glb`), tmpInt = join(MODELS, `_c_${key}_int.glb`);
  const tmpIntClay = join(MODELS, `_c_${key}_intclay.glb`), tmpFloor = join(MODELS, `_c_${key}_floor.glb`);
  const cleanup = () => { for (const f of [tmpExt, tmpInt, tmpIntClay, tmpFloor, tmpInt.replace(/\.glb$/, ".fixed.glb")]) if (existsSync(f)) rmSync(f); };
  try {
    // 1) EXTERIEUR clay (sert aussi de reference coque pour le cull interieur : noms de nodes)
    exp(key, tmpExt, ["--no-interior", "--no-attachments", "--lod", "1"]);
    const extDoc = await io.read(tmpExt);
    const hullNames = new Set(); for (const n of extDoc.getRoot().listNodes()) if (n.getMesh()) hullNames.add(n.getName() || "");
    const hull = getBounds(extDoc.getRoot().listScenes()[0]);
    toClay(extDoc);
    await extDoc.transform(dedup(), prune(), flatten(), joinPrims());
    const extTris = await simplifyTo(extDoc);
    await compress(extDoc);
    await io.write(extOut, extDoc);

    // 2) INTERIEUR clay
    const lod = INT_LOD_OVERRIDE != null ? INT_LOD_OVERRIDE : intLod(l);
    exp(key, tmpInt, ["--lod", String(lod)]);
    let intPath = tmpInt;
    if (anchored.has(key)) { const fx = tmpInt.replace(/\.glb$/, ".fixed.glb"); execFileSync("node", ["scripts/reposition-interior.mjs", tmpInt, fx, `--key=${key}`], { cwd: ROOT, stdio: "ignore" }); intPath = fx; }
    const intDoc = await io.read(intPath);

    // cull coque ext leakee (identite de node ; setMesh(null) preserve la hierarchie, prune apres)
    let culledHull = 0;
    for (const node of intDoc.getRoot().listNodes()) if (node.getMesh() && hullNames.has(node.getName() || "")) { node.setMesh(null); culledHull++; }

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
    await intDoc.transform(dedup(), prune(), flatten(), joinPrims({ keepNamed: true }));
    const intTris = await simplifyTo(intDoc);
    await intDoc.transform(prune());
    await io.write(tmpIntClay, intDoc);

    // 3) plancher collision_walk + spawn_point (generate-floor sur le clay interieur final)
    execFileSync("node", ["scripts/generate-floor.mjs", tmpIntClay, tmpFloor, `--lift=0`, `--ceil=${CEIL}`, `--clear=${CLEAR}`, `--cell=${CELL}`], { cwd: ROOT, stdio: "ignore" });
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
    console.log(`  ✓ ${key.padEnd(26)} ext ${mb(statSync(extOut).size)} (${extTris}t) · int ${mb(statSync(intOut).size)} (${intTris}t) · walk ${walkTris}t${spawn ? " +spawn" : ""}${culledHull ? ` · coque-${culledHull}` : ""}`);
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
