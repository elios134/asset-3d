// publishSelection.ts — cœur PUR de la sélection des clés à publier (tranche « re-upload correctif »).
// Découple le jeu à publier des clés extraites dans la session : on part de sessionKeys mais on peut
// ajouter/retirer n'importe quelle clé du catalogue, pour republier un vaisseau corrigé à la main sans
// le ré-extraire. Aucune logique React ici — testé isolément.

// Jeu initial = clés de session, dédupliquées (ordre préservé).
export function initPublishKeys(sessionKeys: string[]): string[] {
  return [...new Set(sessionKeys)];
}

// Ajoute une clé si absente (et non vide). Immuable.
export function addPublishKey(keys: string[], key: string): string[] {
  if (!key || keys.includes(key)) return keys;
  return [...keys, key];
}

// Retire une clé. Immuable.
export function removePublishKey(keys: string[], key: string): string[] {
  return keys.filter((k) => k !== key);
}

// Clés du catalogue encore ajoutables (non déjà sélectionnées), ordre du catalogue préservé.
export function publishCandidates(allKeys: string[], selected: string[]): string[] {
  const set = new Set(selected);
  return allKeys.filter((k) => !set.has(k));
}

// Publiable ssi au moins une clé dans le jeu.
export function canPublish(keys: string[]): boolean {
  return keys.length > 0;
}
