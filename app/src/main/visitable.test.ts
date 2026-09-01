import { test, expect } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadVisitableSet } from "./visitable";

// See visitable.ts for why node:sqlite is loaded via createRequire rather
// than a static import in files executed by Vitest.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

function fakeDb(rows: Array<[string, number]>): string {
  const dir = mkdtempSync(join(tmpdir(), "scf-"));
  const path = join(dir, "scfleet.db");
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE ShipData (classNameCig TEXT, crewMax INTEGER)");
  const ins = db.prepare("INSERT INTO ShipData (classNameCig, crewMax) VALUES (?, ?)");
  for (const [k, c] of rows) ins.run(k, c);
  db.close();
  return path;
}

test("loadVisitableSet ne garde que crewMax >= 2", () => {
  const path = fakeDb([["AEGS_Carrack", 4], ["AEGS_Gladius", 1], ["MISC_Freelancer", 2]]);
  const set = loadVisitableSet(path);
  expect(set.has("AEGS_Carrack")).toBe(true);
  expect(set.has("MISC_Freelancer")).toBe(true);
  expect(set.has("AEGS_Gladius")).toBe(false);
  rmSync(join(path, ".."), { recursive: true, force: true });
});

test("loadVisitableSet renvoie un Set vide si la DB est absente (jamais throw)", () => {
  const set = loadVisitableSet("Z:/nope/scfleet.db");
  expect(set.size).toBe(0);
});
