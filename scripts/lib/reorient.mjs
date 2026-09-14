// reorient.mjs — table data-driven des vaisseaux dont l'export StarBreaker doit etre reoriente
// (quart(s) de tour +Y) pour respecter la convention catalogue (longueur sur Z, largeur sur X ; cf qa.mjs).
//
// Une ligne par cas. Valeur = nombre de quarts de tour +Y (1 = +90, 2 = 180, 3 = -90).
// La rotation elle-meme est appliquee par reorientDoc (scripts/rotate-glb.mjs).
//
// DRAK_Clipper : brut = longueur 49.5 sur X ; publie (Release sc-4.1, commit de8f3a3) = nez sur Z (Y+90).
export const REORIENT = {
  DRAK_Clipper: 1,
};

// Nombre de quarts de tour +Y a appliquer a la clef donnee. 0 = aucune reorientation (defaut).
export function reorientTurns(key) {
  return REORIENT[key] ?? 0;
}
