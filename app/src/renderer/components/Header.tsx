import type { AnalyzeResult, Prereqs } from "../../shared/types";

function status(a: AnalyzeResult, p: Prereqs): { label: string; tone: string } {
  if (!p.starbreaker || !p.p4k) return { label: "Configuration incomplète", tone: "warn" };
  if (a.counts.toProcess > 0) return { label: `Nouvelle version — ${a.counts.toProcess} à traiter`, tone: "warn" };
  return { label: "À jour", tone: "ok" };
}

export function Header({ data, prereqs }: { data: AnalyzeResult; prereqs: Prereqs }) {
  const s = status(data, prereqs);
  return (
    <header className="header">
      <div className="stat"><span className="lbl">Jeu (local)</span><b>{data.localVersion ?? "—"}</b></div>
      <div className="stat"><span className="lbl">Publié</span><b>{data.publishedVersion ?? "—"}</b></div>
      <div className={`badge ${s.tone}`}>{s.label}</div>
    </header>
  );
}
