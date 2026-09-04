import type { ExtractItem, ExtractEvent, ExtractSummary } from "../shared/types";

export type RowStatus = "pending" | "running" | "done" | "skip" | "error";
export interface ExtractRow { key: string; name: string; status: RowStatus; detail?: string }
export interface ExtractState {
  running: boolean;
  rows: ExtractRow[];
  log: string[];
  summary: ExtractSummary | null;
  cancelled: boolean;
}

/** Reducer actions: wire events from the main process, plus a local terminal
 * action for when `startExtract` itself rejects (no `start`/`result` ever arrives). */
export type ExtractAction = ExtractEvent | { type: "startFatal"; err: string };

export function initExtractState(items: ExtractItem[]): ExtractState {
  return {
    running: true,
    rows: items.map((i) => ({ key: i.key, name: i.name, status: "pending" })),
    log: [],
    summary: null,
    cancelled: false,
  };
}

function setRow(rows: ExtractRow[], key: string, patch: Partial<ExtractRow>): ExtractRow[] {
  return rows.map((r) => (r.key === key ? { ...r, ...patch } : r));
}

export function extractReducer(state: ExtractState, evt: ExtractAction): ExtractState {
  switch (evt.type) {
    case "progress": {
      const status: RowStatus =
        evt.step === "start" ? "running" : evt.step === "done" ? "done" : evt.step === "skip" ? "skip" : "error";
      const detail = evt.reason ?? evt.err;
      const line =
        evt.step === "error" ? `✗ ${evt.name ?? evt.key} : ${evt.err ?? ""}` :
        evt.step === "skip" ? `⏭ ${evt.name ?? evt.key} : ${evt.reason ?? ""}` :
        evt.step === "done" ? `✓ ${evt.name ?? evt.key}` : `⏳ ${evt.name ?? evt.key}…`;
      return { ...state, rows: setRow(state.rows, evt.key, { status, detail }), log: [...state.log, line] };
    }
    case "result":
      return {
        ...state,
        running: false,
        summary: { ok: evt.ok, ko: evt.ko, skipped: evt.skipped, cancelled: state.cancelled },
        log: [...state.log, `— terminé : ${evt.ok} ok, ${evt.ko} échec(s), ${evt.skipped} ignoré(s)`],
      };
    case "cancelled":
      return { ...state, running: false, cancelled: true, log: [...state.log, `— annulé après ${evt.doneCount} vaisseau(x)`] };
    case "startFatal":
      return { ...state, running: false, log: [...state.log, `— échec du lancement : ${evt.err}`] };
    default:
      return state;
  }
}
