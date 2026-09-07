import { describe, it, expect } from "vitest";
import { buildPublishPreview, pushManifest, type PublishDeps } from "./publish";

// exec factice : repond selon la sous-commande git, et enregistre l'ordre des appels.
function fakeExec(handlers: Record<string, () => Promise<string>>, calls: string[][]) {
  return (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    const key = [cmd, ...args].join(" ");
    for (const prefix of Object.keys(handlers)) if (key.startsWith(prefix)) return handlers[prefix]();
    return Promise.resolve("");
  };
}

describe("buildPublishPreview", () => {
  it("calcule added/removed vs HEAD et les fichiers changes (garde-fou suppression)", async () => {
    const calls: string[][] = [];
    let built = false;
    const deps: PublishDeps = {
      exec: fakeExec(
        {
          "git show HEAD:index.json": () => Promise.resolve(JSON.stringify({ ships: [{ key: "A" }, { key: "B" }] })),
          "git status": () => Promise.resolve(" M index.json\n M ships.meta.json\n"),
        },
        calls,
      ),
      runBuildIndex: () => { built = true; return Promise.resolve(); },
      readIndex: () => ({ patchVersion: "sc-4.1", keys: ["B", "C"] }),
    };
    const p = await buildPublishPreview("/repo", deps);
    expect(built).toBe(true);
    expect(p.patchVersion).toBe("sc-4.1");
    expect(p.total).toBe(2);
    expect(p.added).toEqual(["C"]);      // C nouveau
    expect(p.removed).toEqual(["A"]);    // A disparu de l'index => garde-fou
    expect(p.changedFiles).toEqual(["index.json", "ships.meta.json"]);
  });

  it("HEAD:index.json absent (jamais commite) => removed vide, tout en added", async () => {
    const deps: PublishDeps = {
      exec: fakeExec({ "git show HEAD:index.json": () => Promise.reject(new Error("fatal: path not in HEAD")),
                       "git status": () => Promise.resolve(" M index.json\n") }, []),
      runBuildIndex: () => Promise.resolve(),
      readIndex: () => ({ patchVersion: "sc-4.1", keys: ["A", "B"] }),
    };
    const p = await buildPublishPreview("/repo", deps);
    expect(p.removed).toEqual([]);
    expect(p.added).toEqual(["A", "B"]);
  });
});

describe("pushManifest", () => {
  it("commit + push quand il y a des changements, renvoie le hash court", async () => {
    const calls: string[][] = [];
    const deps: PublishDeps = {
      exec: fakeExec(
        {
          "git diff --cached --quiet": () => Promise.reject(new Error("exit 1")), // il y a des changements
          "git rev-parse --short HEAD": () => Promise.resolve("abc1234\n"),
        },
        calls,
      ),
      readIndex: () => ({ patchVersion: "sc-4.1", keys: [] }),
    };
    const r = await pushManifest("/repo", deps);
    expect(r).toEqual({ pushed: true, commit: "abc1234" });
    const seq = calls.map((c) => c.slice(0, 2).join(" "));
    expect(seq).toEqual([
      "git add", "git diff", "git commit", "git rev-parse", "git push",
    ]);
    // message de commit contient le patch
    expect(calls.find((c) => c[1] === "commit")?.join(" ")).toContain("sc-4.1");
  });

  it("rien a committer => pushed:false, aucun commit/push", async () => {
    const calls: string[][] = [];
    const deps: PublishDeps = {
      exec: fakeExec({ "git diff --cached --quiet": () => Promise.resolve("") /* exit 0 = propre */ }, calls),
      readIndex: () => ({ patchVersion: "sc-4.1", keys: [] }),
    };
    const r = await pushManifest("/repo", deps);
    expect(r).toEqual({ pushed: false, nothingToCommit: true });
    expect(calls.some((c) => c[1] === "commit" || c[1] === "push")).toBe(false);
  });
});
