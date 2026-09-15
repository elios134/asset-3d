import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, cpSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = join(fileURLToPath(import.meta.url), "..");

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "analyze-"));
  writeFileSync(join(dir, "ships.meta.json"), JSON.stringify({
    _comment: "x",
    AAA_New: { name: "New", manufacturer: "Acme", dims: { l: 20, b: 10, h: 5 } },
    BBB_Old: { name: "Old", manufacturer: "Acme", dims: { l: 30, b: 12, h: 6 } },
  }));
  writeFileSync(join(dir, "index.json"), JSON.stringify({
    patchVersion: "sc-4.1",
    ships: [{ key: "BBB_Old", patchVersion: "sc-4.0", variants: [{ level: "exterior" }, { level: "interior" }] }],
  }));
  writeFileSync(join(dir, "interior-anchors.json"), JSON.stringify({ _comment: "x" }));
  // Empreintes : BBB_Old publié avec empreinte "old", source actuelle "new" -> « version modifiée ».
  writeFileSync(join(dir, "source-baseline.json"), JSON.stringify({ fingerprints: { BBB_Old: "old" } }));
  mkdirSync(join(dir, ".cache"), { recursive: true });
  writeFileSync(join(dir, ".cache", "fingerprints.json"), JSON.stringify({ fingerprints: { BBB_Old: "new" } }));
  cpSync(join(HERE, "analyze.mjs"), join(dir, "analyze.mjs"));
  cpSync(join(HERE, "lib"), join(dir, "lib"), { recursive: true });
  return dir;
}

test("analyze --json émet la liste et les compteurs", () => {
  const dir = scratch();
  const out = execFileSync("node", ["analyze.mjs", "--json", "--local-version", "sc-4.2"], { cwd: dir, encoding: "utf8" });
  const data = JSON.parse(out);
  assert.equal(data.localVersion, "sc-4.2");
  assert.equal(data.publishedVersion, "sc-4.1");
  assert.equal(data.counts.total, 2);
  assert.equal(data.counts.toProcess, 2); // AAA_New (nouveau) + BBB_Old (empreinte modifiée)
  assert.equal(data.ships.find((s) => s.key === "AAA_New").status, "nouveau");
  assert.equal(data.ships.find((s) => s.key === "BBB_Old").status, "version modifiée");
  rmSync(dir, { recursive: true, force: true });
});

test("analyze échoue explicitement si ships.meta.json est absent", () => {
  const dir = mkdtempSync(join(tmpdir(), "analyze-"));
  cpSync(join(HERE, "analyze.mjs"), join(dir, "analyze.mjs"));
  cpSync(join(HERE, "lib"), join(dir, "lib"), { recursive: true });

  let threw = null;
  try {
    execFileSync("node", ["analyze.mjs", "--json"], { cwd: dir, encoding: "utf8" });
  } catch (err) {
    threw = err;
  }

  assert.ok(threw, "le process doit échouer quand ships.meta.json est absent");
  assert.notEqual(threw.status, 0);
  assert.match(threw.stderr, /ships\.meta\.json introuvable/);

  rmSync(dir, { recursive: true, force: true });
});
