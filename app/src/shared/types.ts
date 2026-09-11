export interface ShipDims { l: number; b: number; h: number }

export interface Ship {
  key: string;
  name: string;
  manufacturer: string;
  dims: ShipDims;
  exterior: { published: boolean; patchVersion: string | null };
  interior: { published: boolean; anchored: boolean };
  visitable: boolean;
  reasons: string[];
  status: string;
  toProcess: boolean;
  availableLevels: Array<"exterior" | "interior">;
}

export interface AnalyzeResult {
  localVersion: string | null;
  publishedVersion: string | null;
  counts: { toProcess: number; total: number };
  ships: Ship[];
}

export interface Prereqs { node: boolean; starbreaker: boolean; p4k: boolean; git: boolean; gh: boolean }

export interface Api {
  analyze(): Promise<AnalyzeResult>;
  prereqs(): Promise<Prereqs>;
  getThumbnail(name: string): Promise<string | null>;
  updateData(): Promise<{ ok: boolean; count: number }>;
  startExtract(items: ExtractItem[]): Promise<ExtractSummary>;
  cancelExtract(): Promise<void>;
  onExtractEvent(cb: (evt: ExtractEvent) => void): () => void;
  startQa(): Promise<QaSummary>;
  onQaEvent(cb: (evt: QaEvent) => void): () => void;
  startPublish(opts: PublishOptions): Promise<PublishSummary>;
  onPublishEvent(cb: (evt: PublishEvent) => void): () => void;
}

export interface ExtractItem {
  key: string;
  name: string;
  lengthM: number;
  wantExterior: boolean;
  wantInterior: boolean;
}

export type ExtractEvent =
  | { type: "progress"; key: string; name?: string; step: "start" | "done" | "skip" | "error";
      extTris?: number; intTris?: number; extBytes?: number; intBytes?: number; reason?: string; err?: string }
  | { type: "plan"; key: string; name?: string; extOnly?: boolean }
  | { type: "result"; ok: number; ko: number; skipped: number }
  | { type: "cancelled"; doneCount: number };

export interface ExtractSummary { ok: number; ko: number; skipped: number; cancelled: boolean }

// --- QA (contrôle qualité géométrique avant publication) ---
// Un seul run couvre tout le catalogue clay. Émis par scripts/qa.mjs --json.
export type QaEvent =
  | { type: "ship"; key: string; name: string; hard: number; warns: number; messages: string[] }
  | { type: "result"; conforme: boolean; ships: number; hard: number; warns: number };

export interface QaSummary { conforme: boolean; ships: number; hard: number; warns: number }

// --- Publication CHIRURGICALE (scripts/publish.mjs --only=… --json) ---
// Part de l'index PUBLIE (index.json git-tracké = vérité) et ne patche QUE les
// clés `keys` ; les orphelins/tests présents dans models/ ne sont JAMAIS embarqués
// (garde-fou build-index intégré au moteur). Deux phases pilotées par l'app :
//   1. dry-run (confirm:false) : plan seul, aucun effet de bord.
//   2. réel (confirm:true) : upload Release (--clobber) + patch index.json + push.
// La phase réelle n'est lancée QUE sur action user explicite (2e clic « Confirmer »).
export interface PublishOptions {
  keys: string[];   // --only=<keys> : sous-ensemble à publier (clés extraites de la session)
  confirm: boolean; // false = dry-run ; true = --confirm --push (effets de bord)
}

// Événements NDJSON émis par publish.mjs (terminal = "done").
export type PublishEvent =
  | { type: "start"; dryRun: boolean; push: boolean; patchVersion: string; keys: string[] }
  | { type: "skip"; key: string; reason: string }
  | { type: "new-ship"; key: string }
  | { type: "plan"; key: string; level: string; file: string; tris: number; sizeBytes: number; sha256: string }
  | { type: "upload"; file: string; status: "start" | "done" }
  | { type: "index-written"; keys: string[] }
  | { type: "git"; status: "start" | "done" }
  | { type: "error"; message: string }
  | {
      type: "done";
      dryRun: boolean;
      wouldUpload?: string[]; // dry-run : fichiers qui seraient uploadés
      wouldPatch?: string[];  // dry-run : clés qui seraient patchées
      published?: string[];   // réel : clés patchées
      uploaded?: string[];    // réel : fichiers uploadés
      pushed?: boolean;       // réel : index.json poussé ?
      problems: string[];
    };

// Résumé terminal (= l'événement "done" sans son champ type).
export type PublishSummary = Omit<Extract<PublishEvent, { type: "done" }>, "type">;
