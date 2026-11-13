import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runJson } from "./runner";
import { loadLib } from "./libs";
import { loadVisitableSet } from "./visitable";
import { resolveScfleetDb } from "./appconfig";
import { runUpdate } from "./update";
import { runExtract } from "./extract";
import { runStream } from "./stream";
import { runPublish } from "./publish";
import { existsSync } from "node:fs";
import type {
  AnalyzeResult, Prereqs, ExtractItem, ExtractSummary, QaEvent, QaSummary, PublishOptions, PublishSummary, IndexEntrySummary,
  FingerprintEvent, FingerprintSummary, ConfigKey, ConfigStatus, DetectedPaths,
} from "../shared/types";

type IpcSender = { send(channel: string, evt: unknown): void };
type QaRunner = (sender: IpcSender) => Promise<QaSummary>;
type PublishRunner = (sender: IpcSender, opts: PublishOptions) => Promise<PublishSummary>;
type FingerprintRunner = (sender: IpcSender) => Promise<FingerprintSummary>;

type ConfigLib = { loadConfig(opts: { root: string }): { paths: { starbreaker: string; p4k: string } } };
type PrereqLib = {
  checkPrereqs(a: { paths?: { starbreaker?: string; p4k?: string }; which?: (c: string) => boolean }): Prereqs;
  defaultWhich(cmd: string): boolean;
};
type ThumbLib = { getThumbnail(a: { name: string; cacheDir: string }): Promise<{ path: string | null }> };
type DetectLib = {
  detectP4k(a?: { existsFn?: (p: string) => boolean }): string | null;
  detectStarbreaker(a?: { existsFn?: (p: string) => boolean }): string | null;
};
type AppConfigLib = {
  CONFIG_KEYS: string[];
  validatePath(key: string, value: string, existsFn?: (p: string) => boolean): string | null;
  mergePaths(current: unknown, key: string, value: string): { paths?: Record<string, string> };
  readAppConfig(root: string): { paths?: Record<string, string | null> };
  writeAppConfig(root: string, obj: unknown): void;
};

export function createServices(
  repoRoot: string,
  deps: {
    runQa?: QaRunner;
    runPublish?: PublishRunner;
    runFingerprint?: FingerprintRunner;
  } = {},
) {
  let extractLock = false;
  let cancelFlag = false;
  let qaLock = false;
  let publishLock = false;
  let fingerprintLock = false;

  // QA réelle : un seul run couvre tout le catalogue clay (scripts/qa.mjs --json).
  const defaultRunQa: QaRunner = async (sender) => {
    const r = await runStream<QaEvent>("scripts/qa.mjs", ["--json"], {
      cwd: repoRoot,
      onEvent: (evt) => sender.send("qa:event", evt),
    }).done;
    if (r.type !== "result") throw new Error("La QA n'a pas émis de résultat.");
    return { conforme: r.conforme, ships: r.ships, hard: r.hard, warns: r.warns };
  };

  // Scan d'empreintes de source : calcule .cache/fingerprints.json (scripts/fingerprint.mjs --json).
  // Alimente la détection « modifié » par vaisseau au prochain analyze().
  const defaultRunFingerprint: FingerprintRunner = async (sender) => {
    const r = await runStream<FingerprintEvent>("scripts/fingerprint.mjs", ["--json"], {
      cwd: repoRoot,
      onEvent: (evt) => sender.send("fp:event", evt),
    }).done;
    if (r.type !== "done") throw new Error("Le scan d'empreintes n'a pas émis de résultat.");
    return { fingerprints: r.fingerprints };
  };

  return {
    async analyze(): Promise<AnalyzeResult> {
      const result = (await runJson("scripts/analyze.mjs", ["--json"], { cwd: repoRoot })) as AnalyzeResult;
      const visitable = loadVisitableSet(resolveScfleetDb(repoRoot));
      result.ships = result.ships.map((s) => ({ ...s, visitable: visitable.has(s.key) }));
      return result;
    },

    // Ré-énumère les vaisseaux depuis le JEU (scripts/list-ships.mjs → game-ships.json).
    // À relancer après une MAJ du jeu pour voir les nouveaux vaisseaux (ex. Galaxy).
    async scanGame(): Promise<{ count: number }> {
      const r = (await runJson("scripts/list-ships.mjs", ["--json"], { cwd: repoRoot })) as { count: number };
      return { count: r.count };
    },

    // Liste d'exclusion MANUELLE (exclusions.json git-tracké). Union avec les règles auto
    // (voir renderer/exclude.ts). Écarte de la galerie/publication les vaisseaux non voulus.
    async getExclusions(): Promise<string[]> {
      try {
        const j = JSON.parse(await readFile(join(repoRoot, "exclusions.json"), "utf8"));
        return Array.isArray(j?.keys) ? j.keys.filter((k: unknown) => typeof k === "string") : [];
      } catch {
        return [];
      }
    },
    async setExclusions(keys: string[]): Promise<void> {
      const uniq = [...new Set(keys.filter((k) => typeof k === "string"))].sort();
      const body = { _comment: "Vaisseaux exclus manuellement de la galerie/publication (géré dans l'app).", keys: uniq };
      await writeFile(join(repoRoot, "exclusions.json"), JSON.stringify(body, null, 2) + "\n");
    },

    // Entrées de l'index PUBLIÉ (index.json git-tracké = vérité) pour l'aperçu du diff avant publication.
    async indexEntries(): Promise<IndexEntrySummary[]> {
      try {
        const idx = JSON.parse(await readFile(join(repoRoot, "index.json"), "utf8"));
        const ships = Array.isArray(idx?.ships) ? idx.ships : [];
        return ships.map((s: { key: string; variants?: Array<{ level: string; sha256: string; sizeBytes: number }> }) => ({
          key: s.key,
          variants: (s.variants ?? []).map((v) => ({ level: v.level, sha256: v.sha256, sizeBytes: v.sizeBytes })),
        }));
      } catch {
        return [];
      }
    },

    // --- Configuration des chemins (app-config.json) ---
    // Chemins actuels + existence réelle sur le disque (null = non renseigné).
    async getConfig(): Promise<ConfigStatus> {
      const io = await loadLib<AppConfigLib>(repoRoot, "app-config-io.mjs");
      const raw = io.readAppConfig(repoRoot).paths ?? {};
      const pick = (k: ConfigKey) => (typeof raw[k] === "string" && raw[k] ? (raw[k] as string) : null);
      const paths = { p4k: pick("p4k"), starbreaker: pick("starbreaker"), blender: pick("blender") };
      return {
        paths,
        exists: {
          p4k: !!paths.p4k && existsSync(paths.p4k),
          starbreaker: !!paths.starbreaker && existsSync(paths.starbreaker),
          blender: !!paths.blender && existsSync(paths.blender),
        },
      };
    },

    // Auto-détection : balaie les emplacements d'install RSI connus + bibliothèques
    // personnalisées. Ne rien enregistrer (l'app propose, l'utilisateur confirme).
    async detectPaths(): Promise<DetectedPaths> {
      const d = await loadLib<DetectLib>(repoRoot, "detect-sc.mjs");
      return { p4k: d.detectP4k(), starbreaker: d.detectStarbreaker() };
    },

    // Valide (fichier existant ; p4k => nom Data.p4k) puis fusionne dans app-config.json
    // sans toucher aux autres champs. Lève un message clair si invalide.
    async setConfigPath(key: ConfigKey, value: string): Promise<ConfigStatus> {
      const io = await loadLib<AppConfigLib>(repoRoot, "app-config-io.mjs");
      const err = io.validatePath(key, value, existsSync);
      if (err) throw new Error(err);
      io.writeAppConfig(repoRoot, io.mergePaths(io.readAppConfig(repoRoot), key, value));
      return this.getConfig();
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

    async startFingerprintScan(sender: IpcSender): Promise<FingerprintSummary> {
      if (fingerprintLock) throw new Error("Un scan d'empreintes est déjà en cours.");
      fingerprintLock = true;
      try {
        return await (deps.runFingerprint ?? defaultRunFingerprint)(sender);
      } finally {
        fingerprintLock = false;
      }
    },

    // Publication chirurgicale (scripts/publish.mjs). Un même verrou couvre le
    // dry-run et la phase réelle : aucune publication concurrente. La phase réelle
    // (opts.confirm) n'est déclenchée que sur action user explicite dans l'UI.
    async startPublish(sender: IpcSender, opts: PublishOptions): Promise<PublishSummary> {
      if (publishLock) throw new Error("Une publication est déjà en cours.");
      publishLock = true;
      try {
        return await (deps.runPublish ?? ((s, o) => runPublish(s, o, { cwd: repoRoot })))(sender, opts);
      } finally {
        publishLock = false;
      }
    },
  };
}
