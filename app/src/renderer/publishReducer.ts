import type { PublishEvent, PublishSummary } from "../shared/types";

export interface PublishPlanRow { key: string; level: string; file: string; tris: number; sizeBytes: number }
export interface PublishSkip { key: string; reason: string }

export interface PublishState {
  running: boolean;
  dryRun: boolean;              // le run courant/dernier est-il un dry-run ?
  plan: PublishPlanRow[];       // événements "plan" du run courant
  skips: PublishSkip[];         // événements "skip" du run courant
  log: string[];
  summary: PublishSummary | null; // dernier "done"
  err: string | null;
}

// Actions = événements du script publish.mjs, plus deux actions locales :
//  - "reset" : redémarre l'accumulation pour le run réel (2e clic « Confirmer »).
//  - "startFatal" : startPublish a rejeté avant tout événement.
export type PublishAction =
  | PublishEvent
  | { type: "reset"; dryRun: boolean }
  | { type: "startFatal"; err: string };

export function initPublishState(): PublishState {
  return { running: true, dryRun: true, plan: [], skips: [], log: [], summary: null, err: null };
}

const REASON: Record<string, string> = { "no-glb": "aucun .glb clay dans models/", "no-meta": "absent de ships.meta.json" };

export function publishReducer(state: PublishState, evt: PublishAction): PublishState {
  switch (evt.type) {
    case "reset":
      return { running: true, dryRun: evt.dryRun, plan: [], skips: [], summary: null, err: null,
        log: [...state.log, "— Publication réelle : upload Release + patch index.json + push…"] };

    case "start":
      // Ré-amorce le run (le dry-run initial ou le run réel) sans perdre le journal.
      return { ...state, running: true, dryRun: evt.dryRun, plan: [], skips: [], summary: null,
        log: [...state.log, `— ${evt.dryRun ? "Plan (dry-run)" : "Publication"} · patch ${evt.patchVersion} · ${evt.keys.length} clé(s) : ${evt.keys.join(", ")}`] };

    case "plan": {
      const row: PublishPlanRow = { key: evt.key, level: evt.level, file: evt.file, tris: evt.tris, sizeBytes: evt.sizeBytes };
      return { ...state, plan: [...state.plan, row], log: [...state.log, `  ${evt.file} · ${evt.tris.toLocaleString("fr-FR")} tris · ${(evt.sizeBytes / 1e6).toFixed(2)} Mo`] };
    }

    case "new-ship":
      return { ...state, log: [...state.log, `  + nouveau vaisseau : ${evt.key}`] };

    case "skip":
      return { ...state, skips: [...state.skips, { key: evt.key, reason: evt.reason }],
        log: [...state.log, `  ⚠ ${evt.key} ignoré : ${REASON[evt.reason] ?? evt.reason}`] };

    case "upload":
      return { ...state, log: [...state.log, `  ${evt.status === "start" ? "↑ upload" : "✓ uploadé"} ${evt.file}`] };

    case "index-written":
      return { ...state, log: [...state.log, `  ✓ index.json patché (${evt.keys.join(", ")})`] };

    case "git":
      return { ...state, log: [...state.log, evt.status === "start" ? "  ↑ git commit + push…" : "  ✓ index.json poussé"] };

    case "done": {
      const { type: _t, ...summary } = evt;
      const line = evt.dryRun
        ? `— Plan : ${(evt.wouldPatch ?? []).length} clé(s), ${(evt.wouldUpload ?? []).length} fichier(s). Rien n'a été fait.`
        : `— Publié : ${(evt.published ?? []).join(", ")}${evt.pushed ? " + push" : ""}.`;
      return { ...state, running: false, summary,
        log: [...state.log, line, ...(evt.problems.length ? evt.problems.map((p) => `  ⚠ ${p}`) : [])] };
    }

    case "error":
      return { ...state, running: false, err: evt.message, log: [...state.log, `— erreur : ${evt.message}`] };

    case "startFatal":
      return { ...state, running: false, err: evt.err, log: [...state.log, `— échec du lancement : ${evt.err}`] };

    default:
      return state;
  }
}
