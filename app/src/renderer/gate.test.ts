import { test, expect } from "vitest";
import { needsUpdate } from "./gate";

test("needsUpdate : locale > publiée ⇒ true", () => {
  expect(needsUpdate("sc-4.1", "sc-4.9")).toBe(true);
  expect(needsUpdate("sc-4.1", "sc-4.1")).toBe(false);
  expect(needsUpdate("sc-4.9", "sc-4.1")).toBe(false);
});

test("needsUpdate : version locale inconnue ⇒ false (rien à proposer)", () => {
  expect(needsUpdate("sc-4.1", null)).toBe(false);
});
