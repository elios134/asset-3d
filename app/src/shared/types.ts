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
