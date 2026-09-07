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
    try {
      const res = await run(recipe.script, recipe.args, {
        cwd: opts.cwd,
        // Le résultat par-vaisseau ne doit pas atteindre l'UI : il est déjà
        // consommé ici via `.done`. Ne laisser passer que les événements de
        // progression ; l'agrégat final est émis une seule fois après la boucle.
        onEvent: (e) => { if (e.type !== "result") opts.onEvent(e); },
        // build-clay émet toujours un result ; ce repli ne sert que si un run
        // sort en 0 sans en émettre (comportement historique : compté comme rien).
        emptyResult: { type: "result", ok: 0, ko: 0, skipped: 0 },
      }).done;
      if (res.type === "result") { ok += res.ok; ko += res.ko; skipped += res.skipped; }
    } catch (e) {
      ko++;
      opts.onEvent({ type: "progress", key: item.key, name: item.name, step: "error", err: (e as Error).message });
    }
  }
  opts.onEvent({ type: "result", ok, ko, skipped });
  return { ok, ko, skipped, cancelled };
}
