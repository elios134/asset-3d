import { test, expect } from "vitest";
import { createServices } from "./services";
import type { QaSummary } from "../shared/types";

const sender = { send: () => {} };

test("startQa refuse une seconde QA concurrente (verrou)", async () => {
  // runQa injecté = promesse contrôlable : la 1re QA reste en cours le temps du test.
  let release!: (s: QaSummary) => void;
  const svc = createServices(process.cwd(), {
    runQa: () => new Promise<QaSummary>((res) => { release = res; }),
  });

  const p1 = svc.startQa(sender);
  await expect(svc.startQa(sender)).rejects.toThrow(/déjà en cours/);

  release({ conforme: true, ships: 0, hard: 0, warns: 0 });
  expect(await p1).toEqual({ conforme: true, ships: 0, hard: 0, warns: 0 });

  // Le verrou est libéré : une nouvelle QA peut repartir.
  const svc2Ran = svc.startQa(sender);
  expect(svc2Ran).toBeInstanceOf(Promise);
  release({ conforme: true, ships: 0, hard: 0, warns: 0 });
  await svc2Ran;
});
