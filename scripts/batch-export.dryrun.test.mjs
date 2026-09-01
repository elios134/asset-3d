import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, writeFileSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("batch-export --dry-run --json n'appelle pas StarBreaker et émet des events 'plan'", () => {
  if (!existsSync(join(ROOT, "app-config.json"))) {
    writeFileSync(join(ROOT, "app-config.json"), JSON.stringify({ paths: { starbreaker: "NOPE.exe", p4k: "NOPE.p4k" } }));
  }
  const out = execFileSync("node", ["scripts/batch-export.mjs", "AEGS_Avenger_Titan", "--dry-run", "--json"], { cwd: ROOT, encoding: "utf8" });
  const lines = out.trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(lines.some((e) => e.type === "plan" && e.key === "AEGS_Avenger_Titan"));
  assert.ok(lines.some((e) => e.type === "result"));
});
