import { test, expect } from "vitest";
import { createServices } from "./services";

// faux sender ipc
const sender = { send: () => {} };

test("startExtract refuse une seconde extraction concurrente", async () => {
  const svc = createServices(process.cwd());
  // items vides -> runExtract se termine tout de suite ; on teste le verrou en lançant 2 fois d'affilée
  // sans await sur la première : la seconde doit voir le verrou (ou les deux passent si trop rapides).
  // On force la concurrence avec un item bidon dont le spawn échouera vite mais garde le verrou le temps du run.
  const p1 = svc.startExtract(sender, [
    { key: "___NOPE___", name: "x", lengthM: 10, wantExterior: true, wantInterior: false },
  ]);
  await expect(
    svc.startExtract(sender, [{ key: "___NOPE2___", name: "y", lengthM: 10, wantExterior: true, wantInterior: false }]),
  ).rejects.toThrow(/déjà en cours/);
  await p1.catch(() => {}); // la 1re se termine (spawn échoue), on libère
});
