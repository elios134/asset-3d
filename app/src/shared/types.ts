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
