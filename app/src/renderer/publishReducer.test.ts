import { describe, it, expect } from "vitest";
import { initPublishState, publishReducer, type PublishState, type PublishAction } from "./publishReducer";

const run = (actions: PublishAction[], s: PublishState = initPublishState()) => actions.reduce(publishReducer, s);

describe("publishReducer — dry-run", () => {
  it("accumule le plan et expose le résumé dry-run (running=false, dryRun)", () => {
    const s = run([
      { type: "start", dryRun: true, push: false, patchVersion: "sc-4.1", keys: ["DRAK_Clipper"] },
      { type: "plan", key: "DRAK_Clipper", level: "exterior", file: "DRAK_Clipper.clay-exterior.glb", tris: 599999, sizeBytes: 5316768, sha256: "b479" },
      { type: "done", dryRun: true, wouldUpload: ["DRAK_Clipper.clay-exterior.glb"], wouldPatch: ["DRAK_Clipper"], problems: [] },
    ]);
    expect(s.running).toBe(false);
    expect(s.dryRun).toBe(true);
    expect(s.plan).toHaveLength(1);
    expect(s.plan[0].file).toBe("DRAK_Clipper.clay-exterior.glb");
    expect(s.summary).toMatchObject({ dryRun: true, wouldPatch: ["DRAK_Clipper"] });
    expect(s.err).toBeNull();
  });

  it("enregistre les skips (no-glb / no-meta)", () => {
    const s = run([
      { type: "start", dryRun: true, push: false, patchVersion: "sc-4.1", keys: ["X"] },
      { type: "skip", key: "X", reason: "no-glb" },
      { type: "done", dryRun: true, wouldUpload: [], wouldPatch: [], problems: ["[FICHIER] X : aucun X.clay-*.glb"] },
    ]);
    expect(s.skips).toEqual([{ key: "X", reason: "no-glb" }]);
    expect(s.log.some((l) => l.includes("[FICHIER] X"))).toBe(true);
  });
});

describe("publishReducer — phase réelle", () => {
  it("reset puis événements réels : résumé published, running=false, dryRun=false", () => {
    let s = run([
      { type: "start", dryRun: true, push: false, patchVersion: "sc-4.1", keys: ["DRAK_Clipper"] },
      { type: "plan", key: "DRAK_Clipper", level: "exterior", file: "DRAK_Clipper.clay-exterior.glb", tris: 1, sizeBytes: 2, sha256: "x" },
      { type: "done", dryRun: true, wouldUpload: ["DRAK_Clipper.clay-exterior.glb"], wouldPatch: ["DRAK_Clipper"], problems: [] },
    ]);
    s = run([
      { type: "reset", dryRun: false },
      { type: "start", dryRun: false, push: true, patchVersion: "sc-4.1", keys: ["DRAK_Clipper"] },
      { type: "upload", file: "DRAK_Clipper.clay-exterior.glb", status: "start" },
      { type: "upload", file: "DRAK_Clipper.clay-exterior.glb", status: "done" },
      { type: "index-written", keys: ["DRAK_Clipper"] },
      { type: "git", status: "done" },
      { type: "done", dryRun: false, published: ["DRAK_Clipper"], uploaded: ["DRAK_Clipper.clay-exterior.glb"], pushed: true, problems: [] },
    ], s);
    expect(s.running).toBe(false);
    expect(s.dryRun).toBe(false);
    expect(s.plan).toHaveLength(0); // reset a vidé le plan du dry-run
    expect(s.summary).toMatchObject({ dryRun: false, published: ["DRAK_Clipper"], pushed: true });
  });
});

describe("publishReducer — erreurs", () => {
  it("startFatal : running=false + err renseignée", () => {
    const s = publishReducer(initPublishState(), { type: "startFatal", err: "boom" });
    expect(s.running).toBe(false);
    expect(s.err).toBe("boom");
  });

  it("event error : running=false + err renseignée", () => {
    const s = publishReducer(initPublishState(), { type: "error", message: "aucune clé" });
    expect(s.running).toBe(false);
    expect(s.err).toBe("aucune clé");
  });
});
