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
import { dedup, prune, textureCompress, meshopt, mergeDocuments, unpartition, getBounds, flatten, join as joinPrims, simplify, dequantize } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync, rmSync, renameSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = join(ROOT, "models");
const STARBREAKER = "C:/Users/andre/Documents/starbreaker/starbreaker.exe";
const P4K = "D:/Program Files/RSI Launcher/StarCitizen/LIVE/Data.p4k";
const meta = JSON.parse(readFileSync(join(ROOT, "ships.meta.json"), "utf8"));
const anchored = new Set(Object.keys(JSON.parse(readFileSync(join(ROOT, "interior-anchors.json"), "utf8"))).filter((k) => k !== "_comment"));
const primBlacklist = (() => { try { const j = JSON.parse(readFileSync(join(ROOT, "interior-prim-blacklist.json"), "utf8")); delete j._comment; return j; } catch { return {}; } })();
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
// Overrides de test (proto LOD, fichiers hors index) :
//   --int-lod=N     force le LOD interieur (sinon regle intLod)
//   --no-simplify   saute la passe simplify meme au-dessus du budget tris
//   --out-suffix=X  ecrit models/X/<key>.X-interior.glb au lieu de models/<key>.interior.glb
const INT_LOD_OVERRIDE = (() => { const a = process.argv.find((x) => x.startsWith("--int-lod=")); return a ? parseInt(a.split("=")[1], 10) : null; })();
const NO_SIMPLIFY = process.argv.includes("--no-simplify");
const OUT_SUFFIX = (() => { const a = process.argv.find((x) => x.startsWith("--out-suffix=")); return a ? a.split("=")[1] : null; })();
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
// Bug gltf-transform 4.4.1 : reorder()+quantize() (l'interieur de meshopt()) corrompt les positions
// des primitives dont les accessors sont PARTAGES entre plusieurs prims (props instancies
// StarBreaker : bouteilles, vitrages...) -> geometrie projetee sur tout le volume de quantization
// (= les "modules mal places"/vitres geantes du triage app, 282 meshes sur 49 vaisseaux).
// Chaque etape isolee est saine ; seule la combinaison corrompt. Parade : donner a chaque prim son
// propre clone de tout accessor partage AVANT meshopt ; le dedup interne de quantize() re-fusionne
// les clones identiques ensuite (cout final nul, valide : 3->0 debordants sur le Carrack).
const unshareAccessors = (doc) => { const seen = new Set(); for (const mesh of doc.getRoot().listMeshes()) for (const pr of mesh.listPrimitives()) { for (const sem of pr.listSemantics()) { const a = pr.getAttribute(sem); if (!a) continue; if (seen.has(a)) pr.setAttribute(sem, a.clone()); else seen.add(a); } const idx = pr.getIndices(); if (idx) { if (seen.has(idx)) pr.setIndices(idx.clone()); else seen.add(idx); } } };
const exp = (key, out, extra) => execFileSync(STARBREAKER, ["entity", "export", key, out, "--materials", "textures", "--mip", "4", ...extra], { env: { ...process.env, SC_DATA_P4K: P4K }, stdio: "ignore", timeout: 600000 });
const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const ap = (m, x, y, z) => [m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]];

const results = [];
console.log(`Pipeline HD : ${batch.length} vaisseaux\n`);
for (const key of batch) {
  const m = meta[key], l = m.dims?.l ?? 25; // defaut 25m si dims absentes (ships sans cote ShipData)
  const extOut = join(MODELS, `${key}.exterior.glb`);
  const intOut = OUT_SUFFIX ? join(MODELS, OUT_SUFFIX, `${key}.${OUT_SUFFIX}-interior.glb`) : join(MODELS, `${key}.interior.glb`);
  if (OUT_SUFFIX) mkdirSync(join(MODELS, OUT_SUFFIX), { recursive: true });
  const tmpExt = join(MODELS, `_hd_${key}_ext.glb`), tmpInt = join(MODELS, `_hd_${key}_int.glb`);
  const tmpHull = join(MODELS, `_hd_${key}_hull.glb`);
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
      await extDoc.transform(dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [512, 512], quality: 80 }));
      unshareAccessors(extDoc);
      await extDoc.transform(meshopt({ encoder: MeshoptEncoder, level: "high" }));
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
    // LOD ADAPTATIF (round 8, decision user « 96 Mo strict ») : on tente le LOD1 (detail x2 ; gros
    // gagnants du scan delta : Railen/Tyilui/Ironclad/Tiburon/MOLE/Starlifter) et on retombe au
    // LOD2 (+simplify) si le fichier FINAL depasse maxSizeBytes. Pre-filtre : un export LOD1
    // >7M tris ne tiendra jamais sous le plafond (Idris 9,6M -> 108 Mo) -> repli direct sans build.

    // COQUE EXTERIEURE LEAKEE (retour app round 8 : « bloc orange » Carrack). L'export interieur
    // contient TOUTE la geometrie du vaisseau : la coque exterieure (CGA .../Exterior/*.cga : livree,
    // decals, chevrons de danger, antennes, portes de coque) EN PLUS des conteneurs socpak interieurs.
    // Vue par un trou, cette coque ext apparait comme des blocs orange « plus gros que reel ». Ces
    // nodes de coque sont EXACTEMENT ceux d'un export --no-interior --no-attachments (= ce que le SHELL
    // occulteur fournit deja) -> on les retire de l'interieur : plus de double coque (fichier allege)
    // ni de leak. Discriminateur = IDENTITE DE NODE (nom), PAS le materiau : l'interieur reutilise
    // LEGITIMEMENT des materiaux _ext_mtl_ sur de vraies surfaces (train, parois) mais avec des noms
    // ABSENTS de la coque. Valide : Carrack (51 coque cullees / 318 reuse gardees / 0 collision),
    // Railen (69 / 181 / 0). Reference au LOD1 (noms LOD-independants : LOD1 ⊇ LOD2). Echec export
    // (rarissime) -> set vide -> aucun cull, le build continue.
    let hullNames = new Set();
    try {
      execFileSync(STARBREAKER, ["entity", "export", key, tmpHull, "--materials", "colors", "--mip", "4", "--no-interior", "--no-attachments", "--lod", "1"], { env: { ...process.env, SC_DATA_P4K: P4K }, stdio: "ignore", timeout: 600000 });
      const hullDoc = await io.read(tmpHull);
      for (const n of hullDoc.getRoot().listNodes()) if (n.getMesh()) hullNames.add(n.getName() || "");
    } catch (e) { console.log(`  ⚠ ${key} : ref coque ext indisponible (${e.message.split("\n")[0]}) — pas de cull coque`); }

    const buildInterior = async (lodTry, hasFallback) => {
    exp(key, tmpInt, ["--lod", String(lodTry)]);
    if (lodTry === 1 && hasFallback && glbTris(tmpInt) > 7_000_000) return false;
    let intPath = tmpInt;
    if (anchored.has(key)) { const fx = tmpInt.replace(/\.glb$/, ".fixed.glb"); execFileSync("node", ["scripts/reposition-interior.mjs", tmpInt, fx, `--key=${key}`], { cwd: ROOT, stdio: "ignore" }); intPath = fx; }
    const intDoc = await io.read(intPath);
    stripLights(intDoc);
    // EMISSIF EXTERIEUR leake. L'export interieur embarque toutes les features emissives de la coque
    // ext qui, vues de l'interieur, brillent comme des blocs orange/saumon flottants (retour app :
    // bloc saumon puis « bloc orange » Carrack round 8). Le strip round 7/8 ne visait que « mtl_glow »
    // et ratait : les DECALS DE LIVREE (decal_pom_opaque_013, ef=1 = livree Anvil orange qui brille),
    // le TEXTE DE MATRICULE (RTT_Text_To_Decal_044, ef=1) et le GLOW MOTEUR (engine_glow_012 — le nom
    // ne contient pas « mtl_glow »). Critere robuste et generique : materiau du NAMESPACE EXTERIEUR
    // (_ext_mtl_/_exterior_mtl_) ET EMISSIF (emissiveFactor>0 ou emissiveTexture). Les glows INTERIEURS
    // legitimes utilisent d'autres namespaces (component_master, relay_demo_mat...) -> intacts. Per-PRIM
    // (pas per-node) : un node mixte (tourelle habitee) garde ses prims interieurs, perd le decal ext.
    const EXT_NS = /(_ext_|_exterior_)mtl_/i;
    const isEmissive = (mat) => { if (!mat) return false; const ef = mat.getEmissiveFactor(); return (ef && (ef[0] > 0 || ef[1] > 0 || ef[2] > 0)) || !!mat.getEmissiveTexture(); };
    for (const mesh of intDoc.getRoot().listMeshes()) for (const pr of mesh.listPrimitives()) { const mat = pr.getMaterial(); if (mat && EXT_NS.test(mat.getName() || "") && isEmissive(mat)) pr.dispose(); }
    // Blacklist ciblee par vaisseau (interior-prim-blacklist.json) : artefacts d'extraction
    // confirmes que les regles generiques ne couvrent pas (ex. decals Idris de 5-9 m en plein
    // milieu de la cabine du Starfarer — asset d'un AUTRE vaisseau leake par StarBreaker).
    for (const rx of primBlacklist[key] ?? []) { const re = new RegExp(rx, "i");
      for (const mesh of intDoc.getRoot().listMeshes()) for (const pr of mesh.listPrimitives()) if (re.test(pr.getMaterial()?.getName() || "")) pr.dispose(); }
    // cull de la COQUE EXTERIEURE leakee : tout node-mesh dont le nom appartient a la coque (voir
    // hullNames plus haut). setMesh(null) et non dispose() : disposer un node detache ses enfants
    // (transform parentale perdue -> sauts absurdes) ; retirer le mesh preserve la hierarchie, prune()
    // nettoie ensuite. Garde-fou : si le set est vide (ref indispo) la boucle ne fait rien.
    if (hullNames.size) {
      let culledHull = 0;
      for (const node of intDoc.getRoot().listNodes()) if (node.getMesh() && hullNames.has(node.getName() || "")) { node.setMesh(null); culledHull++; }
      if (culledHull) console.log(`  ⌫ ${key} : ${culledHull} nodes coque ext retires de l'interieur`);
    }
    // cull strays (generique/anonyme, loin hors coque) — bbox manuelle cycle-safe
    const nodes = intDoc.getRoot().listNodes(); const pm = new Map(); for (const n of nodes) for (const c of n.listChildren()) pm.set(c, n);
    const wm = (n) => { let mm = n.getMatrix(), p = pm.get(n), seen = new Set([n]), d = 0; while (p && !seen.has(p) && d < 200) { mm = mul(p.getMatrix(), mm); seen.add(p); p = pm.get(p); d++; } return mm; };
    // L'interieur DOIT tenir dans l'enveloppe exterieure : tout mesh qui en DEBORDE de plus de 2m est
    // defectueux par construction (module englobant "bol saumon", piece chevauchante, debris flottant),
    // quel que soit son nom. Critere valide par le scan app (57/62 vaisseaux touches par les modules
    // chevauchants que l'ancien critere "disjoint" ratait). Soupape : si >30% des meshes partiraient,
    // le shell/l'export est anormal -> on ne culle rien (meme garde-fou que le cull runtime app).
    const candidates = [];
    let meshCount = 0;
    // bornes par ECHANTILLONNAGE DE SOMMETS (1/13), pas par min/max d'accessor : certains exports
    // StarBreaker ont des min/max mensongers (plus petits que les sommets reels) -> slivers a -48m
    // qui echappaient au cull.
    const PT = [0, 0, 0];
    for (const node of nodes) { const mesh = node.getMesh(); if (!mesh) continue; meshCount++; let xn=1/0,yn=1/0,zn=1/0,xx=-1/0,yx=-1/0,zx=-1/0; const M = wm(node); for (const pr of mesh.listPrimitives()) { const a = pr.getAttribute("POSITION"); if (!a) continue; const cn = a.getCount(); for (let i = 0; i < cn; i += 13) { a.getElement(i, PT); const w = ap(M, PT[0], PT[1], PT[2]); xn=Math.min(xn,w[0]);yn=Math.min(yn,w[1]);zn=Math.min(zn,w[2]);xx=Math.max(xx,w[0]);yx=Math.max(yx,w[1]);zx=Math.max(zx,w[2]); } } if (!isFinite(xn)) continue;
      const prot = Math.max(hull.min[0]-xn, xx-hull.max[0], hull.min[1]-yn, yx-hull.max[1], hull.min[2]-zn, zx-hull.max[2]);
      if (prot > 2) candidates.push(node); }
    // setMesh(null), PAS dispose() : disposer un noeud DETACHE ses enfants qui perdent la transform
    // parentale et sautent a des positions absurdes (constate : +245 nouveaux debordants apres un cull
    // par dispose sur le Carrack). Retirer le mesh preserve la hierarchie ; prune() nettoie ensuite.
    if (candidates.length <= meshCount * 0.3) { for (const n of candidates) n.setMesh(null); }
    else console.log(`  ⚠ ${key} : cull suspendu (${candidates.length}/${meshCount} meshes deborderaient — shell anormal ?)`);
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
    // unshare AVANT simplify : simplify remappe les sommets et corrompt les accessors partages
    // exactement comme reorder+quantize (constate : vitres Valkyrie/bouteille du Carrack, seuls
    // les capitaux au-dessus du budget tris etaient touches par CE point de corruption-la).
    unshareAccessors(intDoc);
    const it = docTris(intDoc);
    if (!NO_SIMPLIFY && it > BUDGET.interior.maxTris) {
      await MeshoptSimplifier.ready;
      await intDoc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: (BUDGET.interior.maxTris / it) * 0.95, error: 0.01 }));
    }
    await intDoc.transform(textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 80 }));
    // PAS de meshopt ici : la quantization ne doit passer qu'UNE fois, tout a la fin. Re-quantizer
    // des donnees deja quantizees (l'ancien schema : meshopt interieur PUIS meshopt final apres
    // fusion du shell) reintroduisait la corruption sur les prims instanciees (vitres Valkyrie /
    // bouteille du Carrack) malgre l'unshare — seul le schema "unshare + quantization unique"
    // est valide propre (0 debordant).
    // shell occulteur : fusionner la silhouette exterieure. (1) anonymiser (aucun nom door/hatch
    // du shell ne doit matcher le masquage app) ; (2) pre-joindre le shell SEUL (fusion maximale) ;
    // (3) tagger "occluder_shell" : CONTRAT APP = render-only, EXCLU du collider (le shell ne doit
    // jamais bloquer le joueur ni porter de collision).
    // Le shell garde ses VRAIS materiaux texture (rendu valide par l'user : « les trous montrent la
    // coque, c'est parfait ») — l'app ne l'override plus, elle le rend tel quel (render-only via le
    // nom). Anonymiser puis joindre (fusion par materiau), puis tag occluder_shell sur ce qui reste.
    const shellDoc = await io.read(extOut);
    for (const n of shellDoc.getRoot().listNodes()) n.setName("");
    for (const m of shellDoc.getRoot().listMeshes()) m.setName("");
    // dequantize d'abord : extOut est deja quantize (int16 normalises + transforms de dequantization) ;
    // le laisser tel quel ferait passer ses prims par une 2e quantization au meshopt final.
    await shellDoc.transform(dequantize(), prune(), flatten(), joinPrims());
    for (const n of shellDoc.getRoot().listNodes()) if (n.getMesh()) n.setName("occluder_shell");
    for (const m of shellDoc.getRoot().listMeshes()) m.setName("occluder_shell");
    mergeDocuments(intDoc, shellDoc);
    const r = intDoc.getRoot(); const scenes = r.listScenes(); const def = r.getDefaultScene() || scenes[0];
    for (const sc of scenes) { if (sc === def) continue; for (const n of sc.listChildren()) def.addChild(n); sc.dispose(); }
    await intDoc.transform(dedup(), unpartition());
    unshareAccessors(intDoc);
    await intDoc.transform(meshopt({ encoder: MeshoptEncoder, level: "high" }));
    await io.write(intOut, intDoc);
    return true;
    };
    const lodsToTry = INT_LOD_OVERRIDE != null ? [INT_LOD_OVERRIDE] : [...new Set([1, intLod(l)])];
    let intLodUsed = null;
    for (let li = 0; li < lodsToTry.length; li++) {
      const lodTry = lodsToTry[li], hasFallback = li < lodsToTry.length - 1;
      if (!(await buildInterior(lodTry, hasFallback))) { console.log(`  ↩ ${key} : LOD${lodTry} pre-filtre tris -> repli LOD${lodsToTry[li + 1]}`); continue; }
      intLodUsed = lodTry;
      if (statSync(intOut).size <= BUDGET.interior.maxSizeBytes) break;
      if (hasFallback) console.log(`  ↩ ${key} : LOD${lodTry} = ${mb(statSync(intOut).size)} > plafond ${mb(BUDGET.interior.maxSizeBytes)} -> repli LOD${lodsToTry[li + 1]}`);
    }

    for (const f of [tmpExt, tmpInt, tmpHull, tmpInt.replace(/\.glb$/, ".fixed.glb")]) if (existsSync(f)) rmSync(f);
    results.push({ key, ok: true, ext: statSync(extOut).size, int: statSync(intOut).size });
    console.log(`  ✓ ${key.padEnd(28)} ext ${mb(statSync(extOut).size)} · int ${mb(statSync(intOut).size)} LOD${intLodUsed} ${anchored.has(key) ? "(reposition)" : ""}`);
  } catch (e) {
    for (const f of [tmpExt, tmpInt, tmpHull, tmpInt.replace(/\.glb$/, ".fixed.glb")]) if (existsSync(f)) rmSync(f);
    results.push({ key, ok: false, err: e.message.split("\n")[0] });
    console.log(`  ✗ ${key.padEnd(28)} ECHEC : ${e.message.split("\n")[0]}`);
  }
}
const ok = results.filter((r) => r.ok);
const tot = ok.reduce((s, r) => s + r.ext + r.int, 0);
console.log(`\n${ok.length}/${results.length} OK. Total HD : ${mb(tot)} (moy ${mb(tot / (ok.length || 1))}/vaisseau -> extrapolation 229 = ~${(tot / (ok.length || 1) * 229 / 1073741824).toFixed(1)} Go)`);
const ko = results.filter((r) => !r.ok); if (ko.length) console.log(`Echecs : ${ko.map((r) => r.key).join(", ")}`);
function mb(b) { return (b / 1048576).toFixed(1) + " Mo"; }
