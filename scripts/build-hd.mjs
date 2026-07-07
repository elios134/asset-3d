#!/usr/bin/env node
// build-hd.mjs — pipeline HD complet par vaisseau (texture WebP + shell occulteur).
//
// EXTERIEUR (silhouette texturee) : export --materials textures --no-attachments -> dedup + webp512 + meshopt.
// INTERIEUR : export --materials textures -> reposition (si table d'ancrage) -> cull strays -> dedup + webp1024
//   + meshopt -> FUSION de la silhouette exterieure (shell occulteur : les trous montrent la coque, pas les etoiles).
//
// Ecrit models/<key>.exterior.glb et models/<key>.interior.glb (remplace le flat). Robuste aux echecs.
// Usage : node scripts/build-hd.mjs [KEY...]      (defaut : batch test de 8 varies)
//         node scripts/build-hd.mjs --all

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, textureCompress, meshopt, mergeDocuments, unpartition, getBounds, flatten, join as joinPrims, simplify } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync, rmSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = join(ROOT, "models");
const STARBREAKER = "C:/Users/andre/Documents/starbreaker/starbreaker.exe";
const P4K = "D:/Program Files/RSI Launcher/StarCitizen/LIVE/Data.p4k";
const meta = JSON.parse(readFileSync(join(ROOT, "ships.meta.json"), "utf8"));
const anchored = new Set(Object.keys(JSON.parse(readFileSync(join(ROOT, "interior-anchors.json"), "utf8"))).filter((k) => k !== "_comment"));
const EXCLUDE = /\bwikelo\b|\bpyam\b|best in show|\bbis\d*\b|\bexecutive\b|\bexec\b/;
const isExcluded = (k) => EXCLUDE.test(`${meta[k]?.name ?? ""} ${k}`.replace(/_/g, " ").toLowerCase());
const GENERIC = /^(box|cube|plane|cylinder|sphere|cone|circle|icosphere|object|empty)[._]?\d+$/i;
// LOD adaptatif au budget (retour user : capitaux meconnaissables au LOD3 — Idris 42k tris pour 800k
// de budget). On tente le LOD le plus fin plausible et on retombe si le budget tris est depasse.
// Toute la flotte au LOD1 (retour user #3 : silhouette pas assez detaillee ; l'export detaille
// avec attachments est irreparable — StarBreaker double les translations de facon non uniforme,
// cf. test-halve-transforms.mjs). L'echelle retombe en LOD2/3 si budget depasse.
const extLods = () => [1, 2, 3];
const intLod = (l) => (l >= 30 ? 2 : 1); // capitaux inclus : LOD2 + simplify si depassement (LOD3 CIG = trous)
const BUDGET = JSON.parse(readFileSync(join(ROOT, "config.json"), "utf8")).budget;
// tris d'un GLB sur disque (JSON chunk seul, rapide)
const glbTris = (path) => {
  const buf = readFileSync(path);
  let off = 12, j = null;
  while (off < buf.length) { const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4), s = off + 8; if (type === 0x4e4f534a) { j = JSON.parse(buf.subarray(s, s + len).toString("utf8")); break; } off = s + len; }
  let t = 0;
  for (const m of j.meshes ?? []) for (const p of m.primitives ?? []) { const a = j.accessors[p.indices ?? p.attributes?.POSITION]; const c = a ? a.count : 0; t += (p.mode ?? 4) === 4 ? Math.floor(c / 3) : Math.max(0, c - 2); }
  return t;
};
// tris d'un Document en memoire
const docTris = (doc) => { let t = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const a = p.getIndices() ?? p.getAttribute("POSITION"); const c = a ? a.getCount() : 0; t += (p.getMode() === 4 ? Math.floor(c / 3) : Math.max(0, c - 2)); } return t; };

const EXT_ONLY = process.argv.includes("--exteriors-only");
const INT_ONLY = process.argv.includes("--interiors-only");
const tryReadJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const keys = Object.keys(meta).filter((k) => k !== "_comment" && !isExcluded(k) && meta[k].dims?.l);
// En mode --interiors-only --all, on ne batit que les interieurs HABITABLES (interior-kinds.json,
// kind==habitable) : les cockpits/buggies n'ont pas d'espace a visiter. Decision user (62/107).
const kindsFile = tryReadJson(join(ROOT, "interior-kinds.json"));
const habitable = kindsFile ? new Set(Object.entries(kindsFile.kinds).filter(([, v]) => v.kind === "habitable").map(([k]) => k)) : null;
let batch;
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (process.argv.includes("--all")) batch = INT_ONLY && habitable ? keys.filter((k) => habitable.has(k)) : keys;
else if (args.length) batch = args;
else { const s = keys.slice().sort((a, b) => meta[a].dims.l - meta[b].dims.l); batch = [...new Set(Array.from({ length: 8 }, (_, i) => s[Math.floor(i * (s.length - 1) / 7)]))]; }

await MeshoptEncoder.ready;
// TOUTES les extensions : les exports StarBreaker utilisent KHR_materials_transmission/ior/volume
// (verre) et KHR_texture_transform (tiling UV, ~la moitie des materiaux). Ne PAS les enregistrer
// = suppression silencieuse a l'ecriture -> vitres opaques + UV casses ("textures bizarres").
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
// ...sauf les lumieres : 2181 KHR_lights_punctual sur le Carrack, three.js ne survivrait pas.
const stripLights = (doc) => { for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === "KHR_lights_punctual") e.dispose(); };
const exp = (key, out, extra) => execFileSync(STARBREAKER, ["entity", "export", key, out, "--materials", "textures", "--mip", "4", ...extra], { env: { ...process.env, SC_DATA_P4K: P4K }, stdio: "ignore", timeout: 600000 });
const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const ap = (m, x, y, z) => [m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]];

const results = [];
console.log(`Pipeline HD : ${batch.length} vaisseaux\n`);
for (const key of batch) {
  const m = meta[key], l = m.dims?.l ?? 25; // defaut 25m si dims absentes (ships sans cote ShipData)
  const extOut = join(MODELS, `${key}.exterior.glb`), intOut = join(MODELS, `${key}.interior.glb`);
  const tmpExt = join(MODELS, `_hd_${key}_ext.glb`), tmpInt = join(MODELS, `_hd_${key}_int.glb`);
  try {
    let hull;
    // 1) EXTERIEUR silhouette texturee (sauf --interiors-only)
    if (!INT_ONLY) {
      // echelle de LODs : le plus fin qui tient dans le budget tris
      let extLodUsed = null;
      for (const lod of extLods(l)) {
        exp(key, tmpExt, ["--no-interior", "--no-attachments", "--lod", String(lod)]);
        extLodUsed = lod;
        if (glbTris(tmpExt) <= BUDGET.exterior.maxTris) break;
      }
      const extDoc = await io.read(tmpExt);
      stripLights(extDoc);
      await extDoc.transform(dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [512, 512], quality: 80 }), meshopt({ encoder: MeshoptEncoder, level: "high" }));
      await io.write(extOut, extDoc);
      hull = getBounds(extDoc.getRoot().listScenes()[0]);
    }
    if (EXT_ONLY) {
      if (existsSync(tmpExt)) rmSync(tmpExt);
      results.push({ key, ok: true, ext: statSync(extOut).size, int: 0 });
      console.log(`  ✓ ${key.padEnd(28)} ext ${mb(statSync(extOut).size)}`);
      continue;
    }
    // reference coque/shell = exterieur (existant si --interiors-only)
    if (INT_ONLY) hull = getBounds((await io.read(extOut)).getRoot().listScenes()[0]);

    // 2) INTERIEUR texture -> reposition (si ancre) -> cull strays -> webp -> shell
    exp(key, tmpInt, ["--lod", String(intLod(l))]);
    let intPath = tmpInt;
    if (anchored.has(key)) { const fx = tmpInt.replace(/\.glb$/, ".fixed.glb"); execFileSync("node", ["scripts/reposition-interior.mjs", tmpInt, fx, `--key=${key}`], { cwd: ROOT, stdio: "ignore" }); intPath = fx; }
    const intDoc = await io.read(intPath);
    stripLights(intDoc);
    // cull strays (generique/anonyme, loin hors coque) — bbox manuelle cycle-safe
    const nodes = intDoc.getRoot().listNodes(); const pm = new Map(); for (const n of nodes) for (const c of n.listChildren()) pm.set(c, n);
    const wm = (n) => { let mm = n.getMatrix(), p = pm.get(n), seen = new Set([n]), d = 0; while (p && !seen.has(p) && d < 200) { mm = mul(p.getMatrix(), mm); seen.add(p); p = pm.get(p); d++; } return mm; };
    for (const node of nodes) { const mesh = node.getMesh(); if (!mesh) continue; let xn=1/0,yn=1/0,zn=1/0,xx=-1/0,yx=-1/0,zx=-1/0; for (const pr of mesh.listPrimitives()) { const a = pr.getAttribute("POSITION"); if (!a) continue; const mn = a.getMinNormalized([]), mx = a.getMaxNormalized([]); if (!mn) continue; const M = wm(node); for (const c of [[mn[0],mn[1],mn[2]],[mx[0],mx[1],mx[2]],[mn[0],mx[1],mn[2]],[mx[0],mn[1],mx[2]]]) { const w = ap(M, ...c); xn=Math.min(xn,w[0]);yn=Math.min(yn,w[1]);zn=Math.min(zn,w[2]);xx=Math.max(xx,w[0]);yx=Math.max(yx,w[1]);zx=Math.max(zx,w[2]); } } if (!isFinite(xn)) continue; const over = Math.max(hull.min[0]-xx, xn-hull.max[0], hull.min[1]-yx, yn-hull.max[1], hull.min[2]-zx, zn-hull.max[2]); const nm = node.getName() || "";
      // cull 1 : generique/anonyme ET loin hors coque (>10m, critere historique prudent)
      if (over > 10 && (!nm || /^[?]/.test(nm) || GENERIC.test(nm))) { node.dispose(); continue; }
      // cull 2 : ENTIEREMENT disjoint de la coque (>2m de separation), quel que soit le nom — de la
      // geometrie INTERIEURE totalement hors coque est defective par construction (bloc sombre flottant
      // vu par l'user ; la lecon 350r ne vaut que pour l'exterieur ou depasser est legitime)
      if (over > 2) node.dispose(); }
    // Preserver les PORTES du join : l'app les masque/rend franchissables PAR NOM (isSkippedTree).
    // 1) propager le token porte des groupes (Anim_Door_L) vers leurs meshes descendants (flatten
    //    supprime les parents) ; 2) anonymiser tout le reste pour que join() fusionne un maximum.
    {
      const DOOR = /door|hatch|bulkhead/i, DOOR_EXCL = /wall|frame/i;
      const isDoor = (nm) => DOOR.test(nm) && !DOOR_EXCL.test(nm);
      const tag = (node, name) => { if (node.getMesh() && !isDoor(node.getName() || "")) node.setName(name); for (const c of node.listChildren()) tag(c, name); };
      for (const n of intDoc.getRoot().listNodes()) { const nm = n.getName() || ""; if (isDoor(nm)) tag(n, nm); }
      for (const n of intDoc.getRoot().listNodes()) if (!isDoor(n.getName() || "")) n.setName("");
      for (const m of intDoc.getRoot().listMeshes()) if (!isDoor(m.getName() || "")) m.setName("");
    }
    // flatten+join : draw calls /10-20 (retour user : lag Visite sur les capitaux — Polaris 7754 draws).
    // keepNamed : seuls les noeuds encore nommes (= portes) echappent a la fusion.
    await intDoc.transform(dedup(), prune(), flatten(), joinPrims({ keepNamed: true }));
    // budget tris : LOD2 des capitaux peut deborder -> simplify meshopt (preserve les murs, contrairement au LOD3 CIG)
    const it = docTris(intDoc);
    if (it > BUDGET.interior.maxTris) {
      await MeshoptSimplifier.ready;
      await intDoc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: (BUDGET.interior.maxTris / it) * 0.95, error: 0.01 }));
    }
    await intDoc.transform(textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 80 }), meshopt({ encoder: MeshoptEncoder, level: "high" }));
    // shell occulteur : fusionner la silhouette exterieure. (1) anonymiser (aucun nom door/hatch
    // du shell ne doit matcher le masquage app) ; (2) pre-joindre le shell SEUL (fusion maximale) ;
    // (3) tagger "occluder_shell" : CONTRAT APP = render-only, EXCLU du collider (le shell ne doit
    // jamais bloquer le joueur ni porter de collision).
    const shellDoc = await io.read(extOut);
    for (const n of shellDoc.getRoot().listNodes()) n.setName("");
    for (const m of shellDoc.getRoot().listMeshes()) m.setName("");
    // backdrop unique : l'app override le materiau du shell de toute facon (MeshBasicMaterial gris)
    // -> ses textures seraient du poids mort (~30% du fichier), et un materiau unique laisse join()
    // fusionner tout le shell en une poignee de draws.
    const backdrop = shellDoc.createMaterial("occluder_shell").setBaseColorFactor([0.28, 0.3, 0.34, 1]).setRoughnessFactor(1).setMetallicFactor(0);
    for (const m of shellDoc.getRoot().listMeshes()) for (const p of m.listPrimitives()) p.setMaterial(backdrop);
    await shellDoc.transform(prune(), flatten(), joinPrims());
    for (const n of shellDoc.getRoot().listNodes()) if (n.getMesh()) n.setName("occluder_shell");
    for (const m of shellDoc.getRoot().listMeshes()) m.setName("occluder_shell");
    mergeDocuments(intDoc, shellDoc);
    const r = intDoc.getRoot(); const scenes = r.listScenes(); const def = r.getDefaultScene() || scenes[0];
    for (const sc of scenes) { if (sc === def) continue; for (const n of sc.listChildren()) def.addChild(n); sc.dispose(); }
    await intDoc.transform(unpartition(), meshopt({ encoder: MeshoptEncoder, level: "high" }));
    await io.write(intOut, intDoc);

    for (const f of [tmpExt, tmpInt, tmpInt.replace(/\.glb$/, ".fixed.glb")]) if (existsSync(f)) rmSync(f);
    results.push({ key, ok: true, ext: statSync(extOut).size, int: statSync(intOut).size });
    console.log(`  ✓ ${key.padEnd(28)} ext ${mb(statSync(extOut).size)} · int ${mb(statSync(intOut).size)} ${anchored.has(key) ? "(reposition)" : ""}`);
  } catch (e) {
    for (const f of [tmpExt, tmpInt, tmpInt.replace(/\.glb$/, ".fixed.glb")]) if (existsSync(f)) rmSync(f);
    results.push({ key, ok: false, err: e.message.split("\n")[0] });
    console.log(`  ✗ ${key.padEnd(28)} ECHEC : ${e.message.split("\n")[0]}`);
  }
}
const ok = results.filter((r) => r.ok);
const tot = ok.reduce((s, r) => s + r.ext + r.int, 0);
console.log(`\n${ok.length}/${results.length} OK. Total HD : ${mb(tot)} (moy ${mb(tot / (ok.length || 1))}/vaisseau -> extrapolation 229 = ~${(tot / (ok.length || 1) * 229 / 1073741824).toFixed(1)} Go)`);
const ko = results.filter((r) => !r.ok); if (ko.length) console.log(`Echecs : ${ko.map((r) => r.key).join(", ")}`);
function mb(b) { return (b / 1048576).toFixed(1) + " Mo"; }
