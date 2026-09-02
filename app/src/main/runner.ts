import { execFile } from "node:child_process";

export function runJson(script: string, args: string[], opts: { cwd: string }): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile("node", [script, ...args], { cwd: opts.cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`Échec de ${script} : ${stderr?.toString().trim() || err.message}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`Sortie non-JSON de ${script} : ${stdout.slice(0, 200)}`));
      }
    });
  });
}
