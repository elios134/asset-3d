// Liste d'exclusion MANUELLE (exclusions.json, geree dans l'app : variantes, editions speciales).
// Les builds --all la respectent ; une cle passee explicitement en argument reste construite.
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ensemble des cles exclues ; vide si le fichier manque ou est illisible (jamais bloquant).
export function loadExclusions(root) {
  try {
    const keys = JSON.parse(readFileSync(join(root, "exclusions.json"), "utf8")).keys;
    return new Set(Array.isArray(keys) ? keys.filter((k) => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}
