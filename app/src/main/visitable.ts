import { createRequire } from "node:module";
import { existsSync } from "node:fs";

// Loaded via createRequire instead of a static `import ... from "node:sqlite"`:
// node:sqlite is an experimental Node builtin that Vite/vite-node's SSR module
// resolution (used to run these files under Vitest) does not yet recognize as
// a builtin, which otherwise breaks resolution under the test runner. A plain
// require() call is invisible to that static import analysis and works
// identically at runtime (Electron main process or plain Node).
const require = createRequire(import.meta.url);

export function loadVisitableSet(dbPath: string): Set<string> {
  const set = new Set<string>();
  try {
    if (!existsSync(dbPath)) return set;
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db
      .prepare(
        "SELECT DISTINCT classNameCig FROM ShipData WHERE crewMax >= 2 AND classNameCig IS NOT NULL AND classNameCig <> ''",
      )
      .all() as Array<{ classNameCig: string }>;
    db.close();
    for (const r of rows) set.add(r.classNameCig);
  } catch {
    return set;
  }
  return set;
}
