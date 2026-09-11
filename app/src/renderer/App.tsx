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
import { ExtractPanel } from "./components/ExtractPanel";
import { QaPanel } from "./components/QaPanel";
import { PublishPanel } from "./components/PublishPanel";
import type { AnalyzeResult, Prereqs, ExtractItem } from "../shared/types";

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
  const [extracting, setExtracting] = useState(false);
  const [qaOpen, setQaOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  // Gate de publication (par session) : Publier reste bloqué tant que la
  // dernière QA n'est pas conforme. Une extraction change le catalogue ⇒ invalide.
  const [qaConforme, setQaConforme] = useState(false);
  // Clés extraites dans la session : jeu passé à publish.mjs --only (publication
  // chirurgicale, jamais tout le catalogue).
  const [sessionKeys, setSessionKeys] = useState<string[]>([]);
  const canExtract = count > 0 && prereqs.starbreaker && prereqs.p4k;
  const startExtract = () => {
    setSessionKeys(buildItems().map((i) => i.key));
    setQaConforme(false);
    setExtracting(true);
  };
  const buildItems = (): ExtractItem[] => {
    const out: ExtractItem[] = [];
    for (const s of data.ships) {
      const v = sel.get(s.key);
      if (!v || (!v.exterior && !v.interior)) continue;
      out.push({ key: s.key, name: s.name, lengthM: s.dims.l, wantExterior: v.exterior, wantInterior: v.interior });
    }
    return out;
  };

  return (
    <div className="app">
      <Header data={data} prereqs={prereqs} />
      <PrereqBar prereqs={prereqs} />
      <Toolbar query={query} onQuery={setQuery} filter={filter} onFilter={setFilter} alpha={alpha} onAlpha={setAlpha} onAnalyze={reload} />
      <Gallery ships={data.ships} query={query} filter={filter} alpha={alpha} sel={sel} onToggle={onToggle} />
      <div className="floating-bar">
        <button
          className="primary"
          disabled={!canExtract}
          title={canExtract ? "Lancer l'extraction clay" : "Sélection vide ou prérequis StarBreaker/Data.p4k manquants"}
          onClick={startExtract}
        >
          Extraire la sélection ({count})
        </button>
        <button
          title="Contrôle qualité géométrique de tout le catalogue avant publication"
          onClick={() => setQaOpen(true)}
        >
          Lancer la QA
        </button>
        <button
          className="primary"
          disabled={!qaConforme}
          title={qaConforme ? "Publier le catalogue sur GitHub" : "Publication bloquée : lancer la QA et obtenir un verdict conforme d'abord"}
          onClick={() => setPublishOpen(true)}
        >
          Publier sur GitHub
        </button>
      </div>
      {extracting && <ExtractPanel items={buildItems()} onClose={() => setExtracting(false)} />}
      {qaOpen && <QaPanel onClose={() => setQaOpen(false)} onDone={setQaConforme} />}
      {publishOpen && (
        <PublishPanel
          keys={sessionKeys}
          onClose={() => setPublishOpen(false)}
          onPublished={() => setQaConforme(false)}
        />
      )}
    </div>
  );
}
