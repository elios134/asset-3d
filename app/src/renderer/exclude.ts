// Éditions non exportables par le pipeline (wikelo / pyam / Best In Show, y compris l'abréviation BIS)
// — masquées de la galerie.
const EXCLUDED_EDITION = /\bwikelo\b|\bpyam\b|best in show|\bbis\b/i;

export function isExcludedEdition(name: string): boolean {
  return EXCLUDED_EDITION.test(name);
}
