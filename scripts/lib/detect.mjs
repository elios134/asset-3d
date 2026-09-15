// detect.mjs — décide, par vaisseau, ce qu'il reste à faire. Cœur PUR (aucune I/O).
//
// Détection « modifié » PAR EMPREINTE DE SOURCE, pas par numéro de version :
//   - `baseline[key]` = empreinte enregistrée à la dernière publication (source-baseline.json).
//   - `current[key]`  = empreinte calculée maintenant (cache produit par scripts/fingerprint.mjs).
// « version modifiée » ⟺ les deux empreintes existent ET diffèrent. Si la baseline manque
// (asset publié à la main avant l'ère des empreintes) on ADOPTE l'existant → « à jour » : la
// prod fait foi, on ne propose jamais de republier quelque chose qu'on n'a pas vu changer.

// Conservé pour compat (analyze.mjs affiche encore local vs prod), plus utilisé pour « modifié ».
function parse(v) {
  const m = /(\d+)\.(\d+)/.exec(v ?? "");
  return m ? [Number(m[1]), Number(m[2])] : null;
}
export function compareVersion(a, b) {
  const pa = parse(a), pb = parse(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  if (pa[0] !== pb[0]) return pa[0] < pb[0] ? -1 : 1;
  if (pa[1] !== pb[1]) return pa[1] < pb[1] ? -1 : 1;
  return 0;
}

export function analyzeShips({ meta, index, baseline = {}, current = {}, anchorKeys, visitableKeys }) {
  const byKey = new Map((index?.ships ?? []).map((s) => [s.key, s]));
  const globalPub = index?.patchVersion ?? null;
  const ships = [];
  for (const key of Object.keys(meta)) {
    if (key === "_comment") continue;
    const m = meta[key];
    const pub = byKey.get(key) ?? null;
    const extPublished = !!pub?.variants?.some((v) => v.level === "exterior");
    const intPublished = !!pub?.variants?.some((v) => v.level === "interior");
    const pubVersion = pub?.patchVersion ?? (pub ? globalPub : null);

    // Empreinte : « modifié » seulement si baseline ET current présents et différents.
    const base = baseline[key];
    const cur = current[key];
    const modified = extPublished && base != null && cur != null && base !== cur;

    // Intérieur manquant : uniquement pour un vaisseau réellement visitable (sinon bruit).
    const wantsInterior = !!visitableKeys && visitableKeys.has(key);
    const interiorMissing = extPublished && !intPublished && wantsInterior;

    const reasons = [];
    if (!extPublished) reasons.push("nouveau");
    else if (modified) reasons.push("version modifiée");
    if (interiorMissing) reasons.push("intérieur manquant");

    ships.push({
      key, name: m.name, manufacturer: m.manufacturer, dims: m.dims,
      exterior: { published: extPublished, patchVersion: pubVersion },
      interior: { published: intPublished, anchored: !!anchorKeys && anchorKeys.has(key) },
      reasons, status: reasons[0] ?? "à jour",
      toProcess: reasons.length > 0,
      availableLevels: ["exterior", "interior"],
    });
  }
  return ships;
}
