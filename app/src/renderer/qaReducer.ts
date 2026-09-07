import type { QaEvent, QaSummary } from "../shared/types";

export type QaRowStatus = "pass" | "warn" | "fail";
export interface QaRow { key: string; name: string; status: QaRowStatus; hard: number; warns: number; messages: string[] }
export interface QaState {
  running: boolean;
  rows: QaRow[];
  log: string[];
  summary: QaSummary | null;
}

/** Actions : événements du script QA, plus une action terminale locale pour
 * quand `startQa` lui-même rejette (aucun `ship`/`result` n'arrive jamais). */
export type QaAction = QaEvent | { type: "startFatal"; err: string };

export function initQaState(): QaState {
  // QA = un run global : on ne connaît pas les vaisseaux d'avance, les lignes
  // s'accumulent au fil des événements `ship`.
  return { running: true, rows: [], log: [], summary: null };
}

export function qaReducer(state: QaState, evt: QaAction): QaState {
  switch (evt.type) {
    case "ship": {
      const status: QaRowStatus = evt.hard > 0 ? "fail" : evt.warns > 0 ? "warn" : "pass";
      const row: QaRow = { key: evt.key, name: evt.name, status, hard: evt.hard, warns: evt.warns, messages: evt.messages };
      const line =
        status === "fail" ? `✗ ${evt.name} : ${evt.messages.join(" · ") || `${evt.hard} échec(s) dur(s)`}` :
        status === "warn" ? `⚠ ${evt.name} : ${evt.messages.join(" · ") || `${evt.warns} avertissement(s)`}` :
        `✓ ${evt.name}`;
      return { ...state, rows: [...state.rows, row], log: [...state.log, line] };
    }
    case "result":
      return {
        ...state,
        running: false,
        summary: { conforme: evt.conforme, ships: evt.ships, hard: evt.hard, warns: evt.warns },
        log: [...state.log, `— ${evt.conforme ? "CONFORME" : "NON CONFORME"} : ${evt.ships} vaisseau(x), ${evt.hard} échec(s) dur(s), ${evt.warns} avertissement(s)`],
      };
    case "startFatal":
      return { ...state, running: false, log: [...state.log, `— échec du lancement : ${evt.err}`] };
    default:
      return state;
  }
}
