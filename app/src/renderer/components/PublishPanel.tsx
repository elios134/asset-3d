import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { api } from "../api";
import { initPublishState, publishReducer } from "../publishReducer";
import { initPublishKeys, addPublishKey, removePublishKey, publishCandidates } from "../publishSelection";
import { keysToVerify, canAnalyze } from "../qaGate";
import { indexDiff } from "../indexDiff";
import type { IndexEntrySummary } from "../../shared/types";

const shortSha = (s: string | null) => (s ? s.slice(0, 7) : "—");
const kb = (n: number | null) => (n == null ? "—" : `${(n / 1e6).toFixed(2)} Mo`);
const SHIP_LABEL: Record<string, string> = { "new-ship": "NOUVEAU", updated: "MODIFIÉ", unchanged: "inchangé" };

// sessionKeys = clés extraites de la session (jeu par défaut). catalog = tout le catalogue
// (key+name) pour ajouter n'importe quelle clé à republier SANS la ré-extraire (re-upload correctif).
// onPublished() est appelé après une publication RÉELLE réussie (invalide le gate).
export function PublishPanel({ sessionKeys, catalog, verdicts, onClose, onPublished }: {
  sessionKeys: string[];
  catalog: Array<{ key: string; name: string }>;
  verdicts: Record<string, boolean>; // key→conforme (dernière QA) : gate par-clé
  onClose: () => void;
  onPublished: () => void;
}) {
  const [state, dispatch] = useReducer(publishReducer, initPublishState());
  // Phase "edit" : l'utilisateur ajuste le jeu de clés avant tout dry-run.
  // Phase "run" : dry-run lancé, puis confirmation. On ne revient pas en arrière une fois lancé.
  const [phase, setPhase] = useState<"edit" | "run">("edit");
  const [pubKeys, setPubKeys] = useState<string[]>(() => initPublishKeys(sessionKeys));
  const [entries, setEntries] = useState<IndexEntrySummary[]>([]);
  const started = useRef(false);
  const confirmed = useRef(false);

  useEffect(() => {
    const off = api.onPublishEvent((evt) => dispatch(evt));
    api.indexEntries().then(setEntries).catch(() => setEntries([]));
    return off;
  }, []);

  const nameOf = (k: string) => catalog.find((c) => c.key === k)?.name ?? k;
  const candidates = publishCandidates(catalog.map((c) => c.key), pubKeys);
  const toVerify = keysToVerify(pubKeys, verdicts);
  const analyzable = canAnalyze(pubKeys);

  const startDryRun = () => {
    if (started.current || !analyzable) return;
    started.current = true;
    setPhase("run");
    api.startPublish({ keys: pubKeys, confirm: false })
      .catch((e) => dispatch({ type: "startFatal", err: String(e?.message ?? e) }));
  };

  const s = state.summary;
  const dryDone = !state.running && !state.err && !!s && s.dryRun;
  const canConfirm = dryDone && (s!.wouldPatch?.length ?? 0) > 0 && !confirmed.current;
  const diff = useMemo(
    () => indexDiff(entries, state.plan.map((p) => ({ key: p.key, level: p.level, sha256: p.sha256, sizeBytes: p.sizeBytes })), state.newShips),
    [entries, state.plan, state.newShips],
  );
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
            {pubKeys.map((k) => {
              const bad = verdicts[k] !== true;
              return (
                <li key={k} className={`publish-chip${bad ? " publish-chip-bad" : ""}`} title={bad ? (k in verdicts ? "QA non conforme" : "Pas de verdict QA") : "QA conforme"}>
                  {bad ? "⚠ " : ""}{nameOf(k)} <span className="publish-chip-key">{k}</span>
                  <button className="publish-chip-x" title="Retirer" onClick={() => setPubKeys((ks) => removePublishKey(ks, k))}>×</button>
                </li>
              );
            })}
            {pubKeys.length === 0 && <li className="detail">Aucune clé — ajoutes-en au moins une.</li>}
          </ul>
          {toVerify.length > 0 && (
            <p className="warn-note">
              ⚠ À vérifier : {toVerify.length} clé(s) non conforme(s) ou sans verdict QA — {toVerify.join(", ")}.
              La QA est un avertissement : tu peux publier quand même (c'est toi qui décides), ou les retirer / relancer la QA.
            </p>
          )}
          <div className="publish-add">
            <select
              defaultValue=""
              onChange={(e) => { if (e.target.value) { setPubKeys((ks) => addPublishKey(ks, e.target.value)); e.target.value = ""; } }}
            >
              <option value="">+ ajouter un vaisseau…</option>
              {candidates.map((k) => {
                const c = catalog.find((x) => x.key === k)!;
                const bad = verdicts[k] !== true;
                return <option key={k} value={k}>{bad ? "⚠ " : ""}{c.name} ({k})</option>;
              })}
            </select>
            <button className="primary" disabled={!analyzable} onClick={startDryRun}>
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

      {dryDone && diff.length > 0 && (
        <div className="index-diff">
          <p className="detail">Changements dans index.json :</p>
          <ul className="index-diff-rows">
            {diff.map((r) => (
              <li key={r.key} className={`diff-${r.status}`}>
                <span className={`diff-badge diff-badge-${r.status}`}>{SHIP_LABEL[r.status] ?? r.status}</span>
                <b>{r.key}</b>
                <ul className="index-diff-levels">
                  {r.levels.map((l) => (
                    <li key={l.level} className="detail">
                      {l.level} · {l.status === "added" ? `ajouté (${shortSha(l.newSha)}, ${kb(l.newSize)})`
                        : l.status === "changed" ? `${shortSha(l.oldSha)} → ${shortSha(l.newSha)} · ${kb(l.oldSize)} → ${kb(l.newSize)}`
                        : `inchangé (${shortSha(l.newSha)})`}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}

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
