import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProjection, isShipGeometry, EXCLUDE_RE, selectShips, diffCatalogue, deriveShipLabel, mergeGameShips, bboxToDims } from "./ship-enum.mjs";

test("parseProjection : TSV name\\tvalue, retire le préfixe et normalise les antislashs", () => {
  const m = parseProjection(
    'EntityClassDefinition.RSI_Galaxy\tObjects\\Spaceships\\Ships\\RSI\\galaxy\\rsi_galaxy.cga\n' +
    'EntityClassDefinition.TMBL_Cyclone\t"Objects/Vehicles/TMBL/Cyclone/TMBL_Cyclone.cga"\n' +
    'ligne sans tab\n',
  );
  assert.equal(m.get("RSI_Galaxy"), "Objects/Spaceships/Ships/RSI/galaxy/rsi_galaxy.cga");
  assert.equal(m.get("TMBL_Cyclone"), "Objects/Vehicles/TMBL/Cyclone/TMBL_Cyclone.cga");
  assert.equal(m.size, 2);
});

test("isShipGeometry : coque .cga sous Ships ou Vehicles ; rejette le reste", () => {
  assert.ok(isShipGeometry("Objects/Spaceships/Ships/RSI/galaxy/rsi_galaxy.cga"));
  assert.ok(isShipGeometry("objects\\Vehicles\\RSI\\Ursa\\RSI_Ursa_Rover.cga")); // terrestre + antislash
  assert.ok(!isShipGeometry("Objects/Spaceships/Ships/RSI/galaxy/rsi_galaxy_door.cgf")); // .cgf = pièce
  assert.ok(!isShipGeometry("Objects/Characters/PowerSuit/ARGO/ATLS/argo_atls.cdf")); // hors racine
  assert.ok(!isShipGeometry(""));
});

test("EXCLUDE_RE : écarte PNJ/événement/épave, garde les vraies variantes", () => {
  for (const k of ["AEGS_Gladius_AI_Super", "RSI_Polaris_AI_Super_CIV", "DRAK_Cutlass_Black_BIS2950",
    "ANVL_Valkyrie_CitizenCon", "AEGS_Reclaimer_Teach", "SalvageableDebris_C2", "RSI_Apollo_Medivac_Tier_1",
    "AEGS_Idris_M_PU_Invictus", "ANVL_Lightning_F8_Fleetweek"]) {
    assert.ok(EXCLUDE_RE.test(k), `devrait exclure ${k}`);
  }
  for (const k of ["RSI_Galaxy", "AEGS_Avenger_Titan", "AEGS_Hammerhead_Showdown", "ANVL_Carrack_Expedition",
    "AEGS_Idris_P_Collector_Military", "TMBL_Cyclone_AA", "GRIN_ROC_DS", "RSI_Apollo_Medivac",
    "ANVL_Hornet_F7C_Mk2"]) {
    assert.ok(!EXCLUDE_RE.test(k), `ne devrait PAS exclure ${k}`);
  }
});

test("selectShips : véhicule + coque + non exclu ; trié, dédupliqué", () => {
  const vehicleKeys = ["RSI_Galaxy", "RSI_Galaxy_AI_Template", "TMBL_Cyclone", "RSI_Galaxy_Module_OC", "AEGS_Gladius"];
  const geomByKey = new Map([
    ["RSI_Galaxy", "Objects/Spaceships/Ships/RSI/galaxy/rsi_galaxy.cga"],
    ["RSI_Galaxy_AI_Template", "Objects/Spaceships/Ships/RSI/galaxy/rsi_galaxy.cga"], // exclu par nom
    ["TMBL_Cyclone", "Objects/Vehicles/TMBL/Cyclone/TMBL_Cyclone.cga"],
    ["RSI_Galaxy_Module_OC", "Objects/Spaceships/Ships/RSI/galaxy/exterior/rsi_galaxy_module.cgf"], // .cgf exclu
    ["AEGS_Gladius", "Objects/Spaceships/Ships/AEGS/Gladius/AEGS_Gladius.cga"],
  ]);
  assert.deepEqual(selectShips({ vehicleKeys, geomByKey }), ["AEGS_Gladius", "RSI_Galaxy", "TMBL_Cyclone"]);
});

test("deriveShipLabel : fabricant = 1er token, nom = reste", () => {
  assert.deepEqual(deriveShipLabel("RSI_Galaxy"), { manufacturer: "RSI", name: "Galaxy" });
  assert.deepEqual(deriveShipLabel("AEGS_Avenger_Titan"), { manufacturer: "AEGS", name: "Avenger Titan" });
});

test("bboxToDims : Vec3 jeu -> dims projet (l=y, b=x, h=z), arrondi 0.1", () => {
  assert.deepEqual(bboxToDims({ x: 60, y: 110, z: 25 }), { l: 110, b: 60, h: 25 });
  assert.deepEqual(bboxToDims({ x: 17.54, y: 21.01, z: 5.5 }), { l: 21, b: 17.5, h: 5.5 });
  assert.equal(bboxToDims(null), null);
  assert.equal(bboxToDims({ x: 1, y: null, z: 2 }), null);
});

test("mergeGameShips : ajoute les clés jeu absentes, dims depuis bbox, préserve l'existant", () => {
  const meta = { _comment: "x", AEGS_Gladius: { name: "Gladius", manufacturer: "Aegis", dims: { l: 1, b: 2, h: 3 } } };
  const merged = mergeGameShips(meta, ["AEGS_Gladius", "RSI_Galaxy"], { RSI_Galaxy: { l: 110, b: 60, h: 25 } });
  assert.equal(merged.AEGS_Gladius.dims.l, 1); // inchangé
  assert.equal(merged.RSI_Galaxy.name, "Galaxy");
  assert.equal(merged.RSI_Galaxy.manufacturer, "RSI");
  assert.equal(merged.RSI_Galaxy.fromGame, true);
  assert.deepEqual(merged.RSI_Galaxy.dims, { l: 110, b: 60, h: 25 });
});

test("mergeGameShips : dims à 0 si la bbox manque", () => {
  const merged = mergeGameShips({}, ["DRAK_Marauder"]);
  assert.deepEqual(merged.DRAK_Marauder.dims, { l: 0, b: 0, h: 0 });
});

test("diffCatalogue : nouveaux en jeu vs manquants du jeu", () => {
  const d = diffCatalogue(["RSI_Galaxy", "AEGS_Gladius"], new Set(["AEGS_Gladius", "AEGS_Retaliator"]));
  assert.deepEqual(d.newInGame, ["RSI_Galaxy"]);
  assert.deepEqual(d.missingFromGame, ["AEGS_Retaliator"]);
});
