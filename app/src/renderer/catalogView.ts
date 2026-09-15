// catalogView.ts — cœur PUR de la présentation du catalogue (aucune logique React).
// Traduit les vaisseaux analysés (raisons issues de detect.mjs) en états d'affichage,
// compteurs et groupes de la liste de travail. Testé isolément.
import type { Ship } from "../shared/types";

export type CatalogShip = Ship;
export type ShipStatus = "new" | "mod" | "int" | "ok";

// État d'affichage d'un vaisseau. Priorité : nouveau > modifié > intérieur manquant > à jour.
export function shipStatus(s: CatalogShip): ShipStatus {
  if (!s.exterior.published || s.reasons.includes("nouveau")) return "new";
  if (s.reasons.includes("version modifiée")) return "mod";
  if (s.reasons.includes("intérieur manquant")) return "int";
  return "ok";
}

export interface StatusCounts { all: number; new: number; mod: number; int: number; ok: number }

export function statusCounts(ships: CatalogShip[]): StatusCounts {
  const c: StatusCounts = { all: ships.length, new: 0, mod: 0, int: 0, ok: 0 };
  for (const s of ships) c[shipStatus(s)]++;
  return c;
}

export interface WorklistGroups { new: CatalogShip[]; mod: CatalogShip[]; int: CatalogShip[] }

// Vaisseaux à traiter regroupés par état (les « à jour » sont exclus : la prod fait foi).
export function worklistGroups(ships: CatalogShip[]): WorklistGroups {
  const g: WorklistGroups = { new: [], mod: [], int: [] };
  for (const s of ships) {
    if (!s.toProcess) continue;
    const st = shipStatus(s);
    if (st === "ok") continue;
    g[st].push(s);
  }
  return g;
}
