import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

export function defaultWhich(cmd) {
  const probe = process.platform === "win32" ? "where" : "which";
  try { execFileSync(probe, [cmd], { stdio: "ignore" }); return true; }
  catch { return false; }
}

export function checkPrereqs({ paths, which = defaultWhich }) {
  return {
    node: true,
    starbreaker: !!paths?.starbreaker && existsSync(paths.starbreaker),
    p4k: !!paths?.p4k && existsSync(paths.p4k),
    git: which("git"),
    gh: which("gh"),
  };
}
