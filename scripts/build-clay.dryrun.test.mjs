import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("build-clay --dry-run --json n'appelle pas StarBreaker et émet plan+result", () => {
  const out = execFileSync(
    "node",
    ["scripts/build-clay.mjs", "DRAK_Cutlass_Black", "--dry-run", "--json"],
    { cwd: ROOT, encoding: "utf8" },
  );
  const lines = out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(lines.every((e) => typeof e.type === "string"), "toutes les lignes sont du JSON typé");
  assert.ok(lines.some((e) => e.type === "progress" && e.step === "start" && e.key === "DRAK_Cutlass_Black"));
  assert.ok(lines.some((e) => e.type === "plan" && e.key === "DRAK_Cutlass_Black"));
  assert.ok(lines.some((e) => e.type === "result"));
});
