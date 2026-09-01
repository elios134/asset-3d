// Éditions non exportables masquées de la galerie :
//  - peintures d'événement (wikelo / pyam / Best In Show, y c. l'abréviation BIS) — sur le nom ;
//  - variantes « Alliance » (suffixe interne CIG _BTALA) — sur la clé.
const EXCLUDED_NAME = /\bwikelo\b|\bpyam\b|best in show|\bbis\b/i;
const EXCLUDED_KEY = /_BTALA$/i;

export function isExcluded(ship: { name: string; key: string }): boolean {
  return EXCLUDED_NAME.test(ship.name) || EXCLUDED_KEY.test(ship.key);
}
