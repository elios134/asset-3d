# Coquille Electron + galerie (Plan 2a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une application desktop Electron (TypeScript + React) qui s'ouvre, détecte version locale/publiée + prérequis, et affiche la **galerie** des 273 vaisseaux (vignettes SC Wiki, recherche, filtre « À traiter / Tout », choix `Extérieur`/`Intérieur` par vaisseau avec sélection) — en réutilisant le moteur du Plan 1. L'extraction/QA/publication réelles sont hors périmètre (Plan 2b).

**Architecture:** L'app vit dans `app/` (package.json isolé). Le **main process** (Node) réutilise le Plan 1 de deux façons : il *spawn* `node scripts/analyze.mjs --json` (versions + liste des vaisseaux) et *importe dynamiquement* les libs pures `scripts/lib/{prereqs,thumbnails,config}.mjs` par chemin absolu résolu depuis la racine du dépôt. Le **renderer** React ne fait aucune I/O : il passe par un pont IPC typé exposé en `preload` (`window.api`). `contextIsolation: true`, `nodeIntegration: false`.

**Tech Stack:** Electron, electron-vite, electron-builder, React 18, TypeScript, Vitest (tests du main process). Node 22.

**Spec:** `docs/superpowers/specs/2026-09-01-app-desktop-gestion-api-design.md`
**Dépend de:** Plan 1 (moteur pilotable) — `scripts/analyze.mjs`, `scripts/lib/{prereqs,thumbnails,config,detect}.mjs` déjà livrés.

## Global Constraints

- Tout le code app sous `app/` ; NE PAS modifier les scripts du Plan 1 (à la racine). L'app les consomme, ne les altère pas.
- TypeScript strict ; React 18 ; ESM dans le renderer/preload.
- Sécurité : fenêtre créée avec `contextIsolation: true`, `nodeIntegration: false`. `sandbox: false` est requis (preload ESM `.mjs`, conforme au template officiel electron-vite) — sûr ici car `contextIsolation` reste actif et le renderer n'a aucun accès Node. Le renderer n'accède au système QUE via `window.api` (préchargé).
- Réutilisation Plan 1 : `analyze` = spawn `node scripts/analyze.mjs --json` avec `cwd` = racine du dépôt. Les libs pures (`prereqs`, `thumbnails`, `config`) = import dynamique par chemin absolu (jamais bundlé — laisser en runtime).
- Le contrat de données suit la sortie du Plan 1 : `analyze.mjs --json` renvoie UN objet JSON `{ localVersion, publishedVersion, counts:{toProcess,total}, ships:[Ship] }`. Ne pas re-typer différemment.
- Vignettes cosmétiques : une vignette absente n'empêche jamais l'affichage d'une carte (repli silhouette).
- Tests du main process via Vitest (`app/`), lancés par `npm test` dans `app/`.
- Racine du dépôt résolue dynamiquement (remonter jusqu'à trouver `scripts/analyze.mjs`) — jamais codée en dur.

---

### Task 1: Scaffold Electron + Vite + TypeScript + React (fenêtre minimale)

**Files:**
- Create: `app/package.json`, `app/electron.vite.config.ts`, `app/tsconfig.json`, `app/tsconfig.node.json`
- Create: `app/src/main/index.ts`, `app/src/preload/index.ts`, `app/src/renderer/index.html`, `app/src/renderer/main.tsx`, `app/src/renderer/App.tsx`, `app/src/renderer/styles.css`
- Modify: `.gitignore` (racine) — ajouter `app/node_modules`, `app/out`

**Interfaces:**
- Consumes: rien.
- Produces: un projet Electron lançable via `npm run dev` (depuis `app/`) qui ouvre une fenêtre 1100×720 titrée « asset-3D — hangar » affichant un placeholder React.

- [ ] **Step 1: Étendre le `.gitignore` racine**

Ajouter :

```
# App desktop Electron
app/node_modules
app/out
```

- [ ] **Step 2: Créer `app/package.json`**

```json
{
  "name": "asset-3d-desktop",
  "version": "0.1.0",
  "description": "Coquille desktop de gestion de l'API asset-3d",
  "main": "./out/main/index.js",
  "type": "module",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "test": "vitest run",
    "package:win": "electron-vite build && electron-builder --win"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0",
    "electron-vite": "^2.3.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Créer `app/electron.vite.config.ts`**

```ts
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] },
});
```

- [ ] **Step 4: Créer `app/tsconfig.json` et `app/tsconfig.node.json`**

`app/tsconfig.json` :

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node", "vitest/globals"],
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src"]
}
```

`app/tsconfig.node.json` :

```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "types": ["node"]
  },
  "include": ["electron.vite.config.ts"]
}
```

- [ ] **Step 5: Créer le main process minimal `app/src/main/index.ts`**

```ts
import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    title: "asset-3D — hangar",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
```

- [ ] **Step 6: Créer un preload vide typé `app/src/preload/index.ts`**

```ts
import { contextBridge } from "electron";

// Le pont réel est câblé en Task 3.
contextBridge.exposeInMainWorld("api", {});
```

- [ ] **Step 7: Créer le renderer minimal**

`app/src/renderer/index.html` :

```html
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline';" />
    <title>asset-3D — hangar</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`app/src/renderer/main.tsx` :

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`app/src/renderer/App.tsx` :

```tsx
export function App() {
  return (
    <div className="app">
      <h1>asset-3D — hangar</h1>
      <p>Coquille prête. Câblage des données en cours.</p>
    </div>
  );
}
```

`app/src/renderer/styles.css` :

```css
:root { color-scheme: dark; font-family: system-ui, sans-serif; }
body { margin: 0; background: #0b0b0b; color: #e8e6df; }
.app { padding: 24px; }
h1 { font-weight: 500; font-size: 22px; }
```

- [ ] **Step 8: Installer et lancer (vérification manuelle)**

Run (depuis `app/`):

```bash
cd app && npm install && npm run dev
```

Expected: une fenêtre desktop 1100×720 titrée « asset-3D — hangar » s'ouvre et affiche le titre + le texte placeholder. Fermer la fenêtre.

- [ ] **Step 9: Commit**

```bash
git add .gitignore app/package.json app/package-lock.json app/electron.vite.config.ts app/tsconfig.json app/tsconfig.node.json app/src
git commit -m "feat(app): scaffold Electron + Vite + TypeScript + React (fenêtre minimale)"
```

---

### Task 2: Résolution de la racine + runner de spawn JSON (main, testé)

**Files:**
- Create: `app/src/main/repo.ts`, `app/src/main/runner.ts`
- Test: `app/src/main/repo.test.ts`, `app/src/main/runner.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `findRepoRoot(startDir: string): string` — remonte depuis `startDir` jusqu'au premier dossier contenant `scripts/analyze.mjs` ; lève `Error` si introuvable.
  - `runJson(script: string, args: string[], opts: { cwd: string }): Promise<unknown>` — spawn `node <script> <args…>` (script relatif à `cwd`), collecte stdout, `JSON.parse`. Rejette avec un message clair si le process sort non-zéro (en incluant stderr) ou si stdout n'est pas du JSON.

- [ ] **Step 1: Écrire les tests qui échouent**

`app/src/main/repo.test.ts` :

```ts
import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRepoRoot } from "./repo";

test("findRepoRoot remonte jusqu'au dossier contenant scripts/analyze.mjs", () => {
  const root = mkdtempSync(join(tmpdir(), "repo-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts", "analyze.mjs"), "");
  const deep = join(root, "app", "out", "main");
  mkdirSync(deep, { recursive: true });
  expect(findRepoRoot(deep)).toBe(root);
  rmSync(root, { recursive: true, force: true });
});

test("findRepoRoot lève si aucune racine trouvée", () => {
  const bare = mkdtempSync(join(tmpdir(), "bare-"));
  expect(() => findRepoRoot(bare)).toThrow(/racine/i);
  rmSync(bare, { recursive: true, force: true });
});
```

`app/src/main/runner.test.ts` :

```ts
import { test, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJson } from "./runner";

function scratchScript(body: string): { cwd: string; name: string } {
  const cwd = mkdtempSync(join(tmpdir(), "run-"));
  writeFileSync(join(cwd, "s.mjs"), body);
  return { cwd, name: "s.mjs" };
}

test("runJson parse la sortie JSON du script", async () => {
  const { cwd, name } = scratchScript(`process.stdout.write(JSON.stringify({ ok: 1, items: [1,2] }));`);
  const out = (await runJson(name, [], { cwd })) as { ok: number; items: number[] };
  expect(out.ok).toBe(1);
  expect(out.items).toEqual([1, 2]);
  rmSync(cwd, { recursive: true, force: true });
});

test("runJson rejette sur sortie non-zéro avec le stderr", async () => {
  const { cwd, name } = scratchScript(`process.stderr.write("boom"); process.exit(1);`);
  await expect(runJson(name, [], { cwd })).rejects.toThrow(/boom/);
  rmSync(cwd, { recursive: true, force: true });
});

test("runJson rejette si stdout n'est pas du JSON", async () => {
  const { cwd, name } = scratchScript(`process.stdout.write("pas du json");`);
  await expect(runJson(name, [], { cwd })).rejects.toThrow(/JSON/i);
  rmSync(cwd, { recursive: true, force: true });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier l'échec**

Run (depuis `app/`): `npx vitest run src/main/repo.test.ts src/main/runner.test.ts`
Expected: FAIL (modules `./repo`, `./runner` introuvables).

- [ ] **Step 3: Écrire `app/src/main/repo.ts`**

```ts
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, "scripts", "analyze.mjs"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("Racine du dépôt introuvable (scripts/analyze.mjs absent en remontant).");
    dir = parent;
  }
}
```

- [ ] **Step 4: Écrire `app/src/main/runner.ts`**

```ts
import { execFile } from "node:child_process";

export function runJson(script: string, args: string[], opts: { cwd: string }): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile("node", [script, ...args], { cwd: opts.cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`Échec de ${script} : ${stderr?.toString().trim() || err.message}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`Sortie non-JSON de ${script} : ${stdout.slice(0, 200)}`));
      }
    });
  });
}
```

- [ ] **Step 5: Lancer les tests pour vérifier le succès**

Run (depuis `app/`): `npx vitest run src/main/repo.test.ts src/main/runner.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add app/src/main/repo.ts app/src/main/runner.ts app/src/main/repo.test.ts app/src/main/runner.test.ts
git commit -m "feat(app/main): résolution racine dépôt + runner spawn JSON (testés)"
```

---

### Task 3: Types partagés, services main (analyze/prereqs/thumbnails), IPC + pont preload

**Files:**
- Create: `app/src/shared/types.ts`, `app/src/main/libs.ts`, `app/src/main/services.ts`, `app/src/main/ipc.ts`
- Modify: `app/src/main/index.ts` (appeler `registerIpc()`), `app/src/preload/index.ts` (exposer `window.api`)
- Test: `app/src/main/services.test.ts`

**Interfaces:**
- Consumes: `findRepoRoot`, `runJson` (Task 2) ; libs Plan 1 par import dynamique.
- Produces:
  - `types.ts` : `ShipDims`, `Ship`, `AnalyzeResult`, `Prereqs`, et `Api` (le contrat `window.api`).
  - `libs.ts` : `loadLib<T>(repoRoot: string, rel: string): Promise<T>` — import dynamique de `<repoRoot>/scripts/lib/<rel>` via `pathToFileURL`.
  - `services.ts` : `createServices(repoRoot: string)` renvoyant `{ analyze(): Promise<AnalyzeResult>; prereqs(): Promise<Prereqs>; getThumbnail(name: string): Promise<string | null> }`. `analyze` = `runJson("scripts/analyze.mjs", ["--json"], {cwd:repoRoot})`. `prereqs` = charge `config.mjs` + `prereqs.mjs`, renvoie `checkPrereqs({paths: loadConfig({root:repoRoot}).paths})` (si `loadConfig` lève car `app-config.json` absent, renvoyer `{node:true, starbreaker:false, p4k:false, git, gh}` en testant git/gh via `defaultWhich`). `getThumbnail` = charge `thumbnails.mjs`, appelle `getThumbnail({name, cacheDir: join(repoRoot,'.cache','thumbs')})`, lit le fichier et renvoie une **data URL** `data:image/jpeg;base64,…` ou `null`.
  - `ipc.ts` : `registerIpc(repoRoot: string)` — `ipcMain.handle("analyze"|"prereqs"|"thumbnail", …)`.
  - `preload` : `window.api` = `{ analyze, prereqs, getThumbnail }` via `ipcRenderer.invoke`.

- [ ] **Step 1: Créer `app/src/shared/types.ts`**

```ts
export interface ShipDims { l: number; b: number; h: number }

export interface Ship {
  key: string;
  name: string;
  manufacturer: string;
  dims: ShipDims;
  exterior: { published: boolean; patchVersion: string | null };
  interior: { published: boolean; anchored: boolean };
  reasons: string[];
  status: string;
  toProcess: boolean;
  availableLevels: Array<"exterior" | "interior">;
}

export interface AnalyzeResult {
  localVersion: string | null;
  publishedVersion: string | null;
  counts: { toProcess: number; total: number };
  ships: Ship[];
}

export interface Prereqs { node: boolean; starbreaker: boolean; p4k: boolean; git: boolean; gh: boolean }

export interface Api {
  analyze(): Promise<AnalyzeResult>;
  prereqs(): Promise<Prereqs>;
  getThumbnail(name: string): Promise<string | null>;
}
```

- [ ] **Step 2: Créer `app/src/main/libs.ts`**

```ts
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function loadLib<T = unknown>(repoRoot: string, rel: string): Promise<T> {
  const url = pathToFileURL(join(repoRoot, "scripts", "lib", rel)).href;
  return (await import(/* @vite-ignore */ url)) as T;
}
```

- [ ] **Step 3: Écrire le test des services (échoue)**

`app/src/main/services.test.ts` (teste `getThumbnail` → data URL et `prereqs` via un faux repoRoot minimal ; `analyze` est couvert par le test e2e manuel Task 4) :

```ts
import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServices } from "./services";

// Recopie minimale des libs Plan 1 nécessaires, pour un repoRoot de test autonome.
function fakeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "svc-"));
  const lib = join(root, "scripts", "lib");
  mkdirSync(lib, { recursive: true });
  writeFileSync(join(root, "scripts", "analyze.mjs"), "");
  writeFileSync(join(lib, "config.mjs"), `export function loadConfig(){ throw new Error("app-config.json introuvable"); }`);
  writeFileSync(join(lib, "prereqs.mjs"), `export function checkPrereqs({which}){ return {node:true,starbreaker:false,p4k:false,git:which("git"),gh:which("gh")}; } export function defaultWhich(){ return false; }`);
  writeFileSync(join(lib, "thumbnails.mjs"), `import {writeFileSync,mkdirSync,existsSync} from "node:fs"; import {join} from "node:path"; export async function getThumbnail({name,cacheDir}){ if(!existsSync(cacheDir)) mkdirSync(cacheDir,{recursive:true}); const p=join(cacheDir, name.replace(/\\W+/g,"_")+".jpg"); writeFileSync(p, Buffer.from([1,2,3])); return {path:p, source:"wiki"}; }`);
  return root;
}

test("getThumbnail renvoie une data URL depuis le fichier caché", async () => {
  const root = fakeRepo();
  const svc = createServices(root);
  const url = await svc.getThumbnail("Carrack");
  expect(url).toMatch(/^data:image\/jpeg;base64,/);
  rmSync(root, { recursive: true, force: true });
});

test("prereqs dégrade proprement si loadConfig lève (app-config absent)", async () => {
  const root = fakeRepo();
  const svc = createServices(root);
  const p = await svc.prereqs();
  expect(p.node).toBe(true);
  expect(p.starbreaker).toBe(false);
  expect(p.p4k).toBe(false);
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 4: Lancer le test pour vérifier l'échec**

Run (depuis `app/`): `npx vitest run src/main/services.test.ts`
Expected: FAIL (`./services` introuvable).

- [ ] **Step 5: Écrire `app/src/main/services.ts`**

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runJson } from "./runner";
import { loadLib } from "./libs";
import type { AnalyzeResult, Prereqs } from "../shared/types";

type ConfigLib = { loadConfig(opts: { root: string }): { paths: { starbreaker: string; p4k: string } } };
type PrereqLib = {
  checkPrereqs(a: { paths?: { starbreaker?: string; p4k?: string }; which?: (c: string) => boolean }): Prereqs;
  defaultWhich(cmd: string): boolean;
};
type ThumbLib = { getThumbnail(a: { name: string; cacheDir: string }): Promise<{ path: string | null }> };

export function createServices(repoRoot: string) {
  return {
    async analyze(): Promise<AnalyzeResult> {
      return (await runJson("scripts/analyze.mjs", ["--json"], { cwd: repoRoot })) as AnalyzeResult;
    },

    async prereqs(): Promise<Prereqs> {
      const prereq = await loadLib<PrereqLib>(repoRoot, "prereqs.mjs");
      let paths: { starbreaker?: string; p4k?: string } = {};
      try {
        const cfg = await loadLib<ConfigLib>(repoRoot, "config.mjs");
        paths = cfg.loadConfig({ root: repoRoot }).paths;
      } catch {
        paths = {};
      }
      return prereq.checkPrereqs({ paths, which: prereq.defaultWhich });
    },

    async getThumbnail(name: string): Promise<string | null> {
      try {
        const thumbs = await loadLib<ThumbLib>(repoRoot, "thumbnails.mjs");
        const { path } = await thumbs.getThumbnail({ name, cacheDir: join(repoRoot, ".cache", "thumbs") });
        if (!path) return null;
        const buf = await readFile(path);
        return `data:image/jpeg;base64,${buf.toString("base64")}`;
      } catch {
        return null;
      }
    },
  };
}
```

- [ ] **Step 6: Écrire `app/src/main/ipc.ts`**

```ts
import { ipcMain } from "electron";
import { createServices } from "./services";

export function registerIpc(repoRoot: string): void {
  const svc = createServices(repoRoot);
  ipcMain.handle("analyze", () => svc.analyze());
  ipcMain.handle("prereqs", () => svc.prereqs());
  ipcMain.handle("thumbnail", (_e, name: string) => svc.getThumbnail(name));
}
```

- [ ] **Step 7: Câbler l'IPC dans `app/src/main/index.ts`**

Ajouter l'import et l'appel dans `app.whenReady()` AVANT `createWindow()` :

```ts
import { findRepoRoot } from "./repo";
import { registerIpc } from "./ipc";
```

et dans le `.then(() => { … })` :

```ts
  registerIpc(findRepoRoot(__dirname));
  createWindow();
```

- [ ] **Step 8: Exposer `window.api` dans `app/src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from "electron";
import type { Api } from "../shared/types";

const api: Api = {
  analyze: () => ipcRenderer.invoke("analyze"),
  prereqs: () => ipcRenderer.invoke("prereqs"),
  getThumbnail: (name) => ipcRenderer.invoke("thumbnail", name),
};

contextBridge.exposeInMainWorld("api", api);
```

- [ ] **Step 9: Lancer le test pour vérifier le succès**

Run (depuis `app/`): `npx vitest run src/main/services.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 10: Commit**

```bash
git add app/src/shared/types.ts app/src/main/libs.ts app/src/main/services.ts app/src/main/services.test.ts app/src/main/ipc.ts app/src/main/index.ts app/src/preload/index.ts
git commit -m "feat(app): types partagés + services main (analyze/prereqs/thumbnails) + pont IPC preload"
```

---

### Task 4: Renderer — en-tête versions/statut + barre de prérequis (données réelles)

**Files:**
- Create: `app/src/renderer/api.ts`, `app/src/renderer/components/Header.tsx`, `app/src/renderer/components/PrereqBar.tsx`
- Modify: `app/src/renderer/App.tsx` (état + montage), `app/src/renderer/styles.css`

**Interfaces:**
- Consumes: `window.api` (Task 3), types partagés.
- Produces: `api.ts` re-exporte un `window.api` typé. `Header` affiche version locale/publiée + un badge de statut (`À jour` / `Nouvelle version` / `Configuration incomplète`). `PrereqBar` affiche les 5 prérequis avec ✓/✗. `App` charge `analyze()` + `prereqs()` au montage et gère chargement/erreur.

- [ ] **Step 1: Créer `app/src/renderer/api.ts`**

```ts
import type { Api } from "../shared/types";

declare global {
  interface Window { api: Api }
}

export const api: Api = window.api;
```

- [ ] **Step 2: Créer `app/src/renderer/components/Header.tsx`**

```tsx
import type { AnalyzeResult, Prereqs } from "../../shared/types";

function status(a: AnalyzeResult, p: Prereqs): { label: string; tone: string } {
  if (!p.starbreaker || !p.p4k) return { label: "Configuration incomplète", tone: "warn" };
  if (a.counts.toProcess > 0) return { label: `Nouvelle version — ${a.counts.toProcess} à traiter`, tone: "warn" };
  return { label: "À jour", tone: "ok" };
}

export function Header({ data, prereqs }: { data: AnalyzeResult; prereqs: Prereqs }) {
  const s = status(data, prereqs);
  return (
    <header className="header">
      <div className="stat"><span className="lbl">Jeu (local)</span><b>{data.localVersion ?? "—"}</b></div>
      <div className="stat"><span className="lbl">Publié</span><b>{data.publishedVersion ?? "—"}</b></div>
      <div className={`badge ${s.tone}`}>{s.label}</div>
    </header>
  );
}
```

- [ ] **Step 3: Créer `app/src/renderer/components/PrereqBar.tsx`**

```tsx
import type { Prereqs } from "../../shared/types";

const LABELS: Array<[keyof Prereqs, string]> = [
  ["node", "Node"], ["starbreaker", "StarBreaker"], ["p4k", "Data.p4k"], ["git", "Git"], ["gh", "GitHub (gh)"],
];

export function PrereqBar({ prereqs }: { prereqs: Prereqs }) {
  return (
    <div className="prereqs">
      <span className="lbl">Prérequis :</span>
      {LABELS.map(([k, label]) => (
        <span key={k} className={prereqs[k] ? "ok" : "ko"}>{prereqs[k] ? "✓" : "✗"} {label}</span>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Réécrire `app/src/renderer/App.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api } from "./api";
import { Header } from "./components/Header";
import { PrereqBar } from "./components/PrereqBar";
import type { AnalyzeResult, Prereqs } from "../shared/types";

export function App() {
  const [data, setData] = useState<AnalyzeResult | null>(null);
  const [prereqs, setPrereqs] = useState<Prereqs | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.analyze(), api.prereqs()])
      .then(([a, p]) => { setData(a); setPrereqs(p); })
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  if (error) return <div className="app"><p className="err">Erreur : {error}</p></div>;
  if (!data || !prereqs) return <div className="app"><p>Analyse en cours…</p></div>;

  return (
    <div className="app">
      <Header data={data} prereqs={prereqs} />
      <PrereqBar prereqs={prereqs} />
      <p className="muted">{data.ships.length} vaisseaux au catalogue — galerie en Task 5.</p>
    </div>
  );
}
```

- [ ] **Step 5: Compléter `app/src/renderer/styles.css`**

```css
.header { display: flex; gap: 24px; align-items: center; margin-bottom: 12px; }
.stat { display: flex; flex-direction: column; }
.stat .lbl { font-size: 12px; color: #9a978d; }
.stat b { font-size: 20px; font-weight: 500; }
.badge { margin-left: auto; padding: 6px 12px; border-radius: 8px; font-size: 13px; }
.badge.ok { background: #16351f; color: #97c459; }
.badge.warn { background: #3a2f14; color: #efb027; }
.prereqs { display: flex; gap: 16px; font-size: 12px; padding: 8px 0; border-top: 1px solid #26251f; border-bottom: 1px solid #26251f; }
.prereqs .lbl { color: #9a978d; }
.prereqs .ok { color: #97c459; } .prereqs .ko { color: #e24b4a; }
.muted { color: #9a978d; } .err { color: #e24b4a; }
```

- [ ] **Step 6: Vérification manuelle**

Run (depuis `app/`): `npm run dev`
Expected: la fenêtre affiche la version publiée réelle (`sc-4.1`) lue depuis `index.json`, la version locale (ou `—` si `Data.p4k`/manifest illisible), un badge de statut, et la barre de prérequis avec ✓/✗ réels (Node ✓, Git ✓, gh ✓ ; StarBreaker/Data.p4k selon `app-config.json`). Aucune erreur rouge. (Si `app-config.json` absent, le badge « Configuration incomplète » est attendu.)

- [ ] **Step 7: Commit**

```bash
git add app/src/renderer
git commit -m "feat(app/ui): en-tête versions/statut + barre de prérequis (données réelles)"
```

---

### Task 5: Renderer — galerie (recherche, filtre, carte vaisseau, vignette, choix ext/int, sélection)

**Files:**
- Create: `app/src/renderer/components/Toolbar.tsx`, `app/src/renderer/components/ShipCard.tsx`, `app/src/renderer/components/Gallery.tsx`, `app/src/renderer/selection.ts`
- Modify: `app/src/renderer/App.tsx` (intégrer la galerie + état de sélection), `app/src/renderer/styles.css`

**Interfaces:**
- Consumes: `api.getThumbnail`, types partagés.
- Produces:
  - `selection.ts` : type `Selection = Map<string, { exterior: boolean; interior: boolean }>` + helpers `toggleLevel(sel, key, level)` et `selectionCount(sel)` (nb de vaisseaux ayant au moins un axe sélectionné).
  - `Toolbar` : champ de recherche, onglets `À traiter | Tout le catalogue`, bouton `Analyser` (rappelle `onAnalyze`).
  - `ShipCard` : vignette (lazy via `api.getThumbnail`, repli silhouette), nom, fabricant + longueur, badge de raison, 2 puces `Extérieur`/`Intérieur` cliquables (l'axe intérieur non ancré est marqué visuellement).
  - `Gallery` : grille filtrée/cherchée de `ShipCard`.
- La sélection vit dans `App`. Le pied de page affiche `Extraire la sélection (N)` (désactivé pour l'instant — l'extraction est en Plan 2b).

- [ ] **Step 1: Créer `app/src/renderer/selection.ts`**

```ts
export type Selection = Map<string, { exterior: boolean; interior: boolean }>;

export function toggleLevel(sel: Selection, key: string, level: "exterior" | "interior"): Selection {
  const next = new Map(sel);
  const cur = next.get(key) ?? { exterior: false, interior: false };
  next.set(key, { ...cur, [level]: !cur[level] });
  return next;
}

export function selectionCount(sel: Selection): number {
  let n = 0;
  for (const v of sel.values()) if (v.exterior || v.interior) n++;
  return n;
}
```

- [ ] **Step 2: (Test) verrouiller la logique de sélection**

`app/src/renderer/selection.test.ts` :

```ts
import { test, expect } from "vitest";
import { toggleLevel, selectionCount, type Selection } from "./selection";

test("toggleLevel bascule un axe et est immuable", () => {
  const a: Selection = new Map();
  const b = toggleLevel(a, "SHIP", "exterior");
  expect(a.size).toBe(0);
  expect(b.get("SHIP")).toEqual({ exterior: true, interior: false });
  const c = toggleLevel(b, "SHIP", "exterior");
  expect(c.get("SHIP")).toEqual({ exterior: false, interior: false });
});

test("selectionCount compte les vaisseaux avec ≥1 axe", () => {
  let s: Selection = new Map();
  s = toggleLevel(s, "A", "exterior");
  s = toggleLevel(s, "B", "interior");
  s = toggleLevel(s, "C", "exterior");
  s = toggleLevel(s, "C", "exterior"); // C repasse à 0
  expect(selectionCount(s)).toBe(2);
});
```

Run (depuis `app/`): `npx vitest run src/renderer/selection.test.ts` → PASS (2 tests).

- [ ] **Step 3: Créer `app/src/renderer/components/ShipCard.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api } from "../api";
import type { Ship } from "../../shared/types";

const REASON_TONE: Record<string, string> = {
  "nouveau": "accent", "version modifiée": "warn", "intérieur manquant": "muted", "à jour": "ok",
};

export function ShipCard({
  ship, sel, onToggle,
}: {
  ship: Ship;
  sel: { exterior: boolean; interior: boolean } | undefined;
  onToggle: (key: string, level: "exterior" | "interior") => void;
}) {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.getThumbnail(ship.name).then((u) => { if (alive) setThumb(u); });
    return () => { alive = false; };
  }, [ship.name]);

  const ext = sel?.exterior ?? false;
  const int = sel?.interior ?? false;

  return (
    <div className="card">
      <div className="thumb">
        {thumb ? <img src={thumb} alt={ship.name} /> : <div className="silhouette">▣</div>}
        <span className={`reason ${REASON_TONE[ship.status] ?? "muted"}`}>{ship.status}</span>
      </div>
      <div className="body">
        <p className="name">{ship.name}</p>
        <p className="meta">{ship.manufacturer} · {ship.dims.l}m</p>
        <div className="levels">
          <button className={ext ? "chip on" : "chip"} onClick={() => onToggle(ship.key, "exterior")}>Extérieur</button>
          <button
            className={int ? "chip on" : "chip"}
            title={ship.interior.anchored ? "" : "Intérieur non conventionnel — correction manuelle possible"}
            onClick={() => onToggle(ship.key, "interior")}
          >
            Intérieur{ship.interior.anchored ? "" : " *"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Créer `app/src/renderer/components/Toolbar.tsx`**

```tsx
export type Filter = "toProcess" | "all";

export function Toolbar({
  query, onQuery, filter, onFilter, onAnalyze,
}: {
  query: string; onQuery: (v: string) => void;
  filter: Filter; onFilter: (f: Filter) => void;
  onAnalyze: () => void;
}) {
  return (
    <div className="toolbar">
      <input className="search" placeholder="Rechercher un vaisseau…" value={query} onChange={(e) => onQuery(e.target.value)} />
      <div className="tabs">
        <button className={filter === "toProcess" ? "on" : ""} onClick={() => onFilter("toProcess")}>À traiter</button>
        <button className={filter === "all" ? "on" : ""} onClick={() => onFilter("all")}>Tout le catalogue</button>
      </div>
      <button className="analyze" onClick={onAnalyze}>Analyser</button>
    </div>
  );
}
```

- [ ] **Step 5: Créer `app/src/renderer/components/Gallery.tsx`**

```tsx
import type { Ship } from "../../shared/types";
import type { Selection } from "../selection";
import type { Filter } from "./Toolbar";
import { ShipCard } from "./ShipCard";

export function Gallery({
  ships, query, filter, sel, onToggle,
}: {
  ships: Ship[]; query: string; filter: Filter; sel: Selection;
  onToggle: (key: string, level: "exterior" | "interior") => void;
}) {
  const q = query.trim().toLowerCase();
  const list = ships.filter((s) => {
    if (filter === "toProcess" && !s.toProcess) return false;
    if (q && !`${s.name} ${s.manufacturer}`.toLowerCase().includes(q)) return false;
    return true;
  });
  return (
    <div className="gallery">
      {list.map((s) => <ShipCard key={s.key} ship={s} sel={sel.get(s.key)} onToggle={onToggle} />)}
      {list.length === 0 && <p className="muted">Aucun vaisseau ne correspond.</p>}
    </div>
  );
}
```

- [ ] **Step 6: Intégrer galerie + sélection dans `app/src/renderer/App.tsx`**

Remplacer le corps rendu (après les gardes chargement/erreur) par :

```tsx
  return (
    <AppBody data={data} prereqs={prereqs} reload={reload} />
  );
}

import { Toolbar, type Filter } from "./components/Toolbar";
import { Gallery } from "./components/Gallery";
import { toggleLevel, selectionCount, type Selection } from "./selection";

function AppBody({ data, prereqs, reload }: { data: AnalyzeResult; prereqs: Prereqs; reload: () => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("toProcess");
  const [sel, setSel] = useState<Selection>(new Map());
  const onToggle = (key: string, level: "exterior" | "interior") => setSel((s) => toggleLevel(s, key, level));
  const count = selectionCount(sel);

  return (
    <div className="app">
      <Header data={data} prereqs={prereqs} />
      <PrereqBar prereqs={prereqs} />
      <Toolbar query={query} onQuery={setQuery} filter={filter} onFilter={setFilter} onAnalyze={reload} />
      <Gallery ships={data.ships} query={query} filter={filter} sel={sel} onToggle={onToggle} />
      <footer className="footer">
        <button className="primary" disabled title="Extraction en Plan 2b">Extraire la sélection ({count})</button>
      </footer>
    </div>
  );
}
```

Et pour permettre le bouton « Analyser » de recharger, ajouter un `reload` dans le composant `App` : extraire le chargement dans une fonction et l'exposer :

```tsx
  const load = () => {
    setData(null); setPrereqs(null); setError(null);
    Promise.all([api.analyze(), api.prereqs()])
      .then(([a, p]) => { setData(a); setPrereqs(p); })
      .catch((e) => setError(String(e?.message ?? e)));
  };
  useEffect(() => { load(); }, []);
```

puis passer `reload={load}` à `<AppBody />`.

- [ ] **Step 7: Compléter le CSS galerie dans `app/src/renderer/styles.css`**

```css
.toolbar { display: flex; gap: 10px; align-items: center; margin: 14px 0; }
.search { flex: 1; height: 34px; padding: 0 10px; background: #16150f; border: 1px solid #34322a; border-radius: 8px; color: inherit; }
.tabs button, .analyze { height: 32px; padding: 0 12px; background: #16150f; border: 1px solid #34322a; border-radius: 8px; color: #cfccc2; cursor: pointer; }
.tabs button.on { background: #26251f; color: #fff; }
.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.card { border: 1px solid #26251f; border-radius: 12px; overflow: hidden; background: #131209; }
.thumb { position: relative; height: 96px; background: #201f18; display: flex; align-items: center; justify-content: center; }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.silhouette { font-size: 32px; color: #5f5e57; }
.reason { position: absolute; top: 6px; right: 6px; font-size: 10px; padding: 1px 6px; border-radius: 6px; background: #0b0b0b; }
.reason.accent { color: #85b7eb; } .reason.warn { color: #efb027; } .reason.ok { color: #97c459; } .reason.muted { color: #9a978d; }
.body { padding: 8px 10px; }
.name { margin: 0; font-size: 13px; font-weight: 500; }
.meta { margin: 2px 0 8px; font-size: 11px; color: #9a978d; }
.levels { display: flex; gap: 6px; }
.chip { flex: 1; font-size: 11px; padding: 4px 0; border-radius: 6px; border: 1px solid #34322a; background: transparent; color: #cfccc2; cursor: pointer; }
.chip.on { background: #12314e; border-color: #185fa5; color: #85b7eb; }
.footer { position: sticky; bottom: 0; padding: 12px 0; margin-top: 12px; }
.primary { padding: 8px 14px; border-radius: 8px; border: 1px solid #185fa5; background: transparent; color: #85b7eb; }
.primary:disabled { opacity: 0.5; cursor: not-allowed; }
```

- [ ] **Step 8: Vérification manuelle**

Run (depuis `app/`): `npm run dev`
Expected: la galerie affiche des cartes de vaisseaux (filtre « À traiter » par défaut). Basculer sur « Tout le catalogue » montre les 273 (avec `interior *` sur les non ancrés). La recherche filtre par nom/fabricant. Cliquer les puces `Extérieur`/`Intérieur` les active (bleu) et le compteur du pied de page monte. Les vignettes se chargent progressivement (silhouette en repli si le wiki ne répond pas). Prendre une capture d'écran de la galerie.

- [ ] **Step 9: Commit**

```bash
git add app/src/renderer
git commit -m "feat(app/ui): galerie (recherche, filtre, carte, vignette, choix ext/int, sélection)"
```

---

### Task 6: Config de packaging Windows (electron-builder) + build smoke

**Files:**
- Modify: `app/package.json` (bloc `build` electron-builder)
- Create: `app/electron-builder.yml`

**Interfaces:**
- Consumes: la sortie de `electron-vite build` (`app/out`).
- Produces: une config electron-builder ciblant Windows (NSIS), et un `npm run build` qui passe. La production réelle d'un `.exe` signé et l'empaquetage des `scripts/` + données du dépôt comme ressources sont notés comme chantier Plan 2b (l'app packagée devra embarquer/pointer le pipeline).

> Note : en l'état, l'app packagée ne fonctionnera pleinement qu'une fois le pipeline (scripts + `ships.meta.json`/`index.json`) rendu accessible depuis l'exécutable — c'est un point explicite du Plan 2b. Cette tâche pose la config et vérifie que le build compile.

- [ ] **Step 1: Créer `app/electron-builder.yml`**

```yaml
appId: com.asset3d.desktop
productName: asset-3D
directories:
  output: dist
win:
  target: nsis
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

- [ ] **Step 2: Vérifier que le build compile (smoke)**

Run (depuis `app/`): `npm run build`
Expected: `electron-vite build` termine sans erreur TypeScript et produit `app/out/{main,preload,renderer}`.

- [ ] **Step 3: Lancer toute la suite de tests de l'app**

Run (depuis `app/`): `npm test`
Expected: PASS (repo + runner + services + selection).

- [ ] **Step 4: Commit**

```bash
git add app/package.json app/electron-builder.yml
git commit -m "chore(app): config packaging Windows electron-builder + build smoke"
```

---

## Vérification finale (Plan 2a)

- [ ] `cd app && npm test` : suite verte (repo, runner, services, selection).
- [ ] `cd app && npm run dev` : l'app s'ouvre, affiche versions + prérequis réels + galerie des 273 vaisseaux, recherche/filtre/sélection fonctionnels, vignettes chargées (ou silhouette en repli).
- [ ] `cd app && npm run build` : build sans erreur.
- [ ] Les scripts du Plan 1 (racine) sont inchangés (`git diff --stat` ne montre aucune modification sous `scripts/`).
