import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { toggleLevel, selectionCount, type Selection } from "./selection";
import { initialSelection } from "./preselect";
import { isExcluded } from "./exclude";
import { needsUpdate } from "./gate";
import { UpdateScreen } from "./components/UpdateScreen";
import { ExtractPanel } from "./components/ExtractPanel";
import { QaPanel } from "./components/QaPanel";
import { PublishPanel } from "./components/PublishPanel";
import { shipStatus, statusCounts, worklistGroups, type ShipStatus } from "./catalogView";
import { Icon } from "./components/Icon";
import type { AnalyzeResult, Prereqs, ExtractItem, Ship, FingerprintEvent } from "../shared/types";

type Phase = "checking" | "needsUpdate" | "updating" | "ready" | "error";
type View = "catalog" | "version" | "work" | "publish";

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
    fetchData().then((d) => setPhase(needsUpdate(d.publishedVersion, d.localVersion) ? "needsUpdate" : "ready")).catch(fail);
  }, []);

  const onUpdate = async (): Promise<void> => {
    setPhase("updating");
    try { await api.updateData(); await fetchData(); setPhase("ready"); } catch (e) { fail(e); }
  };

  if (phase === "error") return <div className="center"><p className="err">Erreur : {error}</p></div>;
  if (phase === "checking" || !data || !prereqs) return <div className="center"><p className="muted">Analyse en cours…</p></div>;
  if (phase === "needsUpdate" || phase === "updating")
    return <UpdateScreen data={data} prereqs={prereqs} updating={phase === "updating"} onUpdate={onUpdate} />;

  return <AppBody data={data} prereqs={prereqs} reload={() => fetchData().catch(fail)} />;
}

function AppBody({ data, prereqs, reload }: { data: AnalyzeResult; prereqs: Prereqs; reload: () => Promise<AnalyzeResult | void> }) {
  const [view, setView] = useState<View>("catalog");
  const [sel, setSel] = useState<Selection>(() => initialSelection(data.ships));
  const count = selectionCount(sel);

  // overlays réutilisés
  const [extracting, setExtracting] = useState(false);
  const [qaOpen, setQaOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [verdicts, setVerdicts] = useState<Record<string, boolean>>({});
  const qaRan = Object.keys(verdicts).length > 0;
  const [sessionKeys, setSessionKeys] = useState<string[]>([]);

  // scan d'empreintes
  const [scan, setScan] = useState<{ done: number; total: number } | null>(null);

  const counts = useMemo(() => statusCounts(data.ships), [data.ships]);
  const groups = useMemo(() => worklistGroups(data.ships), [data.ships]);
  const worklistCount = groups.new.length + groups.mod.length + groups.int.length;

  const buildItems = (): ExtractItem[] => {
    const out: ExtractItem[] = [];
    for (const s of data.ships) {
      const v = sel.get(s.key);
      if (!v || (!v.exterior && !v.interior)) continue;
      out.push({ key: s.key, name: s.name, lengthM: s.dims.l, wantExterior: v.exterior, wantInterior: v.interior });
    }
    return out;
  };
  const canExtract = count > 0 && prereqs.starbreaker && prereqs.p4k;
  const startExtract = () => { setSessionKeys(buildItems().map((i) => i.key)); setVerdicts({}); setExtracting(true); };

  const runScan = async () => {
    if (scan) return;
    setScan({ done: 0, total: data.ships.length });
    const off = api.onFingerprintEvent((e: FingerprintEvent) => {
      if (e.type === "start") setScan({ done: 0, total: e.total });
      else if (e.type === "progress") setScan({ done: e.done, total: e.total });
    });
    try { await api.startFingerprintScan(); await reload(); }
    finally { off(); setScan(null); }
  };

  const local = data.localVersion ?? "?";
  const prod = data.publishedVersion ?? "—";
  const behind = needsUpdate(data.publishedVersion, data.localVersion);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand"><span className="logo"><Icon name="cube" stroke="#fff" /></span>asset-3D <small>Studio</small></div>
        <div className="spacer" />
        <div className="verpill">
          <span className="muted">SC local</span> <b>{local}</b>
          <span className="arrow">→</span>
          <span className="muted">prod</span> <b style={{ color: "var(--accent)" }}>{prod}</b>
          {behind ? <span className="lag">· en retard</span> : <span className="sync">· à jour</span>}
        </div>
        <div className="prereqs">
          <Prereq ok={prereqs.starbreaker} label="StarBreaker" />
          <Prereq ok={prereqs.p4k} label="p4k" />
          <Prereq ok={prereqs.git} label="git" />
          <Prereq ok={prereqs.gh} label="gh" />
        </div>
      </header>

      <main>
        {view === "catalog" && <CatalogView ships={data.ships} counts={counts} />}
        {view === "version" && (
          <VersionView data={data} counts={counts} behind={behind} scan={scan} onScan={runScan} onRefresh={() => reload()} onGoWork={() => setView("work")} worklistCount={worklistCount} />
        )}
        {view === "work" && (
          <WorkView groups={groups} sel={sel} onToggle={(k, l) => setSel((s) => toggleLevel(s, k, l))} count={count} canExtract={canExtract} onExtract={startExtract} />
        )}
        {view === "publish" && (
          <PublishView qaRan={qaRan} onQa={() => setQaOpen(true)} onPublish={() => setPublishOpen(true)} sessionKeys={sessionKeys} />
        )}
      </main>

      <nav className="fnav"><div className="bar">
        <NavBtn on={view === "catalog"} onClick={() => setView("catalog")} icon="grid" label="Catalogue" />
        <div className="fsep" />
        <NavBtn on={view === "version"} onClick={() => setView("version")} icon="chart" label="Versions" />
        <NavBtn on={view === "work"} onClick={() => setView("work")} icon="list" label="Travail" pip={worklistCount || undefined} />
        <NavBtn on={view === "publish"} onClick={() => setView("publish")} icon="upload" label="Publier" />
      </div></nav>

      {extracting && <ExtractPanel items={buildItems()} onClose={() => { setExtracting(false); reload(); }} />}
      {qaOpen && <QaPanel onClose={() => setQaOpen(false)} onDone={(_c, v) => setVerdicts(v)} />}
      {publishOpen && (
        <PublishPanel
          sessionKeys={sessionKeys}
          catalog={data.ships.map((s) => ({ key: s.key, name: s.name }))}
          verdicts={verdicts}
          onClose={() => setPublishOpen(false)}
          onPublished={() => { setVerdicts({}); reload(); }}
        />
      )}
    </div>
  );
}

function Prereq({ ok, label }: { ok: boolean; label: string }) {
  return <span className="prereq"><span className={`dot ${ok ? "ok" : "ko"}`} />{label}</span>;
}
function NavBtn({ on, onClick, icon, label, pip }: { on: boolean; onClick: () => void; icon: string; label: string; pip?: number }) {
  return (
    <button className={`fbtn${on ? " on" : ""}`} onClick={onClick} title={label}>
      <Icon name={icon} />{pip ? <span className="pip">{pip}</span> : null}<span className="lab">{label}</span>
    </button>
  );
}

const ST_LABEL: Record<ShipStatus, string> = { new: "Absent", mod: "Modifié", int: "Intér.", ok: "À jour" };

function CatalogView({ ships, counts }: { ships: Ship[]; counts: ReturnType<typeof statusCounts> }) {
  const [q, setQ] = useState("");
  const [f, setF] = useState<"all" | ShipStatus>("all");
  const list = useMemo(() => {
    const query = q.toLowerCase();
    return ships.filter((s) => {
      if (f !== "all" && shipStatus(s) !== f) return false;
      if (query && !(s.name.toLowerCase().includes(query) || s.key.toLowerCase().includes(query) || s.manufacturer.toLowerCase().includes(query))) return false;
      return true;
    });
  }, [ships, q, f]);

  return (
    <section className="view">
      <div className="rowflex">
        <div>
          <h2>Catalogue</h2>
          <p className="sub" style={{ margin: 0 }}>{counts.all} vaisseaux · <span style={{ color: "var(--emerald)" }}>{counts.ok} à jour</span> · états calculés par empreinte de source.</p>
        </div>
        <div className="spacer" />
        <div className="searchbox"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un vaisseau…" /></div>
      </div>
      <div className="filters">
        <Chip on={f === "all"} onClick={() => setF("all")} label="Tous" n={counts.all} />
        <Chip on={f === "new"} onClick={() => setF("new")} label="Absents" n={counts.new} gd="var(--rose)" />
        <Chip on={f === "mod"} onClick={() => setF("mod")} label="Modifiés" n={counts.mod} gd="var(--amber)" />
        <Chip on={f === "int"} onClick={() => setF("int")} label="Intérieur manquant" n={counts.int} gd="var(--accent)" />
        <Chip on={f === "ok"} onClick={() => setF("ok")} label="À jour" n={counts.ok} gd="var(--emerald)" />
      </div>
      <div className="catgrid">
        {list.map((s) => {
          const st = shipStatus(s);
          return (
            <div className="cc" key={s.key} title={s.key}>
              <div className="top"><span className={`st ${st}`}>{ST_LABEL[st]}</span><Icon name="ship" /><span className="dim">{Math.round(s.dims.l)} m</span></div>
              <div className="bd"><div className="bn">{s.name}</div><div className="bm">{s.manufacturer}</div></div>
            </div>
          );
        })}
      </div>
      {list.length === 0 && <p className="sub" style={{ textAlign: "center", padding: 40 }}>Aucun vaisseau ne correspond.</p>}
    </section>
  );
}

function VersionView({ data, counts, behind, scan, onScan, onRefresh, onGoWork, worklistCount }: {
  data: AnalyzeResult; counts: ReturnType<typeof statusCounts>; behind: boolean;
  scan: { done: number; total: number } | null; onScan: () => void; onRefresh: () => void; onGoWork: () => void; worklistCount: number;
}) {
  const pct = scan && scan.total ? Math.round((scan.done / scan.total) * 100) : 0;
  return (
    <section className="view">
      <h2>Comparaison de version</h2>
      <p className="sub">La version de Star Citizen installée sur ton PC face à celle qui alimente les assets en prod.</p>
      <div className="vhero">
        <div className="vcard local"><div className="lbl">SC sur ton ordinateur</div><div className="big">{data.localVersion ?? "?"}</div><div className="chan">build_manifest.id</div></div>
        <div className="vmid"><span className={`ico ${behind ? "warn" : "ok"}`}><Icon name={behind ? "alert" : "check"} /></span></div>
        <div className="vcard prod"><div className="lbl">Assets en prod (index.json)</div><div className="big">{data.publishedVersion ?? "—"}</div><div className="chan">catalogue consommé par SCFM V2</div></div>
      </div>

      {scan ? (
        <>
          <p className="sub" style={{ margin: "0 0 6px" }}>Scan des empreintes… {scan.done}/{scan.total}</p>
          <div className="progress"><i style={{ width: `${pct}%` }} /></div>
        </>
      ) : behind ? (
        <div className="banner warn"><Icon name="alert" /><span><b>{worklistCount} vaisseaux</b> à traiter (absents en prod ou source modifiée). Les autres sont identiques et n'ont pas besoin d'être retouchés.</span></div>
      ) : (
        <div className="banner ok"><Icon name="check" /><span>Prod alignée sur la version locale. <b>{worklistCount}</b> vaisseau(x) à traiter.</span></div>
      )}

      <div className="statrow">
        <div className="stat"><div className="k">Catalogue</div><div className="v">{counts.all}</div></div>
        <div className="stat rose"><div className="k">Absents en prod</div><div className="v">{counts.new}</div></div>
        <div className="stat amber"><div className="k">Modifiés</div><div className="v">{counts.mod}</div></div>
        <div className="stat accent"><div className="k">Intérieur manquant</div><div className="v">{counts.int}</div></div>
        <div className="stat emerald"><div className="k">À jour</div><div className="v">{counts.ok}</div></div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button className="btn primary" disabled={!!scan} onClick={onScan}><Icon name="scan" />{scan ? "Scan en cours…" : "Scanner les empreintes"}</button>
        <button className="btn ghost" disabled={!!scan} onClick={onRefresh}><Icon name="refresh" />Rafraîchir</button>
        <button className="btn" onClick={onGoWork}><Icon name="list" />Voir la liste de travail</button>
      </div>
    </section>
  );
}

function WorkView({ groups, sel, onToggle, count, canExtract, onExtract }: {
  groups: ReturnType<typeof worklistGroups>; sel: Selection; onToggle: (k: string, l: "exterior" | "interior") => void;
  count: number; canExtract: boolean; onExtract: () => void;
}) {
  const total = groups.new.length + groups.mod.length + groups.int.length;
  const gmeta: Array<[keyof typeof groups, string, string]> = [
    ["new", "var(--rose)", "Absents en prod"], ["mod", "var(--amber)", "Modifiés depuis la prod"], ["int", "var(--accent)", "Intérieur manquant"],
  ];
  return (
    <section className="view">
      <h2>Liste de travail</h2>
      <p className="sub">Seuls les vaisseaux qui ont besoin d'action. La prod manuelle fait foi — rien d'« à jour » n'est proposé.</p>
      {total === 0 && <div className="banner ok"><Icon name="check" /><span>Rien à traiter : tout est à jour ou déjà en prod.</span></div>}
      {gmeta.map(([g, color, title]) => groups[g].length > 0 && (
        <div className="group" key={g}>
          <div className="grouphd"><span className="gd" style={{ background: color }} />{title} <span className="cnt">· {groups[g].length}</span></div>
          {groups[g].map((s) => {
            const v = sel.get(s.key);
            const on = !!v && (v.exterior || v.interior);
            return (
              <div className={`ship${on ? " sel" : ""}`} key={s.key}>
                <span className="ck"><Icon name="check" /></span>
                <span className="thumb"><Icon name="ship" /></span>
                <span className="sinfo">
                  <span className="nm">{s.name} <span className={`tag ${g}`}>{ST_LABEL[shipStatus(s)]}</span></span>
                  <span className="mf">{s.manufacturer} · {s.key}</span>
                  <span className="why">{s.reasons.join(" · ") || "à traiter"}</span>
                </span>
                <span className="lvlbtns">
                  <button className={`lvlbtn${v?.exterior ? " on" : ""}`} onClick={() => onToggle(s.key, "exterior")}>Extérieur</button>
                  <button className={`lvlbtn${v?.interior ? " on" : ""}`} onClick={() => onToggle(s.key, "interior")}>Intérieur</button>
                </span>
              </div>
            );
          })}
        </div>
      ))}
      <div className="actionbar">
        <span className="info"><b>{count}</b> niveau(x) sélectionné(s)</span>
        <div className="spacer" />
        <button className="btn primary" disabled={!canExtract} onClick={onExtract} title={canExtract ? "Lancer l'extraction clay" : "Sélection vide ou prérequis StarBreaker/Data.p4k manquants"}>
          <Icon name="download" />Extraire la sélection
        </button>
      </div>
    </section>
  );
}

function PublishView({ qaRan, onQa, onPublish, sessionKeys }: { qaRan: boolean; onQa: () => void; onPublish: () => void; sessionKeys: string[] }) {
  return (
    <section className="view">
      <h2>Publier pour SCFM V2</h2>
      <p className="sub">Contrôle qualité (avertissement, jamais bloquant), puis upload Release + patch d'<code>index.json</code>. Seul le clic « Confirmer » écrit en prod.</p>
      {sessionKeys.length === 0
        ? <div className="banner warn"><Icon name="alert" /><span>Aucune extraction cette session. Va extraire des vaisseaux d'abord, ou ajoute des clés à republier dans le panneau Publier.</span></div>
        : <div className="banner ok"><Icon name="check" /><span><b>{sessionKeys.length}</b> vaisseau(x) extrait(s) cette session, prêts à publier.</span></div>}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button className="btn" onClick={onQa}><Icon name="check" />Lancer la QA</button>
        <button className="btn primary" disabled={!qaRan} onClick={onPublish} title={qaRan ? "Publier (clés conformes)" : "Lance la QA d'abord"}><Icon name="upload" />Publier sur GitHub</button>
      </div>
    </section>
  );
}

function Chip({ on, onClick, label, n, gd }: { on: boolean; onClick: () => void; label: string; n: number; gd?: string }) {
  return <span className={`chip${on ? " on" : ""}`} onClick={onClick}>{gd && <span className="gd" style={{ background: gd }} />}{label} <span className="n">{n}</span></span>;
}
