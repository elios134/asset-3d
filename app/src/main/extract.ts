import { resolveRecipe } from "./recipe";
import { runStream, type StreamHandle } from "./stream";
import type { ExtractItem, ExtractEvent, ExtractSummary } from "../shared/types";

type RunFn = (
  script: string,
  args: string[],
  opts: { cwd: string; onEvent: (e: ExtractEvent) => void; emptyResult?: ExtractEvent },
) => StreamHandle;

export async function runExtract(
  items: ExtractItem[],
  opts: {
    cwd: string;
    onEvent: (e: ExtractEvent) => void;
    isCancelled: () => boolean;
    run?: RunFn;
  },
): Promise<ExtractSummary> {
  const run = opts.run ?? runStream;
  let ok = 0, ko = 0, skipped = 0, cancelled = false;

  for (const item of items) {
    if (opts.isCancelled()) {
      cancelled = true;
      opts.onEvent({ type: "cancelled", doneCount: ok + ko + skipped });
      break;
    }
    const recipe = resolveRecipe(item);
    if ("manual" in recipe) {
      skipped++;
      opts.onEvent({ type: "progress", key: item.key, name: item.name, step: "skip", reason: recipe.reason });
      continue;
    }
    // Étape 0 = clay (fait foi pour le compteur : c'est le rendu minimal publiable).
    // Étapes suivantes = peint, best-effort : leurs événements de progression
    // remontent, mais un échec peint n'invalide pas le vaisseau (il reste clay).
    const forward = (e: ExtractEvent) => { if (e.type !== "result") opts.onEvent(e); };
    const emptyResult: ExtractEvent = { type: "result", ok: 0, ko: 0, skipped: 0 };
    try {
      const res = await run(recipe.steps[0].script, recipe.steps[0].args, {
        cwd: opts.cwd, onEvent: forward, emptyResult,
      }).done;
      if (res.type === "result") { ok += res.ok; ko += res.ko; skipped += res.skipped; }
    } catch (e) {
      ko++;
      opts.onEvent({ type: "progress", key: item.key, name: item.name, step: "error", err: (e as Error).message });
      continue; // clay échoué → on ne tente pas le peint
    }
    for (const step of recipe.steps.slice(1)) {
      if (opts.isCancelled()) break;
      try {
        await run(step.script, step.args, { cwd: opts.cwd, onEvent: forward, emptyResult }).done;
      } catch (e) {
        opts.onEvent({ type: "progress", key: item.key, name: item.name, step: "error", err: `peint : ${(e as Error).message}` });
      }
    }
  }
  opts.onEvent({ type: "result", ok, ko, skipped });
  return { ok, ko, skipped, cancelled };
}
