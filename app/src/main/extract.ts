import { resolveRecipe } from "./recipe";
import { runStream, type StreamHandle } from "./stream";
import type { ExtractItem, ExtractEvent, ExtractSummary } from "../shared/types";

type RunFn = (
  script: string,
  args: string[],
  opts: { cwd: string; onEvent: (e: ExtractEvent) => void },
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
      const res = await run(recipe.script, recipe.args, { cwd: opts.cwd, onEvent: opts.onEvent }).done;
      if (res.type === "result") { ok += res.ok; ko += res.ko; skipped += res.skipped; }
    } catch (e) {
      ko++;
      opts.onEvent({ type: "progress", key: item.key, name: item.name, step: "error", err: (e as Error).message });
    }
  }
  return { ok, ko, skipped, cancelled };
}
