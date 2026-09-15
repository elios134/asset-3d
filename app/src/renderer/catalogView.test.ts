import { test, expect } from "vitest";
import { shipStatus, statusCounts, worklistGroups, type CatalogShip } from "./catalogView";

const mk = (over: Partial<CatalogShip>): CatalogShip => ({
  key: "K", name: "N", manufacturer: "M", dims: { l: 10, b: 5, h: 3 },
  exterior: { published: true, patchVersion: null }, interior: { published: true, anchored: false },
  visitable: false, reasons: [], status: "à jour", toProcess: false,
  availableLevels: ["exterior", "interior"], ...over,
});

test("shipStatus : mappe raisons/publication vers un état d'affichage", () => {
  expect(shipStatus(mk({ reasons: ["nouveau"], toProcess: true, exterior: { published: false, patchVersion: null } }))).toBe("new");
  expect(shipStatus(mk({ reasons: ["version modifiée"], toProcess: true }))).toBe("mod");
  expect(shipStatus(mk({ reasons: ["intérieur manquant"], toProcess: true, interior: { published: false, anchored: false } }))).toBe("int");
  expect(shipStatus(mk({ reasons: [], toProcess: false }))).toBe("ok");
});

test("shipStatus : modifié prime sur intérieur manquant", () => {
  expect(shipStatus(mk({ reasons: ["version modifiée", "intérieur manquant"], toProcess: true }))).toBe("mod");
});

test("statusCounts : compte par état + total", () => {
  const ships = [
    mk({ key: "a", reasons: ["nouveau"], exterior: { published: false, patchVersion: null } }),
    mk({ key: "b", reasons: ["version modifiée"] }),
    mk({ key: "c", reasons: ["version modifiée"] }),
    mk({ key: "d", reasons: [] }),
  ];
  expect(statusCounts(ships)).toEqual({ all: 4, new: 1, mod: 2, int: 0, ok: 1 });
});

test("worklistGroups : regroupe les à-traiter par état, ignore les à jour", () => {
  const ships = [
    mk({ key: "a", name: "Ax", reasons: ["nouveau"], toProcess: true, exterior: { published: false, patchVersion: null } }),
    mk({ key: "b", name: "Bx", reasons: ["version modifiée"], toProcess: true }),
    mk({ key: "c", name: "Cx", reasons: [], toProcess: false }),
  ];
  const g = worklistGroups(ships);
  expect(g.new.map((s) => s.key)).toEqual(["a"]);
  expect(g.mod.map((s) => s.key)).toEqual(["b"]);
  expect(g.int).toEqual([]);
  expect(g.new.length + g.mod.length + g.int.length).toBe(2); // c (à jour) exclu
});
