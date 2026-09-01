import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServices } from "./services";

// Recopie minimale des libs Plan 1 nécessaires, pour un repoRoot de test autonome.
function fakeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "svc-"));
  const lib = join(root, "scripts", "lib");
  mkdirSync(lib, { recursive: true });
  writeFileSync(join(root, "scripts", "analyze.mjs"), "");
  writeFileSync(join(lib, "config.mjs"), `export function loadConfig(){ throw new Error("app-config.json introuvable"); }`);
  writeFileSync(join(lib, "prereqs.mjs"), `export function checkPrereqs({which}){ return {node:true,starbreaker:false,p4k:false,git:which("git"),gh:which("gh")}; } export function defaultWhich(){ return false; }`);
  writeFileSync(join(lib, "thumbnails.mjs"), `import {writeFileSync,mkdirSync,existsSync} from "node:fs"; import {join} from "node:path"; export async function getThumbnail({name,cacheDir}){ if(!existsSync(cacheDir)) mkdirSync(cacheDir,{recursive:true}); const p=join(cacheDir, name.replace(/\\W+/g,"_")+".jpg"); writeFileSync(p, Buffer.from([1,2,3])); return {path:p, source:"wiki"}; }`);
  return root;
}

test("getThumbnail renvoie une data URL depuis le fichier caché", async () => {
  const root = fakeRepo();
  const svc = createServices(root);
  const url = await svc.getThumbnail("Carrack");
  expect(url).toMatch(/^data:image\/jpeg;base64,/);
  rmSync(root, { recursive: true, force: true });
});

test("prereqs dégrade proprement si loadConfig lève (app-config absent)", async () => {
  const root = fakeRepo();
  const svc = createServices(root);
  const p = await svc.prereqs();
  expect(p.node).toBe(true);
  expect(p.starbreaker).toBe(false);
  expect(p.p4k).toBe(false);
  rmSync(root, { recursive: true, force: true });
});
