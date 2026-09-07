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
  buildPublish(): Promise<PublishPreview>;
  pushManifest(): Promise<PublishResult>;
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

// --- Publication (regenere index.json puis pousse le manifeste) ---
// Etape 1 : build-index regenere index.json depuis models/ ; on compare l'ensemble
// des vaisseaux au dernier index publie (HEAD) pour exposer added/removed (garde-fou :
// une regeneration ne doit pas SUPPRIMER des vaisseaux a l'insu de l'utilisateur).
export interface PublishPreview {
  patchVersion: string;
  total: number;          // vaisseaux dans le nouvel index
  added: string[];        // clefs presentes dans le nouvel index, absentes de HEAD
  removed: string[];      // clefs de HEAD absentes du nouvel index (a confirmer !)
  changedFiles: string[]; // parmi index.json / ships.meta.json : ce qui differe de HEAD
}
// Etape 2 : commit + push de index.json + ships.meta.json.
export interface PublishResult {
  pushed: boolean;
  nothingToCommit?: boolean; // rien n'a change depuis HEAD
  commit?: string;           // hash court du commit pousse
}
