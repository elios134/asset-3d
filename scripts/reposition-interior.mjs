#!/usr/bin/env node
// reposition-interior.mjs — corrige le placement des modules interieurs (bug StarBreaker).
//
// Regle (validee par le harnais app) : la geometrie de chaque module `interior_base_int_X_main`
// doit avoir son CENTROIDE (coque, meshes de rampe animee exclus) sur son hardpoint `hardpoint_int_X`.
// StarBreaker place l'origine du noeud a 2x le hardpoint -> les modules sans offset interne (.cga)
// sont decales. On translate chaque module pour recaler centroide sur hardpoint_int_X.
//
// Patch au niveau des matrices de noeuds (la geometrie/BIN ne bouge pas). Ecrit <name>.fixed.glb.
//
// Usage : node scripts/reposition-interior.mjs <interior.glb> [sortie.glb]

import { readFileSync, writeFileSync } from "node:fs";

const inPath = process.argv[2];
const outPath = process.argv[3] || inPath.replace(/\.glb$/i, ".fixed.glb");
const RAMP = /door|hydro|hydraulic|ramp|pole|Int_Door/i;

// ---------- lecture GLB (JSON + BIN) ----------
const buf = readFileSync(inPath);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("pas un GLB");
let off = 12, jsonBytes = null, binBytes = null, jsonStart = 0;
while (off < buf.length) {
  const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4), start = off + 8;
  if (type === 0x4e4f534a) { jsonBytes = buf.subarray(start, start + len); jsonStart = start; }
  else if (type === 0x004e4942) { binBytes = buf.subarray(start, start + len); }
  off = start + len;
}
const json = JSON.parse(jsonBytes.toString("utf8"));
const nodes = json.nodes ?? [], accessors = json.accessors ?? [], bufferViews = json.bufferViews ?? [], meshes = json.meshes ?? [];
const parent = new Array(nodes.length).fill(-1);
nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (parent[c] = i)));

// ---------- algebre 4x4 (column-major) ----------
const ident = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
function localMatrix(n) {
  if (n.matrix) return n.matrix.slice();
  const t = n.translation ?? [0,0,0], r = n.rotation ?? [0,0,0,1], s = n.scale ?? [1,1,1];
  const [x,y,z,w] = r, x2=x+x,y2=y+y,z2=z+z, xx=x*x2,xy=x*y2,xz=x*z2, yy=y*y2,yz=y*z2,zz=z*z2, wx=w*x2,wy=w*y2,wz=w*z2, [sx,sy,sz]=s;
  return [(1-(yy+zz))*sx,(xy+wz)*sx,(xz-wy)*sx,0, (xy-wz)*sy,(1-(xx+zz))*sy,(yz+wx)*sy,0, (xz+wy)*sz,(yz-wx)*sz,(1-(xx+yy))*sz,0, t[0],t[1],t[2],1];
}
function mul(a,b){const o=new Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}return o;}
function worldMatrix(i){let m=localMatrix(nodes[i]),p=parent[i];while(p!==-1){m=mul(localMatrix(nodes[p]),m);p=parent[p];}return m;}
function apply(m,x,y,z){return [m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]];}
function translation(dx,dy,dz){return [1,0,0,0, 0,1,0,0, 0,0,1,0, dx,dy,dz,1];}
function invert(m){ // inverse generale 4x4 (column-major)
  const a=m;const b=new Array(16);
  const s0=a[0]*a[5]-a[1]*a[4], s1=a[0]*a[6]-a[2]*a[4], s2=a[0]*a[7]-a[3]*a[4], s3=a[1]*a[6]-a[2]*a[5],
        s4=a[1]*a[7]-a[3]*a[5], s5=a[2]*a[7]-a[3]*a[6], c5=a[10]*a[15]-a[11]*a[14], c4=a[9]*a[15]-a[11]*a[13],
        c3=a[9]*a[14]-a[10]*a[13], c2=a[8]*a[15]-a[11]*a[12], c1=a[8]*a[14]-a[10]*a[12], c0=a[8]*a[13]-a[9]*a[12];
  let det=s0*c5-s1*c4+s2*c3+s3*c2-s4*c1+s5*c0; if(!det) throw new Error("matrice non inversible"); det=1/det;
  b[0]=(a[5]*c5-a[6]*c4+a[7]*c3)*det; b[1]=(-a[1]*c5+a[2]*c4-a[3]*c3)*det; b[2]=(a[13]*s5-a[14]*s4+a[15]*s3)*det; b[3]=(-a[9]*s5+a[10]*s4-a[11]*s3)*det;
  b[4]=(-a[4]*c5+a[6]*c2-a[7]*c1)*det; b[5]=(a[0]*c5-a[2]*c2+a[3]*c1)*det; b[6]=(-a[12]*s5+a[14]*s2-a[15]*s1)*det; b[7]=(a[8]*s5-a[10]*s2+a[11]*s1)*det;
  b[8]=(a[4]*c4-a[5]*c2+a[7]*c0)*det; b[9]=(-a[0]*c4+a[1]*c2-a[3]*c0)*det; b[10]=(a[12]*s4-a[13]*s2+a[15]*s0)*det; b[11]=(-a[8]*s4+a[9]*s2-a[11]*s0)*det;
  b[12]=(-a[4]*c3+a[5]*c1-a[6]*c0)*det; b[13]=(a[0]*c3-a[1]*c1+a[2]*c0)*det; b[14]=(-a[12]*s3+a[13]*s1-a[14]*s0)*det; b[15]=(a[8]*s3-a[9]*s1+a[10]*s0)*det;
  return b;
}

// ---------- centroide (moyenne des sommets, coque = rampe exclue) ----------
function readPositions(accIdx) {
  const acc = accessors[accIdx]; if (!acc || acc.componentType !== 5126) return null;
  const bv = bufferViews[acc.bufferView]; const stride = bv.byteStride || 12;
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const out = new Array(acc.count);
  for (let i = 0; i < acc.count; i++) {
    const o = base + i * stride;
    out[i] = [binBytes.readFloatLE(o), binBytes.readFloatLE(o + 4), binBytes.readFloatLE(o + 8)];
  }
  return out;
}
function shellCentroid(rootIdx) {
  let sx = 0, sy = 0, sz = 0, n = 0;
  const stack = [rootIdx];
  while (stack.length) {
    const i = stack.pop(), nd = nodes[i];
    if (nd.mesh != null && !RAMP.test(nd.name || "")) {
      const wm = worldMatrix(i);
      for (const prim of meshes[nd.mesh].primitives ?? []) {
        const pos = readPositions(prim.attributes?.POSITION);
        if (!pos) continue;
        for (const [x, y, z] of pos) { const w = apply(wm, x, y, z); sx += w[0]; sy += w[1]; sz += w[2]; n++; }
      }
    }
    for (const c of nd.children ?? []) stack.push(c);
  }
  return n ? [sx / n, sy / n, sz / n] : null;
}

// ---------- hardpoints d'ancrage ----------
const anchors = {}; // X -> position monde
nodes.forEach((n, i) => {
  const m = /^hardpoint_int_(.+)$/i.exec(n.name || "");
  if (m) { const w = worldMatrix(i); anchors[m[1].toLowerCase()] = [w[12], w[13], w[14]]; }
});

// ---------- reposition de chaque module ----------
let fixed = 0, skipped = 0;
nodes.forEach((n, i) => {
  const m = /^interior_base_int_(.+?)_main$/i.exec(n.name || "");
  if (!m) return;
  const X = m[1].toLowerCase();
  const hp = anchors[X];
  if (!hp) { console.log(`  ⚠ ${n.name} : pas de hardpoint_int_${X} -> laisse tel quel`); skipped++; return; }
  const c = shellCentroid(i);
  if (!c) { console.log(`  ⚠ ${n.name} : pas de geometrie de coque -> saute`); skipped++; return; }
  const delta = [hp[0]-c[0], hp[1]-c[1], hp[2]-c[2]];
  const dist = Math.hypot(...delta);
  // newLocal = inv(parentWorld) * T(delta_monde) * parentWorld * localMatrix
  const pW = parent[i] === -1 ? ident() : worldMatrix(parent[i]);
  const newLocal = mul(invert(pW), mul(translation(...delta), mul(pW, localMatrix(nodes[i]))));
  delete nodes[i].translation; delete nodes[i].rotation; delete nodes[i].scale;
  nodes[i].matrix = newLocal.map((v) => Math.abs(v) < 1e-8 ? 0 : v);
  console.log(`  ✓ ${n.name.padEnd(34)} centroide (${c.map(v=>v.toFixed(2)).join(",")}) -> hardpoint (${hp.map(v=>v.toFixed(2)).join(",")})  recalage ${dist.toFixed(2)}m`);
  fixed++;
});

// ---------- re-serialisation GLB ----------
const newJson = Buffer.from(JSON.stringify(json), "utf8");
const jsonPad = (4 - (newJson.length % 4)) % 4;
const jsonChunk = Buffer.concat([newJson, Buffer.alloc(jsonPad, 0x20)]);
const binPad = (4 - (binBytes.length % 4)) % 4;
const binChunk = Buffer.concat([binBytes, Buffer.alloc(binPad, 0)]);
const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
const jHead = Buffer.alloc(8); jHead.writeUInt32LE(jsonChunk.length, 0); jHead.writeUInt32LE(0x4e4f534a, 4);
const bHead = Buffer.alloc(8); bHead.writeUInt32LE(binChunk.length, 0); bHead.writeUInt32LE(0x004e4942, 4);
writeFileSync(outPath, Buffer.concat([head, jHead, jsonChunk, bHead, binChunk]));
console.log(`\n${fixed} module(s) recale(s), ${skipped} saute(s). Ecrit : ${outPath.split(/[\\/]/).pop()}`);
