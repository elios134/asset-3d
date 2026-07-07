#!/usr/bin/env node
// reposition-interior.mjs — corrige le placement des modules interieurs (bug StarBreaker).
//
// Regle (validee par le harnais app) : le CENTRE DE BBOX MONDE de la coque de chaque module
// (mesh shell filtre par nom, meshes de rampe exclus) doit coincider avec son hardpoint_int_X.
// StarBreaker place l'origine du noeud a 2x le hardpoint ; les modules sans offset interne (.cga)
// se retrouvent doubles. On translate chaque module pour recaler centre-bbox-shell sur hardpoint.
//
// La correspondance module -> (shell, hardpoint) est dans interior-anchors.json (nommage CIG
// section-specifique, non derivable). Metrique identique au harnais debug3d (centre de bbox, pas
// centroide de sommets ; EXCL = /door|hydro|hydraulic|ramp|pole/i).
//
// Patch au niveau des matrices de noeuds (la geometrie/BIN ne bouge pas). Ecrit <name>.fixed.glb.
// Usage : node scripts/reposition-interior.mjs <interior.glb> [sortie.glb]

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const keyArg = process.argv.find((a) => a.startsWith("--key="));
const inPath = args[0];
const outPath = args[1] || inPath.replace(/\.glb$/i, ".fixed.glb");
// clef = --key=... si fournie (fichiers temporaires du pipeline HD), sinon derivee du nom <key>.interior.glb
const shipKey = keyArg ? keyArg.split("=")[1] : basename(inPath).replace(/\.interior\.glb$/i, "");
const EXCL = /door|hydro|hydraulic|ramp|pole/i;

const anchorTable = JSON.parse(readFileSync(join(ROOT, "interior-anchors.json"), "utf8"));
const mapping = anchorTable[shipKey];
if (!mapping) { console.error(`Pas d'entree pour "${shipKey}" dans interior-anchors.json.`); process.exit(1); }

// ---------- lecture GLB ----------
const buf = readFileSync(inPath);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("pas un GLB");
let off = 12, jsonBytes = null, binBytes = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4), start = off + 8;
  if (type === 0x4e4f534a) jsonBytes = buf.subarray(start, start + len);
  else if (type === 0x004e4942) binBytes = buf.subarray(start, start + len);
  off = start + len;
}
const json = JSON.parse(jsonBytes.toString("utf8"));
const nodes = json.nodes ?? [], accessors = json.accessors ?? [], meshes = json.meshes ?? [];
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
function invert(m){
  const a=m,b=new Array(16);
  const s0=a[0]*a[5]-a[1]*a[4],s1=a[0]*a[6]-a[2]*a[4],s2=a[0]*a[7]-a[3]*a[4],s3=a[1]*a[6]-a[2]*a[5],s4=a[1]*a[7]-a[3]*a[5],s5=a[2]*a[7]-a[3]*a[6];
  const c5=a[10]*a[15]-a[11]*a[14],c4=a[9]*a[15]-a[11]*a[13],c3=a[9]*a[14]-a[10]*a[13],c2=a[8]*a[15]-a[11]*a[12],c1=a[8]*a[14]-a[10]*a[12],c0=a[8]*a[13]-a[9]*a[12];
  let det=s0*c5-s1*c4+s2*c3+s3*c2-s4*c1+s5*c0; if(!det) throw new Error("non inversible"); det=1/det;
  b[0]=(a[5]*c5-a[6]*c4+a[7]*c3)*det;b[1]=(-a[1]*c5+a[2]*c4-a[3]*c3)*det;b[2]=(a[13]*s5-a[14]*s4+a[15]*s3)*det;b[3]=(-a[9]*s5+a[10]*s4-a[11]*s3)*det;
  b[4]=(-a[4]*c5+a[6]*c2-a[7]*c1)*det;b[5]=(a[0]*c5-a[2]*c2+a[3]*c1)*det;b[6]=(-a[12]*s5+a[14]*s2-a[15]*s1)*det;b[7]=(a[8]*s5-a[10]*s2+a[11]*s1)*det;
  b[8]=(a[4]*c4-a[5]*c2+a[7]*c0)*det;b[9]=(-a[0]*c4+a[1]*c2-a[3]*c0)*det;b[10]=(a[12]*s4-a[13]*s2+a[15]*s0)*det;b[11]=(-a[8]*s4+a[9]*s2-a[11]*s0)*det;
  b[12]=(-a[4]*c3+a[5]*c1-a[6]*c0)*det;b[13]=(a[0]*c3-a[1]*c1+a[2]*c0)*det;b[14]=(-a[12]*s3+a[13]*s1-a[14]*s0)*det;b[15]=(a[8]*s3-a[9]*s1+a[10]*s0)*det;
  return b;
}

// ---------- centre de bbox monde de la coque (meshes dont le nom matche `shellKw`, hors EXCL) ----------
function shellBBoxCenter(shellKw) {
  const kw = new RegExp(shellKw, "i");
  let xn=Infinity,yn=Infinity,zn=Infinity,xx=-Infinity,yx=-Infinity,zx=-Infinity, hit=0;
  nodes.forEach((n, i) => {
    if (n.mesh == null) return;
    const nm = n.name || meshes[n.mesh].name || "";
    if (!kw.test(nm) || EXCL.test(nm)) return;
    hit++;
    const wm = worldMatrix(i);
    for (const prim of meshes[n.mesh].primitives ?? []) {
      const a = accessors[prim.attributes?.POSITION];
      if (!a?.min) continue;
      const [x0,y0,z0]=a.min,[x1,y1,z1]=a.max;
      for (const c of [[x0,y0,z0],[x1,y0,z0],[x0,y1,z0],[x0,y0,z1],[x1,y1,z0],[x1,y0,z1],[x0,y1,z1],[x1,y1,z1]]) {
        const w = apply(wm, ...c);
        xn=Math.min(xn,w[0]);yn=Math.min(yn,w[1]);zn=Math.min(zn,w[2]);xx=Math.max(xx,w[0]);yx=Math.max(yx,w[1]);zx=Math.max(zx,w[2]);
      }
    }
  });
  return hit ? { center: [(xn+xx)/2,(yn+yx)/2,(zn+zx)/2], minY: yn, hit } : null;
}
function nodeIndexByName(name) { return nodes.findIndex((n) => (n.name || "") === name); }
function hardpointWorld(name) { const i = nodeIndexByName(name); if (i < 0) return null; const w = worldMatrix(i); return [w[12],w[13],w[14]]; }

// ---------- reposition ----------
let fixed = 0;
for (const [moduleName, cfg] of Object.entries(mapping)) {
  const mi = nodeIndexByName(moduleName);
  if (mi < 0) { console.log(`  ⚠ ${moduleName} : noeud absent`); continue; }
  const shell = shellBBoxCenter(cfg.shell);
  const hp = hardpointWorld(cfg.hardpoint);
  if (!shell) { console.log(`  ⚠ ${moduleName} : aucun mesh shell /${cfg.shell}/`); continue; }
  if (!hp) { console.log(`  ⚠ ${moduleName} : hardpoint ${cfg.hardpoint} absent`); continue; }
  const c = shell.center;
  // X/Z : centre bbox coque -> hardpoint. Y : plancher -> pont (floorTo) si defini, sinon centre -> hardpoint.y
  let dy, yMode;
  if (cfg.floorTo) {
    const fy = hardpointWorld(cfg.floorTo);
    if (!fy) { console.log(`  ⚠ ${moduleName} : floorTo ${cfg.floorTo} absent`); continue; }
    const target = fy[1] + (cfg.floorOffset || 0); // floorOffset : ajustement fin (min_y bbox vs plancher walkable), mesure par le harnais app
    dy = target - shell.minY; yMode = `plancher->${cfg.floorTo}.y${cfg.floorOffset ? (cfg.floorOffset > 0 ? "+" : "") + cfg.floorOffset : ""}=${target.toFixed(2)}`;
  } else {
    dy = hp[1] - c[1]; yMode = "centre->hardpoint.y";
  }
  const delta = [hp[0]-c[0], dy, hp[2]-c[2]];
  const pW = parent[mi] === -1 ? ident() : worldMatrix(parent[mi]);
  const newLocal = mul(invert(pW), mul(translation(...delta), mul(pW, localMatrix(nodes[mi]))));
  delete nodes[mi].translation; delete nodes[mi].rotation; delete nodes[mi].scale;
  nodes[mi].matrix = newLocal.map((v) => Math.abs(v) < 1e-9 ? 0 : v);
  console.log(`  ✓ ${moduleName.padEnd(34)} shell/${cfg.shell}/ centre(${c.map(v=>v.toFixed(2)).join(",")}) plancherY=${shell.minY.toFixed(2)}  [${yMode}]  delta(${delta.map(v=>v.toFixed(2)).join(",")})`);
  fixed++;
}

// ---------- auto-verification (memes criteres que le harnais app) ----------
let allPass = true;
console.log("\n--- verification (criteres app) ---");
for (const [moduleName, cfg] of Object.entries(mapping)) {
  const mi = nodeIndexByName(moduleName);
  if (mi < 0) continue;
  const shell = shellBBoxCenter(cfg.shell);
  const hp = hardpointWorld(cfg.hardpoint);
  if (!shell || !hp) continue;
  const c = shell.center;
  const dXZ = Math.hypot(c[0] - hp[0], c[2] - hp[2]); // centre X/Z vs hardpoint
  let floorLine = "", floorOk = true;
  if (cfg.floorTo) {
    const fy = hardpointWorld(cfg.floorTo);
    const target = fy[1] + (cfg.floorOffset || 0);
    const dFloor = Math.abs(shell.minY - target); // plancher vs cible (pont + offset)
    floorOk = dFloor <= 0.3;
    floorLine = ` | plancher ${shell.minY.toFixed(2)} vs cible ${target.toFixed(2)} ecart ${dFloor.toFixed(2)}m ${floorOk ? "OK" : "FAIL"}`;
  }
  const xzOk = dXZ <= 0.5;
  const pass = xzOk && floorOk;
  allPass = allPass && pass;
  console.log(`  ${pass ? "PASS" : "FAIL"} ${moduleName.padEnd(34)} centreXZ ecart ${dXZ.toFixed(3)}m ${xzOk ? "OK" : "FAIL"}${floorLine}`);
}
console.log(allPass ? "QA reposition : CONFORME ✓" : "QA reposition : NON CONFORME ✗");

// ---------- re-serialisation GLB ----------
const newJson = Buffer.from(JSON.stringify(json), "utf8");
const jsonChunk = Buffer.concat([newJson, Buffer.alloc((4 - (newJson.length % 4)) % 4, 0x20)]);
const binChunk = Buffer.concat([binBytes, Buffer.alloc((4 - (binBytes.length % 4)) % 4, 0)]);
const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67,0); head.writeUInt32LE(2,4); head.writeUInt32LE(total,8);
const jHead = Buffer.alloc(8); jHead.writeUInt32LE(jsonChunk.length,0); jHead.writeUInt32LE(0x4e4f534a,4);
const bHead = Buffer.alloc(8); bHead.writeUInt32LE(binChunk.length,0); bHead.writeUInt32LE(0x004e4942,4);
writeFileSync(outPath, Buffer.concat([head, jHead, jsonChunk, bHead, binChunk]));
console.log(`\n${fixed} module(s) recale(s). Ecrit : ${basename(outPath)}`);
