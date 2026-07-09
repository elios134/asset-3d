// Mesure la LARGEUR DE PASSAGE LIBRE a chaque embrasure de porte a travers collision_hull (ray-tracing
// fin, sans limite voxel). Repond a la note app : "une porte ~1m remeshee peut pincer sous le diametre
// capsule 0.6m". Emprises de portes = meshes /door|hatch/ du glb (presents, rendus). Pour chaque porte :
// a 3 hauteurs (0.4/1.0/1.6 m au-dessus du bas), on balaie l'axe LARGEUR (0.05 m) et a chaque offset on
// tire un rayon court le long de l'axe TRAVERSEE ; le passage libre = plus grand segment largeur contigu
// sans impact hull. clearance = MIN sur les 3 hauteurs (une capsule doit passer a toutes).
// usage: node scripts/door-clearance.mjs models/KEY.clay-interior.glb [--hull=autre.glb] [--cap=0.6] [--list]
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dequantize } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
const argOpt = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const LIST = process.argv.includes("--list");
const srcPath = process.argv[2];
const hullPath = argOpt("hull", srcPath);
const CAP = parseFloat(argOpt("cap", "0.6")); // diametre capsule joueur (m)
const DOOR = /door|hatch/i;

const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const ap = (m, x, y, z) => [m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]];

function collect(doc, filter) {
  const out = [];
  for (const scene of doc.getRoot().listScenes()) {
    const st = scene.listChildren().map((n) => [n, [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], false]);
    while (st.length) {
      const [node, pm, inChunk] = st.pop();
      const wm = mul(pm, node.getMatrix());
      const nm = node.getName() || "";
      const flag = inChunk || /^chunk_/.test(nm);
      const mesh = node.getMesh();
      if (mesh && filter(nm, mesh.getName() || "", flag)) for (const pr of mesh.listPrimitives()) {
        const pos = pr.getAttribute("POSITION"); if (!pos) continue;
        out.push({ wm, pos: pos.getArray(), idx: pr.getIndices()?.getArray() ?? null });
      }
      for (const c of node.listChildren()) st.push([c, wm, flag]);
    }
  }
  return out;
}
function worldTris(prims) {
  const tris = [];
  for (const p of prims) { const cnt = p.idx ? p.idx.length : p.pos.length / 3;
    for (let i = 0; i + 2 < cnt; i += 3) { const t = []; for (let k = 0; k < 3; k++) { const j = p.idx ? p.idx[i+k] : i+k; t.push(ap(p.wm, p.pos[j*3], p.pos[j*3+1], p.pos[j*3+2])); } tris.push(t); } }
  return tris;
}
function segHit(o, d, len, tri) {
  const [a, b, c] = tri;
  const e1 = [b[0]-a[0], b[1]-a[1], b[2]-a[2]], e2 = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
  const p = [d[1]*e2[2]-d[2]*e2[1], d[2]*e2[0]-d[0]*e2[2], d[0]*e2[1]-d[1]*e2[0]];
  const det = e1[0]*p[0]+e1[1]*p[1]+e1[2]*p[2]; if (Math.abs(det) < 1e-12) return false;
  const inv = 1/det, tv = [o[0]-a[0], o[1]-a[1], o[2]-a[2]];
  const u = (tv[0]*p[0]+tv[1]*p[1]+tv[2]*p[2])*inv; if (u < 0 || u > 1) return false;
  const q = [tv[1]*e1[2]-tv[2]*e1[1], tv[2]*e1[0]-tv[0]*e1[2], tv[0]*e1[1]-tv[1]*e1[0]];
  const v = (d[0]*q[0]+d[1]*q[1]+d[2]*q[2])*inv; if (v < 0 || u+v > 1) return false;
  const t = (e2[0]*q[0]+e2[1]*q[1]+e2[2]*q[2])*inv; return t >= 0 && t <= len;
}

const COLLIDER = argOpt("collider", "hull"); // hull (defaut) | chunks (baseline in-game)
const doc = await io.read(srcPath); await doc.transform(dequantize());
const hullDoc = hullPath === srcPath ? doc : await io.read(hullPath); if (hullDoc !== doc) await hullDoc.transform(dequantize());
const tris = COLLIDER === "chunks"
  ? worldTris(collect(hullDoc, (nn, mn, inChunk) => inChunk && !DOOR.test(nn) && !DOOR.test(mn)))
  : worldTris(collect(hullDoc, (nn, mn) => /collision_hull/i.test(nn) || /collision_hull/i.test(mn)));
if (!tris.length) { console.error(`collider "${COLLIDER}" absent de ` + hullPath); process.exit(2); }

// portes -> bboxes fusionnees par centre (grille 1.2 m : frame+vantail+flipped au meme endroit)
const dprims = collect(doc, (nn, mn) => DOOR.test(nn) || DOOR.test(mn));
const merged = new Map();
for (const p of dprims) {
  let xn=1/0,yn=1/0,zn=1/0,xx=-1/0,yx=-1/0,zx=-1/0; const n = p.pos.length/3;
  for (let i = 0; i < n; i++) { const w = ap(p.wm, p.pos[i*3], p.pos[i*3+1], p.pos[i*3+2]); if(w[0]<xn)xn=w[0];if(w[1]<yn)yn=w[1];if(w[2]<zn)zn=w[2];if(w[0]>xx)xx=w[0];if(w[1]>yx)yx=w[1];if(w[2]>zx)zx=w[2]; }
  if (!isFinite(xn)) continue;
  const cx=(xn+xx)/2, cy=(yn+yx)/2, cz=(zn+zx)/2;
  const key = `${Math.round(cx/1.2)},${Math.round(cy/1.2)},${Math.round(cz/1.2)}`;
  let e = merged.get(key); if (!e) { e = { min:[1e9,1e9,1e9], max:[-1e9,-1e9,-1e9] }; merged.set(key, e); }
  e.min=[Math.min(e.min[0],xn),Math.min(e.min[1],yn),Math.min(e.min[2],zn)];
  e.max=[Math.max(e.max[0],xx),Math.max(e.max[1],yx),Math.max(e.max[2],zx)];
}

// prefiltre triangles hull dans une AABB (perf)
function near(box) { return tris.filter((t) => { let mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9]; for(const v of t)for(let k=0;k<3;k++){if(v[k]<mn[k])mn[k]=v[k];if(v[k]>mx[k])mx[k]=v[k];} for(let k=0;k<3;k++)if(mx[k]<box.min[k]||mn[k]>box.max[k])return false; return true; }); }

let tested=0, pinched=0; const clearances=[];
for (const d of merged.values()) {
  const ext=[d.max[0]-d.min[0], d.max[1]-d.min[1], d.max[2]-d.min[2]];
  const thin = ext[0] < ext[2] ? 0 : 2; // axe traversee (horizontal le plus mince)
  const wax = thin === 0 ? 2 : 0;         // axe largeur (autre horizontal)
  const h = ext[1];
  if (h < 1.2 || ext[wax] < 0.55) continue; // pas une vraie porte franchissable
  tested++;
  const cThin=(d.min[thin]+d.max[thin])/2, cW=(d.min[wax]+d.max[wax])/2;
  const reach = ext[thin]/2 + 0.35; // longueur rayon traversee (epaisseur mur + marge)
  const box = { min:[d.min[0]-0.5,d.min[1]-0.2,d.min[2]-0.5], max:[d.max[0]+0.5,d.max[1]+0.2,d.max[2]+0.5] };
  const cand = near(box);
  const dir=[0,0,0]; dir[thin]=1;
  const halfW = ext[wax]/2 + 0.3; // balaye un peu au-dela des jambages
  let clr = 1e9;
  for (const dy of [0.4, 1.0, Math.min(1.6, h-0.2)]) {
    const y = d.min[1] + dy;
    // pour chaque offset largeur : le rayon traversee est-il libre ?
    let best=0, run=0;
    for (let w = -halfW; w <= halfW; w += 0.05) {
      const o=[0,0,0]; o[1]=y; o[thin]=cThin-reach; o[wax]=cW+w;
      const hit = cand.some((t) => segHit(o, dir, reach*2, t));
      if (!hit) { run += 0.05; if (run > best) best = run; } else run = 0;
    }
    if (best < clr) clr = best;
  }
  clearances.push({ c:[(d.min[0]+d.max[0])/2, d.min[1], (d.min[2]+d.max[2])/2], clr });
  if (clr < CAP + 0.05) pinched++;
}
clearances.sort((a,b)=>a.clr-b.clr);
const q = (p) => clearances.length ? clearances[Math.floor((clearances.length-1)*p)].clr : 0;
console.log(`${srcPath.split(/[\\/]/).pop()} : portes franchissables ${tested} · clearance min ${clearances.length?clearances[0].clr.toFixed(2):"-"}m · p10 ${q(0.1).toFixed(2)}m · median ${q(0.5).toFixed(2)}m · PINCEES <${(CAP+0.05).toFixed(2)}m : ${pinched}`);
if (LIST) for (const c of clearances.filter(x=>x.clr<CAP+0.05).slice(0,15)) console.log(`  ✗ ${c.clr.toFixed(2)}m @ (${c.c.map(v=>v.toFixed(1)).join(",")})`);
process.exit(pinched > 0 ? 1 : 0);
