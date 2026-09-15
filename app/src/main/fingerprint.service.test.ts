import { test, expect } from "vitest";
import { createServices } from "./services";
import type { FingerprintSummary } from "../shared/types";

const sender = { send: () => {} };

test("startFingerprintScan refuse un second scan concurrent (verrou)", async () => {
  let release!: (s: FingerprintSummary) => void;
  const svc = createServices(process.cwd(), {
    runFingerprint: () => new Promise<FingerprintSummary>((res) => { release = res; }),
  });

  const p1 = svc.startFingerprintScan(sender);
  await expect(svc.startFingerprintScan(sender)).rejects.toThrow(/déjà en cours/);

  release({ fingerprints: 3 });
  expect(await p1).toEqual({ fingerprints: 3 });

  // verrou libéré : un nouveau scan repart.
  const again = svc.startFingerprintScan(sender);
  expect(again).toBeInstanceOf(Promise);
  release({ fingerprints: 0 });
  await again;
});
