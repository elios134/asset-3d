// no-modules.mjs — table data-driven des vaisseaux dont l'export doit IGNORER les modules
// (armes/propulseurs/roues/tourelles), car StarBreaker les sort explosés/mal placés pour ces clés.
//
// Le pipeline passe `--modules` par défaut (placement corrigé pour le gros du catalogue). Mais certaines
// clés ressortent des modules aberrants qui gonflent la bbox et cassent la QA dims. Ex. TMBL_Nova :
// avec --modules, 8× `wheel_big` de 12.9 m -> bbox 21.9×12.9 ; sans, géo propre 7.3×3.1×13.1.
// Même famille que le Mauler explosé.
export const NO_MODULES = new Set([
  "TMBL_Nova",
]);

// true si l'export de cette clef doit ignorer les modules même quand --modules est demandé.
export function skipModules(key) {
  return NO_MODULES.has(key);
}
