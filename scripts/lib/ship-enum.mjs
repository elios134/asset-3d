// ship-enum.mjs — énumère les vaisseaux/véhicules PILOTABLES directement depuis le
// jeu (DataCore), pour que asset-3D soit la source de vérité de « ce qui existe à
// extraire », indépendamment de SCFM. Logique pure et testée ; les requêtes
// StarBreaker (dcb query) sont faites par scripts/list-ships.mjs.
//
// Règle : un EntityClassDefinition est un vaisseau si (1) il porte un composant
// VehicleComponentParams ET (2) sa géométrie de coque est sous Objects/Spaceships/
// Ships/ ou Objects/Vehicles/ (véhicules terrestres), ET (3) son nom n'est pas une
// variante PNJ/événement/épave/test (EXCLUDE_RE). Chaque variante jouable
// (classNameCig) reste un vaisseau distinct — on ne regroupe PAS par coque.

const norm = (s) => String(s ?? "").replace(/\\/g, "/").trim().replace(/^"|"$/g, "");

// Parse une projection `dcb query` : lignes « <RecordName>\t<valeur> ».
// Renvoie une Map clé(sans préfixe EntityClassDefinition.) -> valeur normalisée.
export function parseProjection(text) {
  const out = new Map();
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const t = line.indexOf("\t");
    if (t < 0) continue;
    const key = line.slice(0, t).replace(/^EntityClassDefinition\./, "").trim();
    if (key) out.set(key, norm(line.slice(t + 1)));
  }
  return out;
}

// Une géométrie de coque jouable : .cga sous Spaceships/Ships ou Vehicles.
export function isShipGeometry(path) {
  const p = norm(path).toLowerCase();
  if (!/\.cga$/.test(p)) return false;
  return /objects\/spaceships\/ships\//.test(p) || /objects\/vehicles\//.test(p);
}

// Variantes à écarter : PNJ/IA, événements, épaves, tests, PU/mission, debris.
// (Les vraies variantes jouables — _Mk2, _Showdown, _Collector_Military, _Expedition,
//  _Medivac, suffixes de livrée — ne matchent PAS et sont conservées.)
export const EXCLUDE_RE = new RegExp(
  [
    "_AI(_|$)", "_NPC", "_PU(_|$)", "_TEMP(_|$)", "_Template$", "_Test$", "_Teach$",
    "_Tutorial", "_Dummy", "_Wreck", "_Hijacked", "_Salvage", "Salvageable",
    "_Debris", "_Derelict", "_Simplified", "_Unmanned", "_QIG", "_Modifiers",
    "_Hologram", "_Icon", "_Dead", "_Static", "_ReportCard", "_Showcase", "_Display",
    "_Boarded", "_ShipBoarded", "_ShipShowdown", "_Mission(_|$)", "_Package",
    "_Override", "_Swarm", "_Spawn", "_Stunt", "_Advocacy", "_Indestructible",
    "_GameMaster", "_Invictus", "_Drug", "_Bombless", "_NoInterior", "_NoCargo",
    "_HalfCargo", "_BIS\\d{4}", "_Fleetweek", "_FW_?\\d", "_FW22", "_CitizenCon",
    "_Collector_Grad", "_Elite$", "_Prime$", "_Alpha$", "_DefendShip", "_Dropship",
    "_MedicalRescue", "_Boarding", "_Crewless", "_Tier_\\d",
  ].join("|"),
  "i",
);

// Sélectionne les clés de vaisseaux à partir des deux projections :
//  vehicleKeys : clés ayant un composant VehicleComponentParams
//  geomByKey   : clé -> chemin de géométrie de coque
export function selectShips({ vehicleKeys, geomByKey, excludeRe = EXCLUDE_RE }) {
  const ships = [];
  for (const key of vehicleKeys) {
    const path = geomByKey.get(key);
    if (!path || !isShipGeometry(path)) continue;
    if (excludeRe.test(key)) continue;
    ships.push(key);
  }
  return [...new Set(ships)].sort();
}

// Dérive un nom d'affichage et un fabricant depuis la clé classNameCig
// (ex. "AEGS_Avenger_Titan" → { manufacturer: "AEGS", name: "Avenger Titan" }).
// Repli lisible tant que l'extraction/gen-meta n'a pas fourni les vraies valeurs.
export function deriveShipLabel(key) {
  const parts = String(key).split("_");
  const manufacturer = parts[0] ?? key;
  const name = parts.slice(1).join(" ") || key;
  return { manufacturer, name };
}

// Fusionne les vaisseaux du JEU dans le catalogue meta : toute clé présente en jeu
// mais absente de meta reçoit une entrée synthétique (dims à 0, à mesurer à
// l'extraction) pour apparaître dans l'app. Ne touche pas aux entrées existantes.
export function mergeGameShips(meta, gameKeys) {
  const out = { ...meta };
  for (const key of gameKeys) {
    if (key === "_comment" || out[key]) continue;
    const { manufacturer, name } = deriveShipLabel(key);
    out[key] = { name, manufacturer, dims: { l: 0, b: 0, h: 0 }, fromGame: true };
  }
  return out;
}

// Diff entre la liste jeu et un catalogue existant (set de clés).
export function diffCatalogue(gameShips, catalogueKeys) {
  const cat = catalogueKeys instanceof Set ? catalogueKeys : new Set(catalogueKeys);
  const game = new Set(gameShips);
  return {
    newInGame: gameShips.filter((k) => !cat.has(k)),
    missingFromGame: [...cat].filter((k) => !game.has(k)).sort(),
  };
}
