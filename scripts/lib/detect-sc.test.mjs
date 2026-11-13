import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candidateP4ks, candidateExes, pickExisting, detectP4k, detectStarbreaker, RSI_ROOTS, CHANNELS,
} from "./detect-sc.mjs";

test("candidateP4ks : chemins normalisés, se terminant par Data.p4k", () => {
  const cands = candidateP4ks({ drives: ["D"], roots: ["RSI Launcher/StarCitizen"], channels: ["LIVE"] });
  assert.ok(cands.every((p) => p.endsWith("/Data.p4k")));
  assert.ok(cands.every((p) => !p.includes("//")));
  assert.ok(cands.includes("D:/RSI Launcher/StarCitizen/LIVE/Data.p4k"));
});

test("candidateP4ks : gère l'install imbriquée StarCitizen/StarCitizen", () => {
  const cands = candidateP4ks({ drives: ["D"], roots: ["RSI Launcher/StarCitizen"], channels: ["LIVE"] });
  assert.ok(cands.includes("D:/RSI Launcher/StarCitizen/StarCitizen/LIVE/Data.p4k"));
});

test("candidateP4ks : LIVE passe avant PTU (priorité de canal)", () => {
  const cands = candidateP4ks({ drives: ["D"], roots: ["R/SC"], channels: CHANNELS });
  const iLive = cands.findIndex((p) => p.includes("/LIVE/"));
  const iPtu = cands.findIndex((p) => p.includes("/PTU/"));
  assert.ok(iLive >= 0 && iPtu >= 0 && iLive < iPtu);
});

test("candidateExes : combine dossiers et noms, normalise les séparateurs", () => {
  const cands = candidateExes({ bases: ["C:\\Users\\a\\Documents\\starbreaker"], names: ["starbreaker.exe"] });
  assert.deepEqual(cands, ["C:/Users/a/Documents/starbreaker/starbreaker.exe"]);
});

test("pickExisting : renvoie le premier candidat qui existe (ordre = priorité)", () => {
  const exists = (p) => p === "B" || p === "C";
  assert.equal(pickExisting(["A", "B", "C"], exists), "B");
  assert.equal(pickExisting(["A"], exists), null);
});

test("detectP4k : trouve le LIVE réel parmi des leurres", () => {
  const real = "D:/Program Files/RSI Launcher/StarCitizen/StarCitizen/LIVE/Data.p4k";
  const existsFn = (p) => p === "D:/" || p === real;
  assert.equal(detectP4k({ existsFn }), real);
});

test("detectP4k : null si rien trouvé", () => {
  assert.equal(detectP4k({ existsFn: (p) => p === "C:/", readDirsFn: () => [] }), null);
});

test("detectP4k : secours trouve une bibliothèque personnalisée (D:/StarCitizen/LIVE)", () => {
  const real = "D:/StarCitizen/LIVE/Data.p4k";
  const existsFn = (p) => p === "D:/" || p === real;
  const readDirsFn = (d) => (d === "D:/" ? ["StarCitizen", "Jeux", "Perso"] : []);
  assert.equal(detectP4k({ existsFn, readDirsFn }), real);
});

test("detectStarbreaker : trouve starbreaker.exe sous le home", () => {
  const home = "C:/Users/andre";
  const real = `${home}/Documents/starbreaker/starbreaker.exe`;
  const existsFn = (p) => p === "C:/" || p === real;
  assert.equal(detectStarbreaker({ existsFn, home }), real);
});

test("RSI_ROOTS et CHANNELS exportés et non vides", () => {
  assert.ok(RSI_ROOTS.length > 0 && CHANNELS[0] === "LIVE");
});
