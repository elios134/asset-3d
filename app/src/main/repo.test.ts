import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRepoRoot } from "./repo";

test("findRepoRoot remonte jusqu'au dossier contenant scripts/analyze.mjs", () => {
  const root = mkdtempSync(join(tmpdir(), "repo-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts", "analyze.mjs"), "");
  const deep = join(root, "app", "out", "main");
  mkdirSync(deep, { recursive: true });
  expect(findRepoRoot(deep)).toBe(root);
  rmSync(root, { recursive: true, force: true });
});

test("findRepoRoot lève si aucune racine trouvée", () => {
  const bare = mkdtempSync(join(tmpdir(), "bare-"));
  expect(() => findRepoRoot(bare)).toThrow(/racine/i);
  rmSync(bare, { recursive: true, force: true });
});
