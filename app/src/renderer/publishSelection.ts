// publishSelection.ts — cœur PUR de la sélection des clés à publier (tranche « re-upload correctif »).
// Découple le jeu à publier des clés extraites dans la session : on part de sessionKeys mais on peut
// ajouter/retirer n'importe quelle clé du catalogue, pour republier un vaisseau corrigé à la main sans
// le ré-extraire. Aucune logique React ici — testé isolément.

// Jeu initial = clés de session + clés déjà extraites non encore publiées (« prêtes »),
// dédupliquées (ordre préservé, session d'abord). asset-3D = vérité : tout vaisseau
// extrait sur disque et absent de la prod est proposé d'office à la publication.
export function initPublishKeys(sessionKeys: string[], readyKeys: string[] = []): string[] {
  return [...new Set([...sessionKeys, ...readyKeys])];
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
