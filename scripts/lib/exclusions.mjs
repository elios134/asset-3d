// Exclusions de vaisseaux pour le pipeline : regles de l'APP (source unique, app/src/shared/excludeRules.mjs)
// + liste manuelle exclusions.json (editee dans l'app). Les builds --all la respectent ; une cle passee
// explicitement en argument reste construite.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isExcluded } from "../../app/src/shared/excludeRules.mjs";

// Ensemble des cles exclues a la main ; vide si le fichier manque ou est illisible (jamais bloquant).
export function loadExclusions(root) {
  try {
    const keys = JSON.parse(readFileSync(join(root, "exclusions.json"), "utf8")).keys;
    return new Set(Array.isArray(keys) ? keys.filter((k) => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

// Filtre pret a l'emploi : (cle) -> exclu ? (regles de l'app + liste manuelle, noms lus dans meta).
export function makeExcluder(root, meta) {
  const manual = loadExclusions(root);
  return (key) => isExcluded({ key, name: meta[key]?.name ?? "" }, manual);
}
