import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { ExtractEvent } from "../shared/types";

export interface StreamHandle<E extends { type: string } = ExtractEvent> {
  done: Promise<E>;
  kill(): void;
}

/**
 * Spawn `node <script> <args>` et lit son stdout ligne à ligne. Chaque ligne
 * JSON valide est transmise à `onEvent` (les lignes non-JSON sont ignorées).
 * `done` résout au dernier événement terminal reçu (`{type:"result"}` par
 * défaut, `resultType` pour un autre script — ex. publish.mjs émet `"done"`) ;
 * si le process sort en 0 sans en émettre, résout `emptyResult` s'il est
 * fourni, sinon rejette. Générique : réutilisé par extraction, QA et publication.
 */
export function runStream<E extends { type: string } = ExtractEvent>(
  script: string,
  args: string[],
  opts: { cwd: string; onEvent: (e: E) => void; emptyResult?: E; resultType?: string },
): StreamHandle<E> {
  const resultType = opts.resultType ?? "result";
  const child = spawn("node", [script, ...args], { cwd: opts.cwd });
  let result: E | null = null;
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d.toString(); });
  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    let evt: E;
    try { evt = JSON.parse(line) as E; } catch { return; }
    opts.onEvent(evt);
    if (evt.type === resultType) result = evt;
  });
  const done = new Promise<E>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (result) resolve(result);
      else if (code === 0 && opts.emptyResult) resolve(opts.emptyResult);
      else reject(new Error(stderr.trim() || `le script a quitté avec le code ${code}`));
    });
  });
  return { done, kill: () => child.kill() };
}
