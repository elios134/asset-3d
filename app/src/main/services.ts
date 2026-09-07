import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runJson } from "./runner";
import { loadLib } from "./libs";
import { loadVisitableSet } from "./visitable";
import { resolveScfleetDb } from "./appconfig";
import { runUpdate } from "./update";
import { runExtract } from "./extract";
import { runStream } from "./stream";
import type { AnalyzeResult, Prereqs, ExtractItem, ExtractSummary, QaEvent, QaSummary } from "../shared/types";

type IpcSender = { send(channel: string, evt: unknown): void };
type QaRunner = (sender: IpcSender) => Promise<QaSummary>;

type ConfigLib = { loadConfig(opts: { root: string }): { paths: { starbreaker: string; p4k: string } } };
type PrereqLib = {
  checkPrereqs(a: { paths?: { starbreaker?: string; p4k?: string }; which?: (c: string) => boolean }): Prereqs;
  defaultWhich(cmd: string): boolean;
};
type ThumbLib = { getThumbnail(a: { name: string; cacheDir: string }): Promise<{ path: string | null }> };

export function createServices(repoRoot: string, deps: { runQa?: QaRunner } = {}) {
  let extractLock = false;
  let cancelFlag = false;
  let qaLock = false;

  // QA réelle : un seul run couvre tout le catalogue clay (scripts/qa.mjs --json).
  const defaultRunQa: QaRunner = async (sender) => {
    const r = await runStream<QaEvent>("scripts/qa.mjs", ["--json"], {
      cwd: repoRoot,
      onEvent: (evt) => sender.send("qa:event", evt),
    }).done;
    if (r.type !== "result") throw new Error("La QA n'a pas émis de résultat.");
    return { conforme: r.conforme, ships: r.ships, hard: r.hard, warns: r.warns };
  };

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

    async startExtract(sender: { send(channel: string, evt: unknown): void }, items: ExtractItem[]): Promise<ExtractSummary> {
      if (extractLock) throw new Error("Une extraction est déjà en cours.");
      extractLock = true;
      cancelFlag = false;
      try {
        return await runExtract(items, {
          cwd: repoRoot,
          onEvent: (evt) => sender.send("extract:event", evt),
          isCancelled: () => cancelFlag,
        });
      } finally {
        extractLock = false;
      }
    },

    cancelExtract(): void {
      cancelFlag = true;
    },

    async startQa(sender: IpcSender): Promise<QaSummary> {
      if (qaLock) throw new Error("Une QA est déjà en cours.");
      qaLock = true;
      try {
        return await (deps.runQa ?? defaultRunQa)(sender);
      } finally {
        qaLock = false;
      }
    },
  };
}
