import type { ExtractItem } from "../shared/types";

// Une extraction = une SÉQUENCE d'étapes : clay (gris matcap, léger, fallback) PUIS
// peint (couleurs réelles du jeu par sommet). Le peint a besoin du clay-interior.glb
// pour la collision → clay d'abord. Produire les deux à chaque extraction = qualité
// catalogue par défaut (plus de régression grise sur les nouveaux vaisseaux).
export type Step = { script: string; args: string[] };
export type Recipe = { steps: Step[] } | { manual: true; reason: string };

const CLAY = "scripts/build-clay.mjs";
const HD = "scripts/build-hd.mjs"; // rendu PEINT (vertex colors) → models/<key>.painted-*.glb
const CAPITAL_M = 100; // seuil capital : recettes chunk/hull/navmesh taillées à la main, hors auto

export function resolveRecipe(item: ExtractItem): Recipe {
  if (item.wantInterior) {
    if (item.lengthM >= CAPITAL_M) {
      return { manual: true, reason: "capital (l≥100 m) — recette taillée à la main" };
    }
    return { steps: [
      { script: CLAY, args: [item.key, "--modules", "--json"] },
      { script: HD, args: [item.key, "--modules", "--chunk", "--json"] },
    ] };
  }
  return { steps: [
    { script: CLAY, args: [item.key, "--ext-only", "--modules", "--json"] },
    { script: HD, args: [item.key, "--exteriors-only", "--modules", "--json"] },
  ] };
}
