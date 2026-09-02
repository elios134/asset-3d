import type { Ship } from "../shared/types";
import type { Selection } from "./selection";

export function initialSelection(ships: Ship[]): Selection {
  const sel: Selection = new Map();
  for (const s of ships) {
    if (s.status !== "version modifiée") continue;
    const exterior = s.exterior.published;
    const interior = s.visitable;
    if (exterior || interior) sel.set(s.key, { exterior, interior });
  }
  return sel;
}
