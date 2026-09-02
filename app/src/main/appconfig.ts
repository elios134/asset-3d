import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_SCFLEET_DB = "C:/Users/andre/AppData/Roaming/com.andre.sc-fleet-manager-v2/scfleet.db";

export function resolveScfleetDb(repoRoot: string): string {
  try {
    const p = join(repoRoot, "app-config.json");
    if (existsSync(p)) {
      const cfg = JSON.parse(readFileSync(p, "utf8")) as { scfleetDb?: string };
      if (cfg.scfleetDb) return cfg.scfleetDb;
    }
  } catch {
    /* défaut ci-dessous */
  }
  return DEFAULT_SCFLEET_DB;
}
