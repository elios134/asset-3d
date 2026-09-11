import { test, expect } from "vitest";
import { createServices } from "./services";
import type { PublishOptions, PublishSummary } from "../shared/types";

const sender = { send: () => {} };
const dryDone: PublishSummary = { dryRun: true, wouldUpload: [], wouldPatch: [], problems: [] };

test("startPublish refuse un second appel concurrent (verrou publish)", async () => {
  let release!: (p: PublishSummary) => void;
  const svc = createServices(process.cwd(), {
    runPublish: () => new Promise<PublishSummary>((res) => { release = res; }),
  });

  const p1 = svc.startPublish(sender, { keys: ["A"], confirm: false });
  await expect(svc.startPublish(sender, { keys: ["A"], confirm: false })).rejects.toThrow(/déjà en cours/);

  release(dryDone);
  expect(await p1).toEqual(dryDone);

  // Verrou libéré : une nouvelle publication peut repartir.
  const p2 = svc.startPublish(sender, { keys: ["A"], confirm: true });
  release(dryDone);
  await expect(p2).resolves.toEqual(dryDone);
});

test("startPublish relaie les options (keys + confirm) au runner", async () => {
  const seen: PublishOptions[] = [];
  const svc = createServices(process.cwd(), {
    runPublish: (_s, opts) => { seen.push(opts); return Promise.resolve(dryDone); },
  });
  await svc.startPublish(sender, { keys: ["DRAK_Clipper"], confirm: true });
  expect(seen).toEqual([{ keys: ["DRAK_Clipper"], confirm: true }]);
});
