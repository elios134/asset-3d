import { useEffect, useState } from "react";
import { api } from "../api";
import type { Ship } from "../../shared/types";

const REASON_TONE: Record<string, string> = {
  "nouveau": "accent", "version modifiée": "warn", "intérieur manquant": "muted", "à jour": "ok",
};

export function ShipCard({
  ship, sel, onToggle,
}: {
  ship: Ship;
  sel: { exterior: boolean; interior: boolean } | undefined;
  onToggle: (key: string, level: "exterior" | "interior") => void;
}) {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.getThumbnail(ship.name).then((u) => { if (alive) setThumb(u); });
    return () => { alive = false; };
  }, [ship.name]);

  const ext = sel?.exterior ?? false;
  const int = sel?.interior ?? false;

  return (
    <div className="card">
      <div className="thumb">
        {thumb ? <img src={thumb} alt={ship.name} /> : <div className="silhouette">▣</div>}
        <span className={`reason ${REASON_TONE[ship.status] ?? "muted"}`}>{ship.status}</span>
      </div>
      <div className="body">
        <p className="name">{ship.name}</p>
        <p className="meta">{ship.manufacturer} · {ship.dims.l}m</p>
        <div className="levels">
          <button className={ext ? "chip on" : "chip"} onClick={() => onToggle(ship.key, "exterior")}>Extérieur</button>
          <button
            className={int ? "chip on" : "chip"}
            title={ship.interior.anchored ? "" : "Intérieur non conventionnel — correction manuelle possible"}
            onClick={() => onToggle(ship.key, "interior")}
          >
            Intérieur{ship.interior.anchored ? "" : " *"}
          </button>
        </div>
      </div>
    </div>
  );
}
