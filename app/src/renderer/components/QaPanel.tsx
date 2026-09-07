import { useEffect, useReducer } from "react";
import { api } from "../api";
import { initQaState, qaReducer } from "../qaReducer";

const ICON: Record<string, string> = { pass: "✓", warn: "⚠", fail: "✗" };

export function QaPanel({ onClose, onDone }: { onClose: () => void; onDone: (conforme: boolean) => void }) {
  const [state, dispatch] = useReducer(qaReducer, initQaState());

  useEffect(() => {
    const off = api.onQaEvent((evt) => dispatch(evt));
    api.startQa()
      .then((s) => onDone(s.conforme))
      .catch((e) => dispatch({ type: "startFatal", err: String(e?.message ?? e) }));
    return off;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fails = state.rows.filter((r) => r.status === "fail").length;

  return (
    <div className="extract-panel">
      <div className="extract-head">
        <b>Contrôle qualité ({state.rows.length} vaisseau{state.rows.length > 1 ? "x" : ""}{fails ? ` · ${fails} ✗` : ""})</b>
        <div className="spacer" />
        {state.running ? <span className="detail">QA en cours…</span> : null}
        <button onClick={onClose}>Fermer</button>
      </div>
      <ul className="extract-rows">
        {state.rows.map((r) => (
          <li key={r.key} className={`row-${r.status}`}>
            <span className="ic">{ICON[r.status]}</span> {r.name}
            {r.messages.length > 0 && <span className="detail"> — {r.messages.join(" · ")}</span>}
          </li>
        ))}
      </ul>
      <pre className="extract-log">{state.log.join("\n")}</pre>
      {state.summary && (
        <p className="extract-summary">
          {state.summary.conforme ? "✓ CONFORME" : "✗ NON CONFORME"} · {state.summary.ships} vaisseau(x) ·{" "}
          {state.summary.hard} échec(s) dur(s) · {state.summary.warns} avertissement(s)
        </p>
      )}
    </div>
  );
}
