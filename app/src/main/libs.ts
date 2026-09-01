import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function loadLib<T = unknown>(repoRoot: string, rel: string): Promise<T> {
  const url = pathToFileURL(join(repoRoot, "scripts", "lib", rel)).href;
  return (await import(/* @vite-ignore */ url)) as T;
}
