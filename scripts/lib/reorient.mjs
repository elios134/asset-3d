// reorient.mjs — table data-driven des vaisseaux dont l'export StarBreaker doit etre reoriente
// (quart(s) de tour +Y) pour respecter la convention catalogue (longueur sur Z, largeur sur X ; cf qa.mjs).
//
// Une ligne par cas. Valeur = nombre de quarts de tour +Y (1 = +90, 2 = 180, 3 = -90).
// La rotation elle-meme est appliquee par reorientDoc (scripts/rotate-glb.mjs).
//
// DRAK_Clipper : brut = longueur 49.5 sur X ; publie (Release sc-4.1, commit de8f3a3) = nez sur Z (Y+90).
// MISC_Reliant (+ Mako/Sen/Tana) : l/b inverses a l'export (nez sur X), hauteur OK -> permutation propre
//   (propre 15.8x30.3x4.0 ≈ reel 28.5x14.75x4.5 une fois X<->Z croises). Y+90 recale (2026-09-15).
//   Signe (+90/-90) a confirmer visuellement via une extraction StarBreaker ; les dims passent dans les deux cas.
// NB : TMBL_Nova N'EST PAS un cas de rotation — sa hauteur diverge aussi (propre 5.7 vs reel 11), qu'aucune
//   rotation 90° ne corrige. A investiguer separement (geometrie/dims), hors de cette table.
export const REORIENT = {
  DRAK_Clipper: 1,
  MISC_Reliant: 1,
  MISC_Reliant_Mako: 1,
  MISC_Reliant_Sen: 1,
  MISC_Reliant_Tana: 1,
};

// Nombre de quarts de tour +Y a appliquer a la clef donnee. 0 = aucune reorientation (defaut).
export function reorientTurns(key) {
  return REORIENT[key] ?? 0;
}
