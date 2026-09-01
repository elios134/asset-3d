export type Filter = "toProcess" | "all";

export function Toolbar({
  query, onQuery, filter, onFilter, onAnalyze,
}: {
  query: string; onQuery: (v: string) => void;
  filter: Filter; onFilter: (f: Filter) => void;
  onAnalyze: () => void;
}) {
  return (
    <div className="toolbar">
      <input className="search" placeholder="Rechercher un vaisseau…" value={query} onChange={(e) => onQuery(e.target.value)} />
      <div className="tabs">
        <button className={filter === "toProcess" ? "on" : ""} onClick={() => onFilter("toProcess")}>À traiter</button>
        <button className={filter === "all" ? "on" : ""} onClick={() => onFilter("all")}>Tout le catalogue</button>
      </div>
      <button className="analyze" onClick={onAnalyze}>Analyser</button>
    </div>
  );
}
