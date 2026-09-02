import type { AnalyzeResult, Prereqs } from "../../shared/types";

export function UpdateScreen({
  data, prereqs, updating, onUpdate,
}: {
  data: AnalyzeResult; prereqs: Prereqs; updating: boolean; onUpdate: () => void;
}) {
  return (
    <div className="app">
      <h1>asset-3D — hangar</h1>
      <div className="update-card">
        <div className="versions">
          <div><span className="lbl">Version publiée</span><b>{data.publishedVersion ?? "—"}</b></div>
          <div className="arrow">→</div>
          <div><span className="lbl">Version locale du jeu</span><b>{data.localVersion ?? "—"}</b></div>
        </div>
        <p className="muted">
          Les données du jeu sont plus récentes que le catalogue publié.
          Mettez à jour le catalogue avant d'afficher les vaisseaux à traiter.
        </p>
        <button className="primary" onClick={onUpdate} disabled={updating}>
          {updating ? "Mise à jour…" : "Mettre à jour les données"}
        </button>
        {(!prereqs.starbreaker || !prereqs.p4k) && (
          <p className="warn-note">Prérequis incomplets (StarBreaker / Data.p4k) — l'extraction ne sera pas possible.</p>
        )}
      </div>
    </div>
  );
}
