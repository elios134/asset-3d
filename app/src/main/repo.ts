import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, "scripts", "analyze.mjs"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("Racine du dépôt introuvable (scripts/analyze.mjs absent en remontant).");
    dir = parent;
  }
}
