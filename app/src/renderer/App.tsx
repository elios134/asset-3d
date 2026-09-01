import { useEffect, useState } from "react";
import { api } from "./api";
import { Header } from "./components/Header";
import { PrereqBar } from "./components/PrereqBar";
import { Toolbar, type Filter } from "./components/Toolbar";
import { Gallery } from "./components/Gallery";
import { toggleLevel, selectionCount, type Selection } from "./selection";
import { isExcluded } from "./exclude";
import type { AnalyzeResult, Prereqs } from "../shared/types";

export function App() {
  const [data, setData] = useState<AnalyzeResult | null>(null);
  const [prereqs, setPrereqs] = useState<Prereqs | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setData(null); setPrereqs(null); setError(null);
    Promise.all([api.analyze(), api.prereqs()])
      .then(([a, p]) => {
        const ships = a.ships.filter((s) => !isExcluded(s));
        const toProcess = ships.filter((s) => s.toProcess).length;
        setData({ ...a, ships, counts: { total: ships.length, toProcess } });
        setPrereqs(p);
      })
      .catch((e) => setError(String(e?.message ?? e)));
  };
  useEffect(() => { load(); }, []);

  if (error) return <div className="app"><p className="err">Erreur : {error}</p></div>;
  if (!data || !prereqs) return <div className="app"><p>Analyse en cours…</p></div>;

  return (
    <AppBody data={data} prereqs={prereqs} reload={load} />
  );
}

function AppBody({ data, prereqs, reload }: { data: AnalyzeResult; prereqs: Prereqs; reload: () => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("toProcess");
  const [sel, setSel] = useState<Selection>(new Map());
  const onToggle = (key: string, level: "exterior" | "interior") => setSel((s) => toggleLevel(s, key, level));
  const count = selectionCount(sel);

  return (
    <div className="app">
      <Header data={data} prereqs={prereqs} />
      <PrereqBar prereqs={prereqs} />
      <Toolbar query={query} onQuery={setQuery} filter={filter} onFilter={setFilter} onAnalyze={reload} />
      <Gallery ships={data.ships} query={query} filter={filter} sel={sel} onToggle={onToggle} />
      <footer className="footer">
        <button className="primary" disabled title="Extraction en Plan 2b">Extraire la sélection ({count})</button>
      </footer>
    </div>
  );
}
