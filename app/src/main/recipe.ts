import type { ExtractItem } from "../shared/types";

export type Recipe = { script: string; args: string[] } | { manual: true; reason: string };

const SCRIPT = "scripts/build-clay.mjs";
const CAPITAL_M = 100; // seuil capital : recettes chunk/hull/navmesh taillées à la main, hors auto

export function resolveRecipe(item: ExtractItem): Recipe {
  if (item.wantInterior) {
    if (item.lengthM >= CAPITAL_M) {
      return { manual: true, reason: "capital (l≥100 m) — recette taillée à la main" };
    }
    return { script: SCRIPT, args: [item.key, "--modules", "--json"] };
  }
  return { script: SCRIPT, args: [item.key, "--ext-only", "--modules", "--json"] };
}
