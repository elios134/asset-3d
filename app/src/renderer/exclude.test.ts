import { test, expect } from "vitest";
import { isExcluded, isAutoExcluded } from "./exclude";

test("exclut wikelo / pyam / Best In Show / BIS (sur le nom)", () => {
  expect(isExcluded({ name: "Idris-P Wikelo War Special", key: "AEGS_Idris_P_Collector_Military" })).toBe(true);
  expect(isExcluded({ name: "Cutlass Black PYAM Exec", key: "DRAK_Cutlass_Black_Exec_Stealth" })).toBe(true);
  expect(isExcluded({ name: "Hammerhead 2949 Best In Show Edition", key: "AEGS_Hammerhead_Showdown" })).toBe(true);
  expect(isExcluded({ name: "600i 2951 BIS", key: "ORIG_600i_BIS2951" })).toBe(true);
});

test("exclut les variantes Alliance (suffixe clé _BTALA)", () => {
  expect(isExcluded({ name: "MOLE Alliance", key: "ARGO_MOLE_BTALA" })).toBe(true);
  expect(isExcluded({ name: "Golem Alliance", key: "DRAK_Golem_BTALA" })).toBe(true);
});

test("garde le Basher et les vaisseaux normaux", () => {
  expect(isExcluded({ name: "Basher", key: "GLSN_Basher" })).toBe(false);
  expect(isExcluded({ name: "Carrack", key: "ANVL_Carrack" })).toBe(false);
  expect(isExcluded({ name: "Cutlass Black", key: "DRAK_Cutlass_Black" })).toBe(false);
});

test("liste manuelle : exclut une clé donnée en plus des règles auto", () => {
  const manual = new Set(["VNCL_Mauler"]);
  expect(isExcluded({ name: "Mauler Destroyer", key: "VNCL_Mauler" }, manual)).toBe(true);
  expect(isExcluded({ name: "Carrack", key: "ANVL_Carrack" }, manual)).toBe(false);
  // la clé manuelle n'est PAS une exclusion auto
  expect(isAutoExcluded({ name: "Mauler Destroyer", key: "VNCL_Mauler" })).toBe(false);
});
