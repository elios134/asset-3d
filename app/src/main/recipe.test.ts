import { test, expect } from "vitest";
import { resolveRecipe } from "./recipe";
import type { ExtractItem } from "../shared/types";

const item = (p: Partial<ExtractItem> & { key: string }): ExtractItem => ({
  key: p.key, name: p.name ?? p.key, lengthM: p.lengthM ?? 30,
  wantExterior: p.wantExterior ?? false, wantInterior: p.wantInterior ?? false,
});

test("extérieur seul ⇒ build-clay --ext-only --modules --json", () => {
  const r = resolveRecipe(item({ key: "DRAK_Cutlass_Black", wantExterior: true }));
  expect(r).toEqual({ script: "scripts/build-clay.mjs", args: ["DRAK_Cutlass_Black", "--ext-only", "--modules", "--json"] });
});

test("intérieur régulier ⇒ build-clay --modules --json (ext+int)", () => {
  const r = resolveRecipe(item({ key: "MISC_Freelancer", wantInterior: true, lengthM: 38 }));
  expect(r).toEqual({ script: "scripts/build-clay.mjs", args: ["MISC_Freelancer", "--modules", "--json"] });
});

test("intérieur d'un capital (l>=100) ⇒ manuel", () => {
  const r = resolveRecipe(item({ key: "AEGS_Idris_P", wantInterior: true, lengthM: 240 }));
  expect(r).toEqual({ manual: true, reason: "capital (l≥100 m) — recette taillée à la main" });
});

test("extérieur seul d'un capital ⇒ auto (l'ext clay des capitaux n'est pas chunké)", () => {
  const r = resolveRecipe(item({ key: "AEGS_Idris_P", wantExterior: true, lengthM: 240 }));
  expect(r).toEqual({ script: "scripts/build-clay.mjs", args: ["AEGS_Idris_P", "--ext-only", "--modules", "--json"] });
});
