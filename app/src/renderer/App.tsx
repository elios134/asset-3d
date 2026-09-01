import { useEffect, useState } from "react";
import { api } from "./api";
import { Header } from "./components/Header";
import { PrereqBar } from "./components/PrereqBar";
import type { AnalyzeResult, Prereqs } from "../shared/types";

export function App() {
  const [data, setData] = useState<AnalyzeResult | null>(null);
  const [prereqs, setPrereqs] = useState<Prereqs | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.analyze(), api.prereqs()])
      .then(([a, p]) => { setData(a); setPrereqs(p); })
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  if (error) return <div className="app"><p className="err">Erreur : {error}</p></div>;
  if (!data || !prereqs) return <div className="app"><p>Analyse en cours…</p></div>;

  return (
    <div className="app">
      <Header data={data} prereqs={prereqs} />
      <PrereqBar prereqs={prereqs} />
      <p className="muted">{data.ships.length} vaisseaux au catalogue — galerie en Task 5.</p>
    </div>
  );
}
