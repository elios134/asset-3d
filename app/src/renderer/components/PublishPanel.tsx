import { useEffect, useReducer, useRef, useState } from "react";
import { api } from "../api";
import { initPublishState, publishReducer } from "../publishReducer";
import { initPublishKeys, addPublishKey, removePublishKey, publishCandidates, canPublish } from "../publishSelection";

// sessionKeys = clés extraites de la session (jeu par défaut). catalog = tout le catalogue
// (key+name) pour ajouter n'importe quelle clé à republier SANS la ré-extraire (re-upload correctif).
// onPublished() est appelé après une publication RÉELLE réussie (invalide le gate).
export function PublishPanel({ sessionKeys, catalog, onClose, onPublished }: {
  sessionKeys: string[];
  catalog: Array<{ key: string; name: string }>;
  onClose: () => void;
  onPublished: () => void;
}) {
  const [state, dispatch] = useReducer(publishReducer, initPublishState());
  // Phase "edit" : l'utilisateur ajuste le jeu de clés avant tout dry-run.
  // Phase "run" : dry-run lancé, puis confirmation. On ne revient pas en arrière une fois lancé.
  const [phase, setPhase] = useState<"edit" | "run">("edit");
  const [pubKeys, setPubKeys] = useState<string[]>(() => initPublishKeys(sessionKeys));
  const started = useRef(false);
  const confirmed = useRef(false);

  useEffect(() => {
    const off = api.onPublishEvent((evt) => dispatch(evt));
    return off;
  }, []);

  const nameOf = (k: string) => catalog.find((c) => c.key === k)?.name ?? k;
  const candidates = publishCandidates(catalog.map((c) => c.key), pubKeys);

  const startDryRun = () => {
    if (started.current || !canPublish(pubKeys)) return;
    started.current = true;
    setPhase("run");
    api.startPublish({ keys: pubKeys, confirm: false })
      .catch((e) => dispatch({ type: "startFatal", err: String(e?.message ?? e) }));
  };

  const s = state.summary;
  const dryDone = !state.running && !state.err && !!s && s.dryRun;
  const canConfirm = dryDone && (s!.wouldPatch?.length ?? 0) > 0 && !confirmed.current;
  const publishedOk = !state.running && !state.err && !!s && !s.dryRun;

  useEffect(() => { if (publishedOk) onPublished(); }, [publishedOk]); // eslint-disable-line react-hooks/exhaustive-deps

  const doConfirm = () => {
    if (confirmed.current) return;
    confirmed.current = true;
    dispatch({ type: "reset", dryRun: false });
    api.startPublish({ keys: pubKeys, confirm: true })
      .catch((e) => dispatch({ type: "startFatal", err: String(e?.message ?? e) }));
  };

  return (
    <div className="extract-panel">
      <div className="extract-head">
        <b>Publier sur GitHub{pubKeys.length ? ` (${pubKeys.length} vaisseau${pubKeys.length > 1 ? "x" : ""})` : ""}</b>
        <div className="spacer" />
        {state.running && <span className="detail">{state.dryRun ? "Analyse (dry-run)…" : "Publication en cours…"}</span>}
        <button onClick={onClose}>Fermer</button>
      </div>

      {phase === "edit" && (
        <div className="publish-edit">
          <p className="detail">
            Vaisseaux à publier — par défaut les clés extraites cette session. Ajoute-en pour republier un vaisseau
            corrigé à la main sans le ré-extraire ; retire-en pour en exclure.
          </p>
          <ul className="publish-chips">
            {pubKeys.map((k) => (
              <li key={k} className="publish-chip">
                {nameOf(k)} <span className="publish-chip-key">{k}</span>
                <button className="publish-chip-x" title="Retirer" onClick={() => setPubKeys((ks) => removePublishKey(ks, k))}>×</button>
              </li>
            ))}
            {pubKeys.length === 0 && <li className="detail">Aucune clé — ajoutes-en au moins une.</li>}
          </ul>
          <div className="publish-add">
            <select
              defaultValue=""
              onChange={(e) => { if (e.target.value) { setPubKeys((ks) => addPublishKey(ks, e.target.value)); e.target.value = ""; } }}
            >
              <option value="">+ ajouter un vaisseau…</option>
              {candidates.map((k) => {
                const c = catalog.find((x) => x.key === k)!;
                return <option key={k} value={k}>{c.name} ({k})</option>;
              })}
            </select>
            <button className="primary" disabled={!canPublish(pubKeys)} onClick={startDryRun}>
              Analyser (dry-run)
            </button>
          </div>
        </div>
      )}

      {state.plan.length > 0 && (
        <ul className="extract-rows">
          {state.plan.map((r) => (
            <li key={r.file} className="row-pass">
              <span className="ic">•</span> {r.file}
              <span className="detail"> — {r.tris.toLocaleString("fr-FR")} tris · {(r.sizeBytes / 1e6).toFixed(2)} Mo</span>
            </li>
          ))}
        </ul>
      )}

      {state.skips.length > 0 && (
        <ul className="extract-rows">
          {state.skips.map((k) => (
            <li key={k.key} className="row-fail"><span className="ic">⚠</span> {k.key} ignoré ({k.reason})</li>
          ))}
        </ul>
      )}

      {phase === "run" && <pre className="extract-log">{state.log.join("\n")}</pre>}

      {state.err && <p className="err">Échec : {state.err}</p>}

      {canConfirm && (
        <div className="publish-confirm">
          <p className="detail">
            Prêt à publier {s!.wouldPatch!.length} clé(s) — {s!.wouldUpload!.length} fichier(s) uploadés sur la Release, index.json patché puis poussé.
          </p>
          <button className="primary" onClick={doConfirm}>Confirmer la publication</button>
        </div>
      )}

      {publishedOk && (
        <p className="extract-summary">
          ✓ Publié — {(s!.published ?? []).join(", ")}
          {s!.pushed ? " · index.json poussé" : " · index.json écrit (non poussé)"}
        </p>
      )}
    </div>
  );
}
