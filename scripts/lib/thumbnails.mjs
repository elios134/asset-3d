import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const EDITIONS = /\s+(renegade|best in show|executive|exec|bis\d*|wikelo|pyam)\b.*$/i;

export function baseName(name) {
  return name.replace(EDITIONS, "").trim();
}

export function pickImageUrl(vehicle) {
  const imgs = vehicle?.images ?? [];
  return imgs[0]?.thumbnail_url ?? null;
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

async function queryVehicle(name, fetchImpl, apiBase) {
  const url = `${apiBase}/vehicles?limit=1&include=media&filter[name]=${encodeURIComponent(name)}`;
  const res = await fetchImpl(url);
  if (!res.ok) return null;
  const body = await res.json();
  const list = body?.data ?? [];
  return list[0] ? pickImageUrl(list[0]) : null;
}

export async function getThumbnail({ name, cacheDir, fetchImpl = fetch, apiBase = "https://api.star-citizen.wiki/api/v2" }) {
  try {
    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
    const path = join(cacheDir, `${slug(name)}.jpg`);
    if (existsSync(path)) return { path, source: "cache" };
    let imgUrl = await queryVehicle(name, fetchImpl, apiBase);
    if (!imgUrl) imgUrl = await queryVehicle(baseName(name), fetchImpl, apiBase);
    if (!imgUrl) return { path: null, source: "none" };
    const img = await fetchImpl(imgUrl);
    if (!img.ok) return { path: null, source: "none" };
    writeFileSync(path, Buffer.from(await img.arrayBuffer()));
    return { path, source: "wiki" };
  } catch {
    return { path: null, source: "none" };
  }
}
