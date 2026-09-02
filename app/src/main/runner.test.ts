import { test, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJson } from "./runner";

function scratchScript(body: string): { cwd: string; name: string } {
  const cwd = mkdtempSync(join(tmpdir(), "run-"));
  writeFileSync(join(cwd, "s.mjs"), body);
  return { cwd, name: "s.mjs" };
}

test("runJson parse la sortie JSON du script", async () => {
  const { cwd, name } = scratchScript(`process.stdout.write(JSON.stringify({ ok: 1, items: [1,2] }));`);
  const out = (await runJson(name, [], { cwd })) as { ok: number; items: number[] };
  expect(out.ok).toBe(1);
  expect(out.items).toEqual([1, 2]);
  rmSync(cwd, { recursive: true, force: true });
});

test("runJson rejette sur sortie non-zéro avec le stderr", async () => {
  const { cwd, name } = scratchScript(`process.stderr.write("boom"); process.exit(1);`);
  await expect(runJson(name, [], { cwd })).rejects.toThrow(/boom/);
  rmSync(cwd, { recursive: true, force: true });
});

test("runJson rejette si stdout n'est pas du JSON", async () => {
  const { cwd, name } = scratchScript(`process.stdout.write("pas du json");`);
  await expect(runJson(name, [], { cwd })).rejects.toThrow(/JSON/i);
  rmSync(cwd, { recursive: true, force: true });
});
