import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runJson } from "./runner";
import { loadLib } from "./libs";
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
      return (await runJson("scripts/analyze.mjs", ["--json"], { cwd: repoRoot })) as AnalyzeResult;
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
  };
}
