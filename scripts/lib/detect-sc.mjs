// detect-sc.mjs — détection automatique de l'installation Star Citizen (Data.p4k)
// et de StarBreaker, SANS chemin codé en dur : on balaie les emplacements
// d'installation RSI Launcher *conventionnels* sur les disques présents.
// Logique pure (candidateP4ks/candidateExes/pickExisting) testée ; les
// orchestrateurs (detect*) sont minces et font les accès disque.
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";

// Racines d'install RSI connues, relatives à la racine d'un disque. Ordre = priorité.
// Inclut les bibliothèques personnalisées (le joueur choisit où installer le jeu),
// ex. "D:/StarCitizen/LIVE" rencontré en vrai.
export const RSI_ROOTS = [
  "Program Files/Roberts Space Industries/StarCitizen",
  "Program Files/RSI Launcher/StarCitizen",
  "Roberts Space Industries/StarCitizen",
  "RSI Launcher/StarCitizen",
  "Games/Roberts Space Industries/StarCitizen",
  "Games/RSI Launcher/StarCitizen",
  "StarCitizen",
  "Games/StarCitizen",
  "SC",
];

// Canaux de jeu, LIVE en priorité.
export const CHANNELS = ["LIVE", "PTU", "EPTU", "HOTFIX", "TECH-PREVIEW"];

const DRIVE_LETTERS = ["C", "D", "E", "F", "G", "H"];

const norm = (p) => p.replace(/\\/g, "/").replace(/\/+/g, "/");

// Fabrique la liste ordonnée des chemins Data.p4k candidats. Gère la variante
// d'install imbriquée (…/StarCitizen/StarCitizen/<canal>) rencontrée en vrai.
export function candidateP4ks({ drives = DRIVE_LETTERS, roots = RSI_ROOTS, channels = CHANNELS } = {}) {
  const out = [];
  for (const drive of drives) {
    for (const root of roots) {
      for (const nested of ["", "/StarCitizen"]) {
        for (const ch of channels) {
          out.push(norm(`${drive}:/${root}${nested}/${ch}/Data.p4k`));
        }
      }
    }
  }
  return out;
}

// Fabrique la liste des exécutables candidats (dossier × nom).
export function candidateExes({ bases, names }) {
  const out = [];
  for (const base of bases) {
    for (const name of names) out.push(norm(`${base}/${name}`));
  }
  return out;
}

// Premier candidat existant (l'ordre encode la priorité).
export function pickExisting(candidates, existsFn) {
  return candidates.find((p) => existsFn(p)) ?? null;
}

// Balayage superficiel : pour chaque dossier de premier niveau d'un disque, teste
// <dir>/<canal>/Data.p4k et <dir>/StarCitizen/<canal>/Data.p4k. Rattrape une
// bibliothèque personnalisée dont le nom ne figure pas dans RSI_ROOTS, sans
// parcourir tout le disque (un seul readdir par disque + quelques existsSync).
export function candidateP4ksFromDirs({ drive, dirs, channels = CHANNELS }) {
  const out = [];
  for (const dir of dirs) {
    for (const nested of ["", "/StarCitizen"]) {
      for (const ch of channels) out.push(norm(`${drive}:/${dir}${nested}/${ch}/Data.p4k`));
    }
  }
  return out;
}

// Disques présents (teste l'existence de "X:/").
export function listDrives(existsFn = existsSync) {
  return DRIVE_LETTERS.filter((d) => existsFn(`${d}:/`));
}

// --- Orchestrateurs (accès disque) ---

export function detectP4k({ existsFn = existsSync, readDirsFn = safeReaddir } = {}) {
  const drives = listDrives(existsFn);
  // 1) Emplacements conventionnels (rapide, ordre = priorité).
  const byConvention = pickExisting(candidateP4ks({ drives }), existsFn);
  if (byConvention) return byConvention;
  // 2) Secours : bibliothèque personnalisée (balayage superficiel par disque).
  for (const drive of drives) {
    const dirs = readDirsFn(`${drive}:/`);
    const hit = pickExisting(candidateP4ksFromDirs({ drive, dirs }), existsFn);
    if (hit) return hit;
  }
  return null;
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export function detectStarbreaker({ existsFn = existsSync, home = homedir() } = {}) {
  const h = norm(home);
  const drives = listDrives(existsFn);
  const bases = [
    `${h}/Documents/starbreaker`,
    `${h}/starbreaker`,
    `${h}/Tools/starbreaker`,
    `${h}/Downloads/starbreaker`,
    `${h}/Documents`,
    ...drives.map((d) => `${d}:/starbreaker`),
    ...drives.map((d) => `${d}:/Tools/starbreaker`),
  ];
  return pickExisting(candidateExes({ bases, names: ["starbreaker.exe", "StarBreaker.exe"] }), existsFn);
}
