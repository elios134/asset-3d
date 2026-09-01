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

export function analyzeShips({ meta, index, localVersion, anchorKeys }) {
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
    const outdated = extPublished && localVersion && compareVersion(localVersion, pubVersion) > 0;

    const reasons = [];
    if (!extPublished) reasons.push("nouveau");
    else if (outdated) reasons.push("version modifiée");
    if (extPublished && !intPublished) reasons.push("intérieur manquant");

    ships.push({
      key, name: m.name, manufacturer: m.manufacturer, dims: m.dims,
      exterior: { published: extPublished, patchVersion: pubVersion },
      interior: { published: intPublished, anchored: anchorKeys.has(key) },
      reasons, status: reasons[0] ?? "à jour",
      toProcess: reasons.length > 0,
      availableLevels: ["exterior", "interior"],
    });
  }
  return ships;
}
