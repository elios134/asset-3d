// Éditions non exportables masquées de la galerie :
//  - peintures d'événement (wikelo / pyam / Best In Show, y c. l'abréviation BIS) — sur le nom ;
//  - variantes « Alliance » (suffixe interne CIG _BTALA) — sur la clé.
// Ces règles sont AUTOMATIQUES. S'y ajoute une liste MANUELLE éditable (exclusions.json,
// gérée dans l'app) pour écarter au cas par cas des vaisseaux que SCFM n'utilise pas.
const EXCLUDED_NAME = /\bwikelo\b|\bpyam\b|best in show|\bbis\b/i;
const EXCLUDED_KEY = /_BTALA$/i;

// Exclu par une règle automatique (non modifiable depuis l'UI).
export function isAutoExcluded(ship: { name: string; key: string }): boolean {
  return EXCLUDED_NAME.test(ship.name) || EXCLUDED_KEY.test(ship.key);
}

// Exclu au total = règle auto OU présent dans la liste manuelle.
export function isExcluded(ship: { name: string; key: string }, manual?: ReadonlySet<string>): boolean {
  return isAutoExcluded(ship) || (manual ? manual.has(ship.key) : false);
}
