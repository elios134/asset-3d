import { useEffect, useReducer, useRef } from "react";
import { api } from "../api";
import { initPublishState, publishReducer } from "../publishReducer";

// keys = clés extraites de la session (QA conforme) à publier via --only.
// onPublished() est appelé après une publication RÉELLE réussie (invalide le gate).
export function PublishPanel({ keys, onClose, onPublished }: {
  keys: string[];
  onClose: () => void;
  onPublished: () => void;
}) {
  const [state, dispatch] = useReducer(publishReducer, initPublishState());
  // StrictMode (dev) invoque l'effet deux fois : sans garde le 2e dry-run tombe
  // sur le verrou main ("déjà en cours"). On ne lance le dry-run qu'une fois.
  const started = useRef(false);
  const confirmed = useRef(false);

  useEffect(() => {
    const off = api.onPublishEvent((evt) => dispatch(evt));
    if (!started.current) {
      started.current = true;
      if (keys.length === 0) {
        dispatch({ type: "startFatal", err: "Aucune clé extraite dans cette session — rien à publier." });
      } else {
        api.startPublish({ keys, confirm: false })
          .catch((e) => dispatch({ type: "startFatal", err: String(e?.message ?? e) }));
      }
    }
    return off;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const s = state.summary;
  const dryDone = !state.running && !state.err && !!s && s.dryRun;
  const canConfirm = dryDone && (s!.wouldPatch?.length ?? 0) > 0 && !confirmed.current;
  const publishedOk = !state.running && !state.err && !!s && !s.dryRun;

  // Une publication réelle réussie invalide le gate (comme une extraction).
  useEffect(() => { if (publishedOk) onPublished(); }, [publishedOk]); // eslint-disable-line react-hooks/exhaustive-deps

  const doConfirm = () => {
    if (confirmed.current) return;
    confirmed.current = true;
    dispatch({ type: "reset", dryRun: false });
    api.startPublish({ keys, confirm: true })
      .catch((e) => dispatch({ type: "startFatal", err: String(e?.message ?? e) }));
  };

  return (
    <div className="extract-panel">
      <div className="extract-head">
        <b>Publier sur GitHub{keys.length ? ` (${keys.length} vaisseau${keys.length > 1 ? "x" : ""})` : ""}</b>
        <div className="spacer" />
        {state.running && <span className="detail">{state.dryRun ? "Analyse (dry-run)…" : "Publication en cours…"}</span>}
        <button onClick={onClose}>Fermer</button>
      </div>

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

      <pre className="extract-log">{state.log.join("\n")}</pre>

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
