import type { Ship } from "../../shared/types";
import type { Selection } from "../selection";
import type { Filter } from "./Toolbar";
import { ShipCard } from "./ShipCard";
import { isExcludedEdition } from "../exclude";

export function Gallery({
  ships, query, filter, sel, onToggle,
}: {
  ships: Ship[]; query: string; filter: Filter; sel: Selection;
  onToggle: (key: string, level: "exterior" | "interior") => void;
}) {
  const q = query.trim().toLowerCase();
  const list = ships.filter((s) => {
    if (isExcludedEdition(s.name)) return false;
    if (filter === "toProcess" && !s.toProcess) return false;
    if (q && !`${s.name} ${s.manufacturer}`.toLowerCase().includes(q)) return false;
    return true;
  });
  return (
    <div className="gallery">
      {list.map((s) => <ShipCard key={s.key} ship={s} sel={sel.get(s.key)} onToggle={onToggle} />)}
      {list.length === 0 && <p className="muted">Aucun vaisseau ne correspond.</p>}
    </div>
  );
}
