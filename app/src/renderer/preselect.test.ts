import { test, expect } from "vitest";
import { initialSelection } from "./preselect";
import type { Ship } from "../shared/types";

function ship(p: Partial<Ship> & { key: string; status: string }): Ship {
  return {
    key: p.key, name: p.key, manufacturer: "X", dims: { l: 1, b: 1, h: 1 },
    exterior: { published: p.exterior?.published ?? false, patchVersion: null },
    interior: { published: false, anchored: false },
    reasons: [], status: p.status, toProcess: p.status !== "à jour",
    availableLevels: ["exterior", "interior"], visitable: p.visitable ?? false,
  };
}

test("pré-coche extérieur d'un modifié publié, intérieur si visitable", () => {
  const ships = [
    ship({ key: "MOD_VIS", status: "version modifiée", exterior: { published: true, patchVersion: null }, visitable: true }),
    ship({ key: "MOD_NOVIS", status: "version modifiée", exterior: { published: true, patchVersion: null }, visitable: false }),
    ship({ key: "NEW", status: "nouveau", exterior: { published: false, patchVersion: null }, visitable: true }),
  ];
  const sel = initialSelection(ships);
  expect(sel.get("MOD_VIS")).toEqual({ exterior: true, interior: true });
  expect(sel.get("MOD_NOVIS")).toEqual({ exterior: true, interior: false });
  expect(sel.has("NEW")).toBe(false);
});
