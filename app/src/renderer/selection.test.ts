import { test, expect } from "vitest";
import { toggleLevel, selectionCount, type Selection } from "./selection";

test("toggleLevel bascule un axe et est immuable", () => {
  const a: Selection = new Map();
  const b = toggleLevel(a, "SHIP", "exterior");
  expect(a.size).toBe(0);
  expect(b.get("SHIP")).toEqual({ exterior: true, interior: false });
  const c = toggleLevel(b, "SHIP", "exterior");
  expect(c.get("SHIP")).toEqual({ exterior: false, interior: false });
});

test("selectionCount compte les vaisseaux avec ≥1 axe", () => {
  let s: Selection = new Map();
  s = toggleLevel(s, "A", "exterior");
  s = toggleLevel(s, "B", "interior");
  s = toggleLevel(s, "C", "exterior");
  s = toggleLevel(s, "C", "exterior"); // C repasse à 0
  expect(selectionCount(s)).toBe(2);
});
