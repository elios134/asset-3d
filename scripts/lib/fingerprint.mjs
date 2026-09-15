// fingerprint.mjs — cœur PUR de la détection « ce vaisseau a-t-il réellement changé ? ».
//
// Principe : l'empreinte d'un vaisseau = hash de la liste (chemin source, taille) de TOUTES
// ses géométries (.cga/.cgf). Les chemins viennent de `starbreaker entity loadout <key>`
// (arbre geom=…) ; les tailles de `starbreaker p4k list` (chemin<TAB>taille, sans décompression).
// « Modifié » = cette empreinte diffère de celle enregistrée à la publication → détection PAR
// vaisseau, jamais « le jeu a bougé donc tout est suspect ». Aucune I/O ici (testé isolément).

import { createHash } from "node:crypto";

// Chemin canonique : minuscules, slashs avant, sans préfixe « data/ ».
// Réconcilie les chemins loadout (sans Data/, casse/slashs mixtes) et p4k (Data\…, backslashs).
export function normPath(p) {
  let s = String(p ?? "").trim().replace(/\\/g, "/").toLowerCase();
  if (s.startsWith("data/")) s = s.slice(5);
  return s;
}

// Extrait les géométries réelles d'un arbre loadout : valeurs après « geom= » ≠ « - »,
// normalisées, dédoublonnées, triées (ordre stable indépendant du rendu StarBreaker).
export function parseLoadoutGeoms(loadoutText) {
  const set = new Set();
  for (const m of String(loadoutText ?? "").matchAll(/geom=(\S+)/g)) {
    const raw = m[1];
    if (raw === "-") continue;
    set.add(normPath(raw));
  }
  return [...set].sort();
}

// Parse « chemin<TAB>taille » (sortie de `p4k list`) en Map chemin normalisé → taille (number).
// Ignore les lignes vides ou sans taille numérique.
export function parseP4kList(listText) {
  const map = new Map();
  for (const line of String(listText ?? "").split(/\r?\n/)) {
    if (!line) continue;
    const tab = line.lastIndexOf("\t");
    if (tab < 0) continue;
    const size = Number(line.slice(tab + 1).trim());
    if (!Number.isFinite(size)) continue;
    map.set(normPath(line.slice(0, tab)), size);
  }
  return map;
}

// Empreinte stable : sha256 des lignes triées « chemin:taille ». Une géométrie absente du p4k
// est marquée « ? » (distincte d'une taille 0) pour capter apparition/disparition de fichier.
export function computeFingerprint(geomPaths, sizeMap) {
  const lines = [...geomPaths]
    .map((p) => normPath(p))
    .sort()
    .map((p) => `${p}:${sizeMap.has(p) ? sizeMap.get(p) : "?"}`);
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}
