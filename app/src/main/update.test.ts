import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runUpdate } from "./update";

function fakeRepo(genMetaBody: string): string {
  const root = mkdtempSync(join(tmpdir(), "upd-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts", "gen-meta.mjs"), genMetaBody);
  return root;
}

test("runUpdate : gen-meta OK → { ok, count } depuis ships.meta.json", async () => {
  const root = fakeRepo(
    `import { writeFileSync } from "node:fs";
     import { join, dirname } from "node:path";
     import { fileURLToPath } from "node:url";
     const r = join(dirname(fileURLToPath(import.meta.url)), "..");
     writeFileSync(join(r, "ships.meta.json"), JSON.stringify({ _comment: "x", A: {}, B: {}, C: {} }));`,
  );
  const res = await runUpdate(root);
  expect(res.ok).toBe(true);
  expect(res.count).toBe(3);
  rmSync(root, { recursive: true, force: true });
});

test("runUpdate : gen-meta échoue → rejette avec le stderr", async () => {
  const root = fakeRepo(`process.stderr.write("db introuvable"); process.exit(1);`);
  await expect(runUpdate(root)).rejects.toThrow(/db introuvable/);
  rmSync(root, { recursive: true, force: true });
});
