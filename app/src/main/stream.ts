import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { ExtractEvent } from "../shared/types";

export interface StreamHandle {
  done: Promise<ExtractEvent>;
  kill(): void;
}

export function runStream(
  script: string,
  args: string[],
  opts: { cwd: string; onEvent: (e: ExtractEvent) => void },
): StreamHandle {
  const child = spawn("node", [script, ...args], { cwd: opts.cwd });
  let result: ExtractEvent | null = null;
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d.toString(); });
  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    let evt: ExtractEvent;
    try { evt = JSON.parse(line) as ExtractEvent; } catch { return; }
    opts.onEvent(evt);
    if (evt.type === "result") result = evt;
  });
  const done = new Promise<ExtractEvent>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (result) resolve(result);
      else if (code === 0) resolve({ type: "result", ok: 0, ko: 0, skipped: 0 });
      else reject(new Error(stderr.trim() || `build-clay a quitté avec le code ${code}`));
    });
  });
  return { done, kill: () => child.kill() };
}
