import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function runUpdate(repoRoot: string, dbPath?: string): Promise<{ ok: boolean; count: number }> {
  return new Promise((resolve, reject) => {
    const args = dbPath ? ["scripts/gen-meta.mjs", dbPath] : ["scripts/gen-meta.mjs"];
    execFile("node", args, { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024, timeout: 120000 }, (err, _out, stderr) => {
      if (err) {
        reject(new Error(`Échec de gen-meta : ${stderr?.toString().trim() || err.message}`));
        return;
      }
      try {
        const meta = JSON.parse(readFileSync(join(repoRoot, "ships.meta.json"), "utf8")) as Record<string, unknown>;
        const count = Object.keys(meta).filter((k) => k !== "_comment").length;
        resolve({ ok: true, count });
      } catch (e) {
        reject(new Error(`gen-meta terminé mais ships.meta.json illisible : ${(e as Error).message}`));
      }
    });
  });
}
