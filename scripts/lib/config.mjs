import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadConfig({ root = DEFAULT_ROOT } = {}) {
  const base = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
  const appPath = join(root, "app-config.json");
  if (!existsSync(appPath)) {
    throw new Error(`app-config.json introuvable dans ${root}. Copiez app-config.example.json et renseignez les chemins.`);
  }
  const app = JSON.parse(readFileSync(appPath, "utf8"));
  const paths = app.paths ?? {};
  for (const key of ["starbreaker", "p4k"]) {
    if (!paths[key]) throw new Error(`app-config.json : chemin "${key}" manquant.`);
  }
  return { ...base, paths: { starbreaker: paths.starbreaker, p4k: paths.p4k } };
}
