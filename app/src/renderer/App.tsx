import { useEffect, useState } from "react";
import { api } from "./api";
import { Header } from "./components/Header";
import { PrereqBar } from "./components/PrereqBar";
import { Toolbar, type Filter } from "./components/Toolbar";
import { Gallery } from "./components/Gallery";
import { toggleLevel, selectionCount, type Selection } from "./selection";
import { initialSelection } from "./preselect";
import { isExcluded } from "./exclude";
import { UpdateScreen } from "./components/UpdateScreen";
import { needsUpdate } from "./gate";
import type { AnalyzeResult, Prereqs } from "../shared/types";

type Phase = "checking" | "needsUpdate" | "updating" | "ready" | "error";

export function App() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [data, setData] = useState<AnalyzeResult | null>(null);
  const [prereqs, setPrereqs] = useState<Prereqs | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async (): Promise<AnalyzeResult> => {
    const [a, p] = await Promise.all([api.analyze(), api.prereqs()]);
    const ships = a.ships.filter((s) => !isExcluded(s));
    const filtered = { ...a, ships, counts: { total: ships.length, toProcess: ships.filter((s) => s.toProcess).length } };
    setData(filtered); setPrereqs(p);
    return filtered;
  };

  const fail = (e: unknown) => { setError(String((e as Error)?.message ?? e)); setPhase("error"); };

  useEffect(() => {
    fetchData()
      .then((d) => setPhase(needsUpdate(d.publishedVersion, d.localVersion) ? "needsUpdate" : "ready"))
      .catch(fail);
  }, []);

  const onUpdate = async (): Promise<void> => {
    setPhase("updating");
    try { await api.updateData(); await fetchData(); setPhase("ready"); } catch (e) { fail(e); }
  };

  if (phase === "error") return <div className="app"><p className="err">Erreur : {error}</p></div>;
  if (phase === "checking" || !data || !prereqs) return <div className="app"><p>Analyse en cours…</p></div>;
  if (phase === "needsUpdate" || phase === "updating")
    return <UpdateScreen data={data} prereqs={prereqs} updating={phase === "updating"} onUpdate={onUpdate} />;

  return <AppBody data={data} prereqs={prereqs} reload={() => { fetchData().catch(fail); }} />;
}

function AppBody({ data, prereqs, reload }: { data: AnalyzeResult; prereqs: Prereqs; reload: () => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("toProcess");
  const [alpha, setAlpha] = useState(false);
  const [sel, setSel] = useState<Selection>(() => initialSelection(data.ships));
  const onToggle = (key: string, level: "exterior" | "interior") => setSel((s) => toggleLevel(s, key, level));
  const count = selectionCount(sel);

  return (
    <div className="app">
      <Header data={data} prereqs={prereqs} />
      <PrereqBar prereqs={prereqs} />
      <Toolbar query={query} onQuery={setQuery} filter={filter} onFilter={setFilter} alpha={alpha} onAlpha={setAlpha} onAnalyze={reload} />
      <Gallery ships={data.ships} query={query} filter={filter} alpha={alpha} sel={sel} onToggle={onToggle} />
      <footer className="footer">
        <button className="primary" disabled title="Extraction — plan ultérieur">Extraire la sélection ({count})</button>
      </footer>
    </div>
  );
}
