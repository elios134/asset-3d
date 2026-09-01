import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.mjs";

function scratchRoot(appConfig) {
  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  writeFileSync(join(dir, "config.json"), JSON.stringify({
    githubOwner: "elios134", githubRepo: "asset-3d", patchVersion: "sc-4.1",
    levels: [], budget: {},
  }));
  if (appConfig) writeFileSync(join(dir, "app-config.json"), JSON.stringify(appConfig));
  return dir;
}

test("loadConfig fusionne config.json et app-config.json", () => {
  const root = scratchRoot({ paths: { starbreaker: "S.exe", p4k: "D.p4k" } });
  const cfg = loadConfig({ root });
  assert.equal(cfg.githubOwner, "elios134");
  assert.equal(cfg.paths.starbreaker, "S.exe");
  assert.equal(cfg.paths.p4k, "D.p4k");
  rmSync(root, { recursive: true, force: true });
});

test("loadConfig échoue clairement si app-config.json manque", () => {
  const root = scratchRoot(null);
  assert.throws(() => loadConfig({ root }), /app-config\.json/);
  rmSync(root, { recursive: true, force: true });
});

test("loadConfig échoue si un chemin manque", () => {
  const root = scratchRoot({ paths: { starbreaker: "S.exe" } });
  assert.throws(() => loadConfig({ root }), /p4k/);
  rmSync(root, { recursive: true, force: true });
});
