// app-config-io.mjs — lecture/écriture tolérante de app-config.json (machine-local,
// gitignoré) + validation des chemins choisis dans l'app. Pure (validatePath,
// mergePaths) + IO minces (readAppConfig/writeAppConfig).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";

export const CONFIG_KEYS = ["p4k", "starbreaker", "blender"];

// Renvoie null si OK, sinon un message d'erreur en français.
export function validatePath(key, value, existsFn = existsSync) {
  if (!CONFIG_KEYS.includes(key)) return `Clé inconnue : ${key}.`;
  if (typeof value !== "string" || !value.trim()) return "Chemin vide.";
  if (!existsFn(value)) return "Ce fichier n'existe pas sur le disque.";
  if (key === "p4k" && basename(value).toLowerCase() !== "data.p4k") {
    return "Choisis le fichier Data.p4k du jeu (pas le dossier).";
  }
  return null;
}

// Fusionne une valeur de chemin dans un objet config sans écraser les autres champs.
export function mergePaths(current, key, value) {
  const next = { ...(current ?? {}) };
  next.paths = { ...(next.paths ?? {}), [key]: value };
  return next;
}

export function readAppConfig(root) {
  try {
    const p = join(root, "app-config.json");
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

export function writeAppConfig(root, obj) {
  writeFileSync(join(root, "app-config.json"), JSON.stringify(obj, null, 2) + "\n");
}
