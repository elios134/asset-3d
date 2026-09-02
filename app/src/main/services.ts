import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runJson } from "./runner";
import { loadLib } from "./libs";
import { loadVisitableSet } from "./visitable";
import { resolveScfleetDb } from "./appconfig";
import { runUpdate } from "./update";
import type { AnalyzeResult, Prereqs } from "../shared/types";

type ConfigLib = { loadConfig(opts: { root: string }): { paths: { starbreaker: string; p4k: string } } };
type PrereqLib = {
  checkPrereqs(a: { paths?: { starbreaker?: string; p4k?: string }; which?: (c: string) => boolean }): Prereqs;
  defaultWhich(cmd: string): boolean;
};
type ThumbLib = { getThumbnail(a: { name: string; cacheDir: string }): Promise<{ path: string | null }> };

export function createServices(repoRoot: string) {
  return {
    async analyze(): Promise<AnalyzeResult> {
      const result = (await runJson("scripts/analyze.mjs", ["--json"], { cwd: repoRoot })) as AnalyzeResult;
      const visitable = loadVisitableSet(resolveScfleetDb(repoRoot));
      result.ships = result.ships.map((s) => ({ ...s, visitable: visitable.has(s.key) }));
      return result;
    },

    async prereqs(): Promise<Prereqs> {
      const prereq = await loadLib<PrereqLib>(repoRoot, "prereqs.mjs");
      let paths: { starbreaker?: string; p4k?: string } = {};
      try {
        const cfg = await loadLib<ConfigLib>(repoRoot, "config.mjs");
        paths = cfg.loadConfig({ root: repoRoot }).paths;
      } catch {
        paths = {};
      }
      return prereq.checkPrereqs({ paths, which: prereq.defaultWhich });
    },

    async getThumbnail(name: string): Promise<string | null> {
      try {
        const thumbs = await loadLib<ThumbLib>(repoRoot, "thumbnails.mjs");
        const { path } = await thumbs.getThumbnail({ name, cacheDir: join(repoRoot, ".cache", "thumbs") });
        if (!path) return null;
        const buf = await readFile(path);
        return `data:image/jpeg;base64,${buf.toString("base64")}`;
      } catch {
        return null;
      }
    },

    updateData(): Promise<{ ok: boolean; count: number }> {
      return runUpdate(repoRoot, resolveScfleetDb(repoRoot));
    },
  };
}
