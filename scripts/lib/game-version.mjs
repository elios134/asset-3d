import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Extrait "sc-4.2" d'une chaîne contenant un x.y (ex. "sc-alpha-4.2", "LIVE-4.2.1").
function normalize(raw) {
  const m = /(\d+)\.(\d+)/.exec(String(raw ?? ""));
  return m ? `sc-${m[1]}.${m[2]}` : null;
}

export function readLocalGameVersion(p4kPath) {
  try {
    if (!p4kPath || !existsSync(p4kPath)) return null;
    const manifest = join(dirname(p4kPath), "build_manifest.id");
    if (!existsSync(manifest)) return null;
    const data = JSON.parse(readFileSync(manifest, "utf8"));
    const candidate = data?.Data?.Branch ?? data?.Data?.RequestedP4kVersion ?? data?.Branch ?? null;
    return normalize(candidate);
  } catch {
    return null;
  }
}
