// SOURCE UNIQUE des exclusions de vaisseaux (asset-3D = verite pour tout ce qui est 3D).
// JavaScript pur, sans dependance : lu par l'app (galerie, publication) ET par les scripts du
// pipeline (build-clay, build-hd, build-index, batch-*). Ne pas dupliquer ces regles ailleurs.
//  - peintures d'evenement (wikelo / pyam / Best In Show, y c. l'abreviation BIS) — sur le nom ;
//  - variantes « Alliance » (suffixe interne CIG _BTALA) — sur la cle.
// S'y ajoute la liste MANUELLE (exclusions.json, editee dans l'app) pour le cas par cas.
export const EXCLUDED_NAME = /\bwikelo\b|\bpyam\b|best in show|\bbis\b/i;
export const EXCLUDED_KEY = /_BTALA$/i;

// Exclu par une regle automatique (non modifiable depuis l'UI).
export function isAutoExcluded(ship) {
  return EXCLUDED_NAME.test(ship.name ?? "") || EXCLUDED_KEY.test(ship.key);
}

// Exclu au total = regle auto OU present dans la liste manuelle.
export function isExcluded(ship, manual) {
  return isAutoExcluded(ship) || (manual ? manual.has(ship.key) : false);
}
