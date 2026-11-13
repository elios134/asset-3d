import { useEffect, useState } from "react";
import { api } from "../api";
import { Icon } from "./Icon";
import type { ConfigStatus, ConfigKey, DetectedPaths } from "../../shared/types";

const ROWS: Array<{ key: ConfigKey; label: string; optional?: boolean }> = [
  { key: "p4k", label: "Star Citizen" },
  { key: "starbreaker", label: "StarBreaker" },
  { key: "blender", label: "Blender", optional: true },
];

// Bloc « Configuration des chemins » : auto-détection + sélection manuelle.
// Aucun chemin codé en dur ; tout est écrit dans app-config.json (machine-local).
export function ConfigPanel({ onChange }: { onChange?: () => void }) {
  const [cfg, setCfg] = useState<ConfigStatus | null>(null);
  const [detected, setDetected] = useState<DetectedPaths | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => api.getConfig().then(setCfg).catch((e) => setErr(msg(e)));
  useEffect(() => { void load(); }, []);

  const run = async (fn: () => Promise<ConfigStatus>) => {
    setBusy(true); setErr(null);
    try { setCfg(await fn()); setDetected(null); onChange?.(); }
    catch (e) { setErr(msg(e)); }
    finally { setBusy(false); }
  };

  const detect = async () => {
    setBusy(true); setErr(null);
    try { setDetected(await api.detectPaths()); }
    catch (e) { setErr(msg(e)); }
    finally { setBusy(false); }
  };

  if (!cfg) return null;
  const allReady = cfg.exists.p4k && cfg.exists.starbreaker;

  return (
    <div className="cfg">
      <div className="cfg-head">
        <span className="ci"><Icon name="settings" /></span>
        <h3>Configuration des chemins</h3>
        <span className="cfg-badge">
          <span className={`dot ${allReady ? "ok" : "ko"}`} />
          {allReady ? "Tout est prêt" : "Star Citizen introuvable"}
        </span>
      </div>

      {ROWS.map(({ key, label, optional }) => {
        const path = cfg.paths[key];
        const ok = cfg.exists[key];
        const suggestion = key !== "blender" ? detected?.[key] ?? null : null;
        const showSuggest = suggestion && suggestion !== path;
        return (
          <div className="prow" key={key}>
            <div className="k">
              <span className={`dot ${ok ? "ok" : optional ? "" : "ko"}`} />
              {label}{optional && <span className="opt">(optionnel)</span>}
            </div>
            <div className={`path ${path ? "" : "empty"}`} title={path ?? undefined}>
              {path ?? "Aucun chemin — clique sur « Détecter » ou « Parcourir »"}
            </div>
            <div className="acts">
              <button className="btn mini ghost" disabled={busy} onClick={() => run(() => api.pickConfigPath(key))}>
                <Icon name="folder" />Parcourir…
              </button>
            </div>
            {showSuggest && (
              <div className="detectbar">
                <Icon name="check" />
                <span className="grow">Trouvé : <b>{suggestion}</b></span>
                <button className="btn mini primary" disabled={busy} onClick={() => run(() => api.setConfigPath(key, suggestion!))}>
                  Utiliser
                </button>
              </div>
            )}
          </div>
        );
      })}

      <div className="cfg-foot">
        <button className="btn primary" disabled={busy} onClick={detect}>
          <Icon name="search" />{busy ? "Recherche…" : "Détecter automatiquement"}
        </button>
        <button className="btn ghost" disabled={busy} onClick={() => void load()}>
          <Icon name="refresh" />Revérifier
        </button>
      </div>

      {err && <p className="err cfg-err">{err}</p>}
      <p className="cfg-hint">
        Le chemin Star Citizen pointe sur le fichier <code>Data.p4k</code> du canal voulu (LIVE, PTU…).
        Les chemins sont enregistrés dans <code>app-config.json</code>, propre à ta machine (jamais poussé sur GitHub).
      </p>
    </div>
  );
}

const msg = (e: unknown) => String((e as Error)?.message ?? e);
