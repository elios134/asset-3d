export type Filter = "toProcess" | "extraits" | "all";

const TABS: Array<[Filter, string]> = [
  ["toProcess", "À traiter"], ["extraits", "Extraits"], ["all", "Tout le catalogue"],
];

export function Toolbar({
  query, onQuery, filter, onFilter, alpha, onAlpha, onAnalyze,
}: {
  query: string; onQuery: (v: string) => void;
  filter: Filter; onFilter: (f: Filter) => void;
  alpha: boolean; onAlpha: (v: boolean) => void;
  onAnalyze: () => void;
}) {
  return (
    <div className="toolbar">
      <input className="search" placeholder="Rechercher un vaisseau…" value={query} onChange={(e) => onQuery(e.target.value)} />
      <div className="tabs">
        {TABS.map(([f, label]) => (
          <button key={f} className={filter === f ? "on" : ""} onClick={() => onFilter(f)}>{label}</button>
        ))}
      </div>
      <label className="sort"><input type="checkbox" checked={alpha} onChange={(e) => onAlpha(e.target.checked)} /> A→Z</label>
      <button className="analyze" onClick={onAnalyze}>Analyser</button>
    </div>
  );
}
