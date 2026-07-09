// Sonde fine (0.1 m) d'une zone locale : carte de la HAUTEUR D'AIR LIBRE au-dessus du sol par cellule
// (x,z), pour hull ET chunks, afin de localiser ce qui scelle un passage. Diagnostique un chokepoint.
// usage: node scripts/probe-chokepoint.mjs models/KEY.clay-interior.glb x0 z0 [--rx=4 --rz=8 --y0=-6.5]
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dequantize } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
const opt = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? parseFloat(a.split("=")[1]) : d; };
const src = process.argv[2], X0 = parseFloat(process.argv[3]), Z0 = parseFloat(process.argv[4]);
const RX = opt("rx", 4), RZ = opt("rz", 8), Y0 = opt("y0", -6.5), YT = opt("yt", 3.0), STEP = 0.1;
const DOOR = /door|hatch/i;
const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k*4+r]*b[c*4+k]; o[c*4+r] = s; } return o; };
const ap = (m, x, y, z) => [m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]];
function collect(doc, filter) { const out = []; for (const scene of doc.getRoot().listScenes()) { const st = scene.listChildren().map((n) => [n, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1], false]); while (st.length) { const [node, pm, inC] = st.pop(); const wm = mul(pm, node.getMatrix()); const nm = node.getName() || ""; const flag = inC || /^chunk_/.test(nm); const mesh = node.getMesh(); if (mesh && filter(nm, mesh.getName() || "", flag)) for (const pr of mesh.listPrimitives()) { const pos = pr.getAttribute("POSITION"); if (!pos) continue; out.push({ wm, pos: pos.getArray(), idx: pr.getIndices()?.getArray() ?? null }); } for (const c of node.listChildren()) st.push([c, wm, flag]); } } return out; }
const doc = await io.read(src); await doc.transform(dequantize());

const nx = Math.round(2*RX/STEP), nz = Math.round(2*RZ/STEP), ny = Math.round((YT-Y0)/STEP);
const mnx = X0-RX, mnz = Z0-RZ;
const vid = (ix, iy, iz) => ix + nx*(iz + nz*iy);
function voxelize(prims) {
  const solid = new Uint8Array(nx*ny*nz);
  const S = STEP*0.45;
  for (const p of prims) { const cnt = p.idx ? p.idx.length : p.pos.length/3;
    for (let i = 0; i+2 < cnt; i += 3) { const V = []; for (let k = 0; k < 3; k++) { const j = p.idx ? p.idx[i+k] : i+k; V.push(ap(p.wm, p.pos[j*3], p.pos[j*3+1], p.pos[j*3+2])); }
      const [a,b,c] = V; const e1 = Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]), e2 = Math.hypot(c[0]-a[0],c[1]-a[1],c[2]-a[2]);
      const nu = Math.max(1, Math.ceil(e1/S)), nv = Math.max(1, Math.ceil(e2/S));
      for (let ii = 0; ii <= nu; ii++) for (let jj = 0; jj <= nv-Math.floor(ii*nv/nu); jj++) { const u = ii/nu, v = jj/nv; if (u+v > 1.0001) continue;
        const wx = a[0]+u*(b[0]-a[0])+v*(c[0]-a[0]), wy = a[1]+u*(b[1]-a[1])+v*(c[1]-a[1]), wz = a[2]+u*(b[2]-a[2])+v*(c[2]-a[2]);
        const ix = Math.floor((wx-mnx)/STEP), iy = Math.floor((wy-Y0)/STEP), iz = Math.floor((wz-mnz)/STEP);
        if (ix>=0&&ix<nx&&iy>=0&&iy<ny&&iz>=0&&iz<nz) solid[vid(ix,iy,iz)] = 1; } } }
  return solid;
}
const hull = voxelize(collect(doc, (nn, mn) => /collision_hull/i.test(nn) || /collision_hull/i.test(mn)));
const chunks = voxelize(collect(doc, (nn, mn, inC) => inC && !DOOR.test(nn) && !DOOR.test(mn)));
// hauteur d'air continue au-dessus de Y0+0.3 (pied) par colonne (ix,iz)
function airMap(solid) { const m = new Float32Array(nx*nz); for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) { let h = 0; const iy0 = Math.round(0.3/STEP); for (let iy = iy0; iy < ny; iy++) { if (solid[vid(ix,iy,iz)]) break; h += STEP; } m[ix+nx*iz] = h; } return m; }
const ah = airMap(hull), ac = airMap(chunks);
// profil le long de z a x=X0 (colonne centrale) : hauteur d'air hull vs chunks
const ixc = Math.round((X0-mnx)/STEP);
console.log(`Profil air (m) le long de z a x=${X0}, sol y=${Y0}+0.3 :  [z : hull | chunks]`);
for (let iz = 0; iz < nz; iz += Math.round(0.5/STEP)) { const z = (mnz+iz*STEP).toFixed(1); const H = ah[ixc+nx*iz].toFixed(1), C = ac[ixc+nx*iz].toFixed(1);
  const flag = (ac[ixc+nx*iz] >= 1.9 && ah[ixc+nx*iz] < 1.8) ? "  <== hull scelle (chunks ouvert)" : "";
  console.log(`  z=${z.padStart(6)} :  ${H.padStart(4)} | ${C.padStart(4)}${flag}`); }
// balaye aussi en x pour trouver le meilleur passage (air max) a chaque z autour du chokepoint
console.log(`\nMeilleur passage (air max sur x) par z :  [z : hull(x@max) | chunks(x@max)]`);
for (let iz = 0; iz < nz; iz += Math.round(0.5/STEP)) { const z = (mnz+iz*STEP).toFixed(1);
  let bh = 0, bhx = 0, bc = 0, bcx = 0; for (let ix = 0; ix < nx; ix++) { if (ah[ix+nx*iz] > bh) { bh = ah[ix+nx*iz]; bhx = mnx+ix*STEP; } if (ac[ix+nx*iz] > bc) { bc = ac[ix+nx*iz]; bcx = mnx+ix*STEP; } }
  const flag = (bc >= 1.9 && bh < 1.8) ? "  <== hull scelle" : "";
  console.log(`  z=${z.padStart(6)} :  ${bh.toFixed(1)}@x${bhx.toFixed(1)} | ${bc.toFixed(1)}@x${bcx.toFixed(1)}${flag}`); }
