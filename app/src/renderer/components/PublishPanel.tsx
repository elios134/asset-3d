import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { PublishPreview, PublishResult } from "../../shared/types";

type Step = "building" | "preview" | "pushing" | "done" | "error";

export function PublishPanel({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>("building");
  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState<string>("");
  // build-index n'est lance qu'une fois (garde StrictMode, comme QaPanel/ExtractPanel).
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api.buildPublish()
      .then((p) => { setPreview(p); setStep("preview"); })
      .catch((e) => { setError(String(e?.message ?? e)); setStep("error"); });
  }, []);

  const doPush = () => {
    setStep("pushing");
    api.pushManifest()
      .then((r) => { setResult(r); setStep("done"); })
      .catch((e) => { setError(String(e?.message ?? e)); setStep("error"); });
  };

  const nothingToPublish = step === "preview" && preview!.changedFiles.length === 0;

  return (
    <div className="extract-panel">
      <div className="extract-head">
        <b>Publier sur GitHub</b>
        <div className="spacer" />
        <button onClick={onClose}>Fermer</button>
      </div>

      {step === "building" && <p className="muted">Régénération de l'index (build-index)…</p>}

      {step === "error" && <p className="err">Échec : {error}</p>}

      {preview && step !== "error" && (
        <div className="publish-preview">
          <p className="extract-summary">
            Patch <b>{preview.patchVersion}</b> · {preview.total} vaisseau(x) dans l'index
          </p>

          {preview.removed.length > 0 && (
            <p className="row-fail">
              ⚠ {preview.removed.length} vaisseau(x) SERAIENT RETIRÉS du catalogue :{" "}
              {preview.removed.join(", ")} — vérifier que models/ est complet avant de publier.
            </p>
          )}
          {preview.added.length > 0 && (
            <p className="row-pass">+ {preview.added.length} ajouté(s) : {preview.added.join(", ")}</p>
          )}

          <p className="muted">
            {nothingToPublish
              ? "Rien à publier : index.json et ships.meta.json sont déjà à jour vs HEAD."
              : `Fichiers à pousser : ${preview.changedFiles.join(", ")}`}
          </p>

          {step === "preview" && !nothingToPublish && (
            <button className="primary" onClick={doPush}>
              {preview.removed.length > 0 ? "Publier malgré les retraits" : "Confirmer et pousser"}
            </button>
          )}
          {step === "pushing" && <p className="muted">Commit + push en cours…</p>}
        </div>
      )}

      {step === "done" && result && (
        <p className="extract-summary">
          {result.nothingToCommit
            ? "✓ Rien à committer — le manifeste publié était déjà à jour."
            : `✓ Publié — commit ${result.commit} poussé.`}
        </p>
      )}
    </div>
  );
}
