import { test, expect } from "vitest";
import { createServices } from "./services";
import type { PublishPreview } from "../shared/types";

// buildPublish et pushManifest partagent le meme verrou publishLock : aucune des
// deux etapes ne peut demarrer tant qu'une publication est en cours.
test("buildPublish refuse un second appel concurrent (verrou publish)", async () => {
  let release!: (p: PublishPreview) => void;
  const svc = createServices(process.cwd(), {
    buildPublish: () => new Promise<PublishPreview>((res) => { release = res; }),
  });

  const p1 = svc.buildPublish();
  await expect(svc.buildPublish()).rejects.toThrow(/déjà en cours/);

  const preview: PublishPreview = { patchVersion: "sc-4.1", total: 0, added: [], removed: [], changedFiles: [] };
  release(preview);
  expect(await p1).toEqual(preview);

  // Verrou libéré : une nouvelle publication peut repartir.
  const p2 = svc.buildPublish(); // recree une promesse, reaffecte `release`
  release(preview);
  await expect(p2).resolves.toEqual(preview);
});
