// indexDiff.ts — cœur PUR du diff index.json (tranche « aperçu du diff avant Confirmer »).
// Compare l'index publié actuel (entrées lues côté main) au plan du dry-run (nouvelles valeurs par
// niveau) pour montrer, avant le 2e clic, CE QUI va changer : nouveau vaisseau, niveau ajouté,
// variante modifiée (sha/taille), ou inchangé. Aucune logique React ni I/O ici — testé isolément.

export interface IndexVariant { level: string; sha256: string; sizeBytes: number }
export interface IndexEntry { key: string; variants: IndexVariant[] }

// Ligne de plan du dry-run (nouvelle valeur d'un niveau à publier).
export interface DiffPlanRow { key: string; level: string; sha256: string; sizeBytes: number }

export type LevelStatus = "added" | "changed" | "unchanged";
export interface DiffLevel {
  level: string;
  status: LevelStatus;
  oldSha: string | null;
  newSha: string;
  oldSize: number | null;
  newSize: number;
}
export type ShipStatus = "new-ship" | "updated" | "unchanged";
export interface DiffRow { key: string; status: ShipStatus; levels: DiffLevel[] }

// Diffe l'index courant contre le plan. `newShips` = clés signalées « nouveau vaisseau » par le dry-run.
// Une ligne par clé, dans l'ordre d'apparition dans le plan.
export function indexDiff(current: IndexEntry[], plan: DiffPlanRow[], newShips: string[]): DiffRow[] {
  const curByKey = new Map(current.map((e) => [e.key, new Map(e.variants.map((v) => [v.level, v]))]));
  const isNew = new Set(newShips);

  const order: string[] = [];
  const byKey = new Map<string, DiffPlanRow[]>();
  for (const row of plan) {
    if (!byKey.has(row.key)) { byKey.set(row.key, []); order.push(row.key); }
    byKey.get(row.key)!.push(row);
  }

  return order.map((key) => {
    const curVariants = curByKey.get(key);
    const shipIsNew = isNew.has(key) || !curVariants;
    const levels: DiffLevel[] = byKey.get(key)!.map((row) => {
      const old = shipIsNew ? undefined : curVariants!.get(row.level);
      let status: LevelStatus;
      if (!old) status = "added";
      else if (old.sha256 !== row.sha256) status = "changed";
      else status = "unchanged";
      return {
        level: row.level,
        status,
        oldSha: old ? old.sha256 : null,
        newSha: row.sha256,
        oldSize: old ? old.sizeBytes : null,
        newSize: row.sizeBytes,
      };
    });
    const status: ShipStatus = shipIsNew
      ? "new-ship"
      : levels.some((l) => l.status !== "unchanged") ? "updated" : "unchanged";
    return { key, status, levels };
  });
}
