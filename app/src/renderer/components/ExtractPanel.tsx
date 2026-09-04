import { useEffect, useReducer } from "react";
import { api } from "../api";
import { initExtractState, extractReducer } from "../extractReducer";
import type { ExtractItem } from "../../shared/types";

const ICON: Record<string, string> = { pending: "•", running: "⏳", done: "✓", skip: "⏭", error: "✗" };

export function ExtractPanel({ items, onClose }: { items: ExtractItem[]; onClose: () => void }) {
  const [state, dispatch] = useReducer(extractReducer, items, initExtractState);

  useEffect(() => {
    const off = api.onExtractEvent((evt) => dispatch(evt));
    api.startExtract(items).catch((e) => dispatch({ type: "progress", key: "?", step: "error", err: String(e?.message ?? e) }));
    return off;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="extract-panel">
      <div className="extract-head">
        <b>Extraction ({state.rows.length} vaisseau{state.rows.length > 1 ? "x" : ""})</b>
        <div className="spacer" />
        {state.running
          ? <button onClick={() => api.cancelExtract()}>Annuler</button>
          : <button onClick={onClose}>Fermer</button>}
      </div>
      <ul className="extract-rows">
        {state.rows.map((r) => (
          <li key={r.key} className={`row-${r.status}`}>
            <span className="ic">{ICON[r.status]}</span> {r.name}
            {r.detail && <span className="detail"> — {r.detail}</span>}
          </li>
        ))}
      </ul>
      <pre className="extract-log">{state.log.join("\n")}</pre>
      {state.summary && (
        <p className="extract-summary">
          {state.summary.ok} ok · {state.summary.ko} échec(s) · {state.summary.skipped} ignoré(s)
          {state.summary.cancelled ? " · annulé" : ""}
        </p>
      )}
    </div>
  );
}
