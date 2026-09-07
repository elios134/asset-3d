import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PublishPreview, PublishResult } from "../shared/types";

// Dependances injectables (tests) : commande shell, build-index, lecture d'index.
export interface PublishDeps {
  exec?: (cmd: string, args: string[], cwd: string) => Promise<string>; // stdout ; rejette si code != 0
  runBuildIndex?: (repoRoot: string) => Promise<void>;
  readIndex?: (repoRoot: string) => { patchVersion: string; keys: string[] };
}

function defaultExec(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.toString().trim() || err.message));
      else resolve(stdout.toString());
    });
  });
}
function defaultRunBuildIndex(repoRoot: string): Promise<void> {
  return defaultExec("node", ["scripts/build-index.mjs"], repoRoot).then(() => undefined);
}
function defaultReadIndex(repoRoot: string): { patchVersion: string; keys: string[] } {
  const idx = JSON.parse(readFileSync(join(repoRoot, "index.json"), "utf8")) as {
    patchVersion: string; ships?: Array<{ key: string }>;
  };
  return { patchVersion: idx.patchVersion, keys: (idx.ships ?? []).map((s) => s.key) };
}

// Etape 1 : regenere index.json et compare au dernier index publie (HEAD).
export async function buildPublishPreview(repoRoot: string, deps: PublishDeps = {}): Promise<PublishPreview> {
  const exec = deps.exec ?? defaultExec;
  const runBuildIndex = deps.runBuildIndex ?? defaultRunBuildIndex;
  const readIndex = deps.readIndex ?? defaultReadIndex;

  // Ancien index publie (HEAD:index.json). Absent/illisible (jamais commite) => ensemble vide.
  let oldKeys: string[] = [];
  try {
    const head = await exec("git", ["show", "HEAD:index.json"], repoRoot);
    oldKeys = ((JSON.parse(head).ships ?? []) as Array<{ key: string }>).map((s) => s.key);
  } catch {
    oldKeys = [];
  }

  await runBuildIndex(repoRoot);
  const { patchVersion, keys: newKeys } = readIndex(repoRoot);

  const status = await exec("git", ["status", "--porcelain", "--", "index.json", "ships.meta.json"], repoRoot);
  const changedFiles = status
    .split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => l.replace(/^\S+\s+/, "")); // retire le code de statut ("M ", "?? "...)

  const oldSet = new Set(oldKeys), newSet = new Set(newKeys);
  const added = newKeys.filter((k) => !oldSet.has(k)).sort();
  const removed = oldKeys.filter((k) => !newSet.has(k)).sort();
  return { patchVersion, total: newKeys.length, added, removed, changedFiles };
}

// Etape 2 : commit + push du manifeste (index.json + ships.meta.json).
export async function pushManifest(repoRoot: string, deps: PublishDeps = {}): Promise<PublishResult> {
  const exec = deps.exec ?? defaultExec;
  const readIndex = deps.readIndex ?? defaultReadIndex;
  const { patchVersion } = readIndex(repoRoot);

  await exec("git", ["add", "index.json", "ships.meta.json"], repoRoot);
  // `git diff --cached --quiet` : code 0 = rien de stage, code 1 = il y a des changements.
  try {
    await exec("git", ["diff", "--cached", "--quiet"], repoRoot);
    return { pushed: false, nothingToCommit: true };
  } catch {
    /* changements presents : on continue */
  }
  await exec("git", ["commit", "-m", `Catalogue ${patchVersion} (QA conforme)`], repoRoot);
  const commit = (await exec("git", ["rev-parse", "--short", "HEAD"], repoRoot)).trim();
  await exec("git", ["push"], repoRoot);
  return { pushed: true, commit };
}
