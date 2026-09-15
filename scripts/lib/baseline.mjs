// baseline.mjs — cœur PUR de la gestion de source-baseline.json (empreintes de référence).
// La baseline est la mémoire « à quoi ressemblait la source quand on a publié ». On l'ADOPTE :
//  - au backfill initial : toutes les clés déjà en prod prennent leur empreinte actuelle
//    (la prod manuelle devient la référence, donc rien n'est signalé « modifié » à tort) ;
//  - après chaque publication : les clés publiées prennent leur nouvelle empreinte.

// Clés publiées = présentes dans index.json avec au moins une variante exterior.
export function publishedKeys(index) {
  return (index?.ships ?? [])
    .filter((s) => (s.variants ?? []).some((v) => v.level === "exterior"))
    .map((s) => s.key);
}

// Retourne une NOUVELLE baseline = prev + { k: current[k] } pour chaque k de `keys`
// dont l'empreinte courante est connue. N'altère pas prev.
export function adoptBaseline(prev, current, keys) {
  const out = { ...prev };
  for (const k of keys) {
    if (current[k] != null) out[k] = current[k];
  }
  return out;
}
