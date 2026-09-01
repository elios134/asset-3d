import { test, expect } from "vitest";
import { isExcludedEdition } from "./exclude";

test("exclut les éditions wikelo / pyam / Best In Show / BIS", () => {
  expect(isExcludedEdition("Idris-P Wikelo War Special")).toBe(true);
  expect(isExcludedEdition("Cutlass Black PYAM Exec")).toBe(true);
  expect(isExcludedEdition("Hammerhead 2949 Best In Show Edition")).toBe(true);
  expect(isExcludedEdition("600i 2951 BIS")).toBe(true);
});

test("garde les vaisseaux normaux", () => {
  expect(isExcludedEdition("Carrack")).toBe(false);
  expect(isExcludedEdition("Cutlass Black")).toBe(false);
  expect(isExcludedEdition("Avenger Titan")).toBe(false);
});
