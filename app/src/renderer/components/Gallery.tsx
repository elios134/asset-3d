import type { Ship } from "../../shared/types";
import type { Selection } from "../selection";
import type { Filter } from "./Toolbar";
import { ShipCard } from "./ShipCard";

export function Gallery({
  ships, query, filter, alpha, sel, onToggle,
}: {
  ships: Ship[]; query: string; filter: Filter; alpha: boolean; sel: Selection;
  onToggle: (key: string, level: "exterior" | "interior") => void;
}) {
  const q = query.trim().toLowerCase();
  let list = ships.filter((s) => {
    if (filter === "toProcess" && !s.toProcess) return false;
    if (filter === "extraits" && !s.exterior.published) return false;
    if (q && !`${s.name} ${s.manufacturer}`.toLowerCase().includes(q)) return false;
    return true;
  });
  if (alpha) list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="gallery">
      {list.map((s) => <ShipCard key={s.key} ship={s} sel={sel.get(s.key)} onToggle={onToggle} />)}
      {list.length === 0 && <p className="muted">Aucun vaisseau ne correspond.</p>}
    </div>
  );
}
