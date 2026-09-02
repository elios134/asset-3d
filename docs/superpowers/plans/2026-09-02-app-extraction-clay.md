# App desktop — flux d'extraction (pipeline clay) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Câbler le bouton « Extraire la sélection » : piloter `build-clay.mjs` (pipeline clay publié) par vaisseau, avec progression streaming NDJSON, panneau superposé, logs et annulation propre.

**Architecture:** On donne à `build-clay.mjs` un mode `--json` (NDJSON) + `--dry-run` (planifie sans lancer StarBreaker). Le main process gagne un runner streaming (`stream.ts`), un résolveur de recette par vaisseau (`recipe.ts`) et un service d'orchestration file (`extract.ts`) émettant des events IPC vers le renderer. Le renderer affiche un panneau superposé piloté par un réducteur pur.

**Tech Stack:** Electron, electron-vite, TypeScript strict, React 18, Vitest (tests app), `node:test` (test du script), `node:child_process` (spawn).

**Spec:** `docs/superpowers/specs/2026-09-02-app-extraction-clay-design.md`

**Dépend de:** Plans 1 / 2a / 2b (branche `feature/desktop-app-2a`, 20/20 tests verts).

## Global Constraints

- Tout le code app sous `app/` ; TypeScript strict ; React 18. Le seul script racine modifié est `scripts/build-clay.mjs` (ajout `--json`/`--dry-run`, aucune logique de build changée).
- Le renderer touche le système uniquement via `window.api` (contextIsolation:true, nodeIntegration:false — inchangés).
- **Orchestration PAR VAISSEAU** : `build-clay KEY` (sans `--ext-only`) construit ext **et** int en un seul run ; `build-clay KEY --ext-only` ne construit que l'extérieur. Donc un run = un vaisseau, pas un niveau.
- **Recette par vaisseau** : intérieur voulu + `dims.l >= 100` (capital) ⇒ **manuel** (jamais lancé auto) ; intérieur voulu + non-capital ⇒ `build-clay KEY --modules --json` ; extérieur seul ⇒ `build-clay KEY --ext-only --modules --json`.
- **Extérieur toujours `--modules`** (galerie proche du jeu, déjà publié ainsi).
- En mode `--json`, stdout = **NDJSON pur** (les logs humains sont silencés).
- Contrat d'events (aligné sur `batch-export`/`batch-interior`) : `{type:"progress",key,name,step:"start"|"done"|"skip"|"error",...}`, `{type:"result",ok,ko,skipped}`, plus `{type:"cancelled",doneCount}` émis par l'orchestrateur.
- Vitest depuis `app/`. Test du script depuis la racine (`node --test`). Vérif UI par `npm run build` + checkpoint visuel utilisateur.
- Commits fréquents. Fin de message de commit :
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

## File Structure

- `scripts/build-clay.mjs` (modifié) — mode `--json`/`--dry-run` + émission NDJSON.
- `scripts/build-clay.dryrun.test.mjs` (créé) — `node:test`, vérifie le contrat NDJSON sans StarBreaker.
- `app/src/shared/types.ts` (modifié) — `ExtractItem`, `ExtractEvent`, `ExtractSummary`, extension de `Api`.
- `app/src/main/recipe.ts` (créé) + `recipe.test.ts` — résolveur de recette pur.
- `app/src/main/stream.ts` (créé) + `stream.test.ts` — runner streaming NDJSON.
- `app/src/main/extract.ts` (créé) + `extract.test.ts` — orchestration file + annulation.
- `app/src/main/services.ts`, `ipc.ts`, `app/src/preload/index.ts` (modifiés) — expose `startExtract`/`cancelExtract`/`onExtractEvent`.
- `app/src/main/extract.service.test.ts` (créé) — verrou « une extraction à la fois ».
- `app/src/renderer/extractReducer.ts` (créé) + `extractReducer.test.ts` — état du panneau (pur).
- `app/src/renderer/components/ExtractPanel.tsx` (créé) — panneau superposé.
- `app/src/renderer/App.tsx`, `app/src/renderer/styles.css` (modifiés) — câblage bouton + panneau.

---

### Task 1: `build-clay.mjs` — mode `--json` / `--dry-run`

**Files:**
- Modify: `scripts/build-clay.mjs`
- Test: `scripts/build-clay.dryrun.test.mjs`

**Interfaces:**
- Consumes: `scripts/lib/emit.mjs` (`makeEmitter`).
- Produces (stdout NDJSON quand `--json`) : `{type:"progress",key,name,step:"start"}` en début de vaisseau ; `{type:"progress",key,name,step:"done",extTris?,intTris?,extBytes?,intBytes?}` en succès ; `{type:"progress",key,name,step:"skip",reason}` sur invariant `collision_walk` vide ; `{type:"progress",key,name,step:"error",err}` sur échec ; `{type:"result",ok,ko,skipped}` à la fin. `--dry-run` : `{type:"progress",...,step:"start"}` puis `{type:"plan",key,name,extOnly}` par vaisseau (aucun StarBreaker), puis `{type:"result",...}`.

- [ ] **Step 1: Écrire le test qui échoue**

`scripts/build-clay.dryrun.test.mjs` (modèle : `scripts/batch-export.dryrun.test.mjs`) :

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("build-clay --dry-run --json n'appelle pas StarBreaker et émet plan+result", () => {
  const out = execFileSync(
    "node",
    ["scripts/build-clay.mjs", "DRAK_Cutlass_Black", "--dry-run", "--json"],
    { cwd: ROOT, encoding: "utf8" },
  );
  const lines = out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(lines.every((e) => typeof e.type === "string"), "toutes les lignes sont du JSON typé");
  assert.ok(lines.some((e) => e.type === "progress" && e.step === "start" && e.key === "DRAK_Cutlass_Black"));
  assert.ok(lines.some((e) => e.type === "plan" && e.key === "DRAK_Cutlass_Black"));
  assert.ok(lines.some((e) => e.type === "result"));
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run (depuis la racine): `node --test scripts/build-clay.dryrun.test.mjs`
Expected: FAIL (le stdout n'est pas du NDJSON — build-clay écrit des logs humains et tente StarBreaker).

- [ ] **Step 3: Ajouter l'émetteur et les flags en tête de `build-clay.mjs`**

Après la ligne `import { makeEmitter } ...` — l'import n'existe pas encore, donc l'ajouter aux imports en tête (à côté des autres `import ... from "./lib/..."` si présents, sinon après le bloc d'imports node) :

```js
import { makeEmitter } from "./lib/emit.mjs";
```

Puis, juste après la ligne `const MODULES = process.argv.includes("--modules");` (fin du bloc des flags) :

```js
const JSON_MODE = process.argv.includes("--json");
const DRY_RUN = process.argv.includes("--dry-run");
const emit = makeEmitter(JSON_MODE);
if (JSON_MODE) console.log = () => {}; // stdout = NDJSON pur : on silence les logs humains (les enfants sont déjà stdio:"ignore")
```

- [ ] **Step 4: Émettre `start` + brancher le dry-run en tête de boucle**

Dans le corps de `for (const key of batch) {` (ligne ~133), **juste après la définition de `const intOut = ...` (ligne ~137) et AVANT le bloc `try`/l'export StarBreaker**, insérer :

```js
  emit({ type: "progress", key, name: meta[key]?.name ?? key, step: "start" });
  if (DRY_RUN) {
    emit({ type: "plan", key, name: meta[key]?.name ?? key, extOnly: EXT_ONLY });
    results.push({ key, ok: true, dry: true });
    continue;
  }
```

- [ ] **Step 5: Émettre `done` / `skip` / `error`**

1. Sur l'invariant (la ligne qui fait `results.push({ key, ok: false, skip: true, err: "collision_walk vide ..." })`), ajouter juste avant le `continue;` :

```js
    emit({ type: "progress", key, name: meta[key]?.name ?? key, step: "skip", reason: "collision_walk vide (intérieur non jouable)" });
```

2. **Deux** chemins de succès à couvrir (sinon l'ext-only reste bloqué sur ⏳) :

   a. Chemin **`--ext-only`** — après le `results.push({ key, ok: true, ext: ..., int: 0, extTris, extOnly: true });` (ligne ~158, juste avant son `continue;`), ajouter :

   ```js
       emit({ type: "progress", key, name: meta[key]?.name ?? key, step: "done", extTris, extBytes: statSync(extOut).size });
   ```

   b. Chemin **full (ext+int)** — après le `results.push({ key, ok: true, ext: ..., int: ..., extTris, intTris, ... });` (ligne ~337), ajouter :

   ```js
       emit({
         type: "progress", key, name: meta[key]?.name ?? key, step: "done",
         extTris, intTris, extBytes: statSync(extOut).size, intBytes: statSync(intOut).size,
       });
   ```

3. Dans le `catch (e) {` de la boucle, juste après `results.push({ key, ok: false, err: ... })`, ajouter :

```js
    emit({ type: "progress", key, name: meta[key]?.name ?? key, step: "error", err: e.message.split("\n")[0] });
```

- [ ] **Step 6: Émettre `result` en fin**

Après la fermeture de la boucle `for` (ligne ~345, avant/après le bloc de résumé `console.log(...)`), ajouter :

```js
emit({
  type: "result",
  ok: results.filter((r) => r.ok).length,
  ko: results.filter((r) => !r.ok && !r.skip).length,
  skipped: results.filter((r) => r.skip).length,
});
```

- [ ] **Step 7: Lancer le test pour vérifier le succès**

Run (depuis la racine): `node --test scripts/build-clay.dryrun.test.mjs`
Expected: PASS (le dry-run émet start+plan+result, aucun StarBreaker lancé).

- [ ] **Step 8: Commit**

```bash
git add scripts/build-clay.mjs scripts/build-clay.dryrun.test.mjs
git commit -m "$(printf 'feat(build-clay): mode --json/--dry-run (NDJSON pilotable par l app)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: `recipe.ts` — résolveur de recette par vaisseau (+ types)

**Files:**
- Create: `app/src/main/recipe.ts`, `app/src/main/recipe.test.ts`
- Modify: `app/src/shared/types.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `ExtractItem { key: string; name: string; lengthM: number; wantExterior: boolean; wantInterior: boolean }` (dans `shared/types.ts`).
  - `Recipe = { script: string; args: string[] } | { manual: true; reason: string }`.
  - `resolveRecipe(item: ExtractItem): Recipe`.

- [ ] **Step 1: Ajouter `ExtractItem` dans `shared/types.ts`**

À la fin de `app/src/shared/types.ts`, avant/après les interfaces existantes :

```ts
export interface ExtractItem {
  key: string;
  name: string;
  lengthM: number;
  wantExterior: boolean;
  wantInterior: boolean;
}
```

- [ ] **Step 2: Écrire le test qui échoue**

`app/src/main/recipe.test.ts` :

```ts
import { test, expect } from "vitest";
import { resolveRecipe } from "./recipe";
import type { ExtractItem } from "../shared/types";

const item = (p: Partial<ExtractItem> & { key: string }): ExtractItem => ({
  key: p.key, name: p.name ?? p.key, lengthM: p.lengthM ?? 30,
  wantExterior: p.wantExterior ?? false, wantInterior: p.wantInterior ?? false,
});

test("extérieur seul ⇒ build-clay --ext-only --modules --json", () => {
  const r = resolveRecipe(item({ key: "DRAK_Cutlass_Black", wantExterior: true }));
  expect(r).toEqual({ script: "scripts/build-clay.mjs", args: ["DRAK_Cutlass_Black", "--ext-only", "--modules", "--json"] });
});

test("intérieur régulier ⇒ build-clay --modules --json (ext+int)", () => {
  const r = resolveRecipe(item({ key: "MISC_Freelancer", wantInterior: true, lengthM: 38 }));
  expect(r).toEqual({ script: "scripts/build-clay.mjs", args: ["MISC_Freelancer", "--modules", "--json"] });
});

test("intérieur d'un capital (l>=100) ⇒ manuel", () => {
  const r = resolveRecipe(item({ key: "AEGS_Idris_P", wantInterior: true, lengthM: 240 }));
  expect(r).toEqual({ manual: true, reason: "capital (l≥100 m) — recette taillée à la main" });
});

test("extérieur seul d'un capital ⇒ auto (l'ext clay des capitaux n'est pas chunké)", () => {
  const r = resolveRecipe(item({ key: "AEGS_Idris_P", wantExterior: true, lengthM: 240 }));
  expect(r).toEqual({ script: "scripts/build-clay.mjs", args: ["AEGS_Idris_P", "--ext-only", "--modules", "--json"] });
});
```

- [ ] **Step 3: Lancer le test pour vérifier l'échec**

Run (depuis `app/`): `npx vitest run src/main/recipe.test.ts`
Expected: FAIL (`./recipe` introuvable).

- [ ] **Step 4: Écrire `app/src/main/recipe.ts`**

```ts
import type { ExtractItem } from "../shared/types";

export type Recipe = { script: string; args: string[] } | { manual: true; reason: string };

const SCRIPT = "scripts/build-clay.mjs";
const CAPITAL_M = 100; // seuil capital : recettes chunk/hull/navmesh taillées à la main, hors auto

export function resolveRecipe(item: ExtractItem): Recipe {
  if (item.wantInterior) {
    if (item.lengthM >= CAPITAL_M) {
      return { manual: true, reason: "capital (l≥100 m) — recette taillée à la main" };
    }
    return { script: SCRIPT, args: [item.key, "--modules", "--json"] };
  }
  return { script: SCRIPT, args: [item.key, "--ext-only", "--modules", "--json"] };
}
```

- [ ] **Step 5: Lancer le test pour vérifier le succès**

Run (depuis `app/`): `npx vitest run src/main/recipe.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add app/src/main/recipe.ts app/src/main/recipe.test.ts app/src/shared/types.ts
git commit -m "$(printf 'feat(app/main): resolveur de recette build-clay par vaisseau (capital=manuel)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: `stream.ts` — runner streaming NDJSON

**Files:**
- Create: `app/src/main/stream.ts`, `app/src/main/stream.test.ts`
- Modify: `app/src/shared/types.ts` (ajoute `ExtractEvent`)

**Interfaces:**
- Consumes: `node:child_process` (`spawn`), `node:readline`.
- Produces:
  - `ExtractEvent` (union, dans `shared/types.ts`).
  - `StreamHandle { done: Promise<ExtractEvent>; kill(): void }`.
  - `runStream(script: string, args: string[], opts: { cwd: string; onEvent: (e: ExtractEvent) => void }): StreamHandle` — spawn `node script args`, parse chaque ligne stdout en JSON (lignes non-JSON ignorées), appelle `onEvent`, résout `done` au `{type:"result"}` (ou synthétise un result à la sortie 0), rejette avec stderr si exit≠0 sans result.

- [ ] **Step 1: Ajouter `ExtractEvent` dans `shared/types.ts`**

```ts
export type ExtractEvent =
  | { type: "progress"; key: string; name?: string; step: "start" | "done" | "skip" | "error";
      extTris?: number; intTris?: number; extBytes?: number; intBytes?: number; reason?: string; err?: string }
  | { type: "plan"; key: string; name?: string; extOnly?: boolean }
  | { type: "result"; ok: number; ko: number; skipped: number }
  | { type: "cancelled"; doneCount: number };
```

- [ ] **Step 2: Écrire le test qui échoue**

`app/src/main/stream.test.ts` :

```ts
import { test, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStream } from "./stream";
import type { ExtractEvent } from "../shared/types";

function fakeScript(body: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "strm-"));
  const path = join(dir, "fake.mjs");
  writeFileSync(path, body);
  return { dir, path };
}

test("runStream transfère les events NDJSON et résout au result", async () => {
  const { dir, path } = fakeScript(
    `process.stdout.write(JSON.stringify({type:"progress",key:"A",step:"start"})+"\\n");
     process.stdout.write("ceci n'est pas du JSON\\n");
     process.stdout.write(JSON.stringify({type:"result",ok:1,ko:0,skipped:0})+"\\n");`,
  );
  const events: ExtractEvent[] = [];
  const { done } = runStream(path, [], { cwd: dir, onEvent: (e) => events.push(e) });
  const res = await done;
  expect(events.some((e) => e.type === "progress")).toBe(true);
  expect(res).toEqual({ type: "result", ok: 1, ko: 0, skipped: 0 });
  rmSync(dir, { recursive: true, force: true });
});

test("runStream rejette avec le stderr si exit≠0 sans result", async () => {
  const { dir, path } = fakeScript(`process.stderr.write("boom"); process.exit(1);`);
  const { done } = runStream(path, [], { cwd: dir, onEvent: () => {} });
  await expect(done).rejects.toThrow(/boom/);
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 3: Lancer le test pour vérifier l'échec**

Run (depuis `app/`): `npx vitest run src/main/stream.test.ts`
Expected: FAIL (`./stream` introuvable).

- [ ] **Step 4: Écrire `app/src/main/stream.ts`**

```ts
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { ExtractEvent } from "../shared/types";

export interface StreamHandle {
  done: Promise<ExtractEvent>;
  kill(): void;
}

export function runStream(
  script: string,
  args: string[],
  opts: { cwd: string; onEvent: (e: ExtractEvent) => void },
): StreamHandle {
  const child = spawn("node", [script, ...args], { cwd: opts.cwd });
  let result: ExtractEvent | null = null;
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d.toString(); });
  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    let evt: ExtractEvent;
    try { evt = JSON.parse(line) as ExtractEvent; } catch { return; }
    opts.onEvent(evt);
    if (evt.type === "result") result = evt;
  });
  const done = new Promise<ExtractEvent>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (result) resolve(result);
      else if (code === 0) resolve({ type: "result", ok: 0, ko: 0, skipped: 0 });
      else reject(new Error(stderr.trim() || `build-clay a quitté avec le code ${code}`));
    });
  });
  return { done, kill: () => child.kill() };
}
```

- [ ] **Step 5: Lancer le test pour vérifier le succès**

Run (depuis `app/`): `npx vitest run src/main/stream.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add app/src/main/stream.ts app/src/main/stream.test.ts app/src/shared/types.ts
git commit -m "$(printf 'feat(app/main): runner streaming NDJSON (spawn build-clay ligne a ligne)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: `extract.ts` — orchestration file + annulation

**Files:**
- Create: `app/src/main/extract.ts`, `app/src/main/extract.test.ts`
- Modify: `app/src/shared/types.ts` (ajoute `ExtractSummary`)

**Interfaces:**
- Consumes: `resolveRecipe` (Task 2), `runStream` (Task 3), `ExtractItem`/`ExtractEvent`.
- Produces:
  - `ExtractSummary { ok: number; ko: number; skipped: number; cancelled: boolean }` (dans `shared/types.ts`).
  - `runExtract(items, opts): Promise<ExtractSummary>` avec `opts: { cwd; onEvent; isCancelled; run? }` — `run` (défaut `runStream`) injectable pour les tests. Un process par vaisseau ; les events `start`/`done`/`skip`/`error` du script passent via `onEvent` ; les recettes `manual` émettent un `skip` sans spawn ; entre deux vaisseaux, si `isCancelled()` ⇒ arrêt (émet `cancelled`).

- [ ] **Step 1: Ajouter `ExtractSummary` dans `shared/types.ts`**

```ts
export interface ExtractSummary { ok: number; ko: number; skipped: number; cancelled: boolean }
```

- [ ] **Step 2: Écrire le test qui échoue**

`app/src/main/extract.test.ts` :

```ts
import { test, expect, vi } from "vitest";
import { runExtract } from "./extract";
import type { ExtractItem, ExtractEvent } from "../shared/types";

const item = (p: Partial<ExtractItem> & { key: string }): ExtractItem => ({
  key: p.key, name: p.name ?? p.key, lengthM: p.lengthM ?? 30,
  wantExterior: p.wantExterior ?? false, wantInterior: p.wantInterior ?? false,
});

// faux runStream : émet un result "1 ok" et résout, sans spawner
const fakeRun = (script: string, args: string[], o: { onEvent: (e: ExtractEvent) => void }) => {
  o.onEvent({ type: "progress", key: args[0], step: "start" });
  o.onEvent({ type: "progress", key: args[0], step: "done" });
  return { done: Promise.resolve<ExtractEvent>({ type: "result", ok: 1, ko: 0, skipped: 0 }), kill: () => {} };
};

test("traite chaque vaisseau, skippe les capitaux, agrège le summary", async () => {
  const items = [
    item({ key: "MISC_Freelancer", wantInterior: true, lengthM: 38 }),
    item({ key: "AEGS_Idris_P", wantInterior: true, lengthM: 240 }), // capital -> skip
  ];
  const events: ExtractEvent[] = [];
  const s = await runExtract(items, {
    cwd: "/x", onEvent: (e) => events.push(e), isCancelled: () => false, run: fakeRun,
  });
  expect(s).toEqual({ ok: 1, ko: 0, skipped: 1, cancelled: false });
  expect(events.some((e) => e.type === "progress" && e.step === "skip" && e.key === "AEGS_Idris_P")).toBe(true);
});

test("annulation après le vaisseau en cours : stoppe la file, émet cancelled", async () => {
  const items = [item({ key: "A", wantExterior: true }), item({ key: "B", wantExterior: true })];
  const events: ExtractEvent[] = [];
  let calls = 0;
  const s = await runExtract(items, {
    cwd: "/x", onEvent: (e) => events.push(e), isCancelled: () => calls > 0,
    run: (sc, ar, o) => { calls++; return fakeRun(sc, ar, o); },
  });
  expect(calls).toBe(1); // B jamais lancé
  expect(s.cancelled).toBe(true);
  expect(events.some((e) => e.type === "cancelled")).toBe(true);
});
```

- [ ] **Step 3: Lancer le test pour vérifier l'échec**

Run (depuis `app/`): `npx vitest run src/main/extract.test.ts`
Expected: FAIL (`./extract` introuvable).

- [ ] **Step 4: Écrire `app/src/main/extract.ts`**

```ts
import { resolveRecipe } from "./recipe";
import { runStream, type StreamHandle } from "./stream";
import type { ExtractItem, ExtractEvent, ExtractSummary } from "../shared/types";

type RunFn = (
  script: string,
  args: string[],
  opts: { cwd: string; onEvent: (e: ExtractEvent) => void },
) => StreamHandle;

export async function runExtract(
  items: ExtractItem[],
  opts: {
    cwd: string;
    onEvent: (e: ExtractEvent) => void;
    isCancelled: () => boolean;
    run?: RunFn;
  },
): Promise<ExtractSummary> {
  const run = opts.run ?? runStream;
  let ok = 0, ko = 0, skipped = 0, cancelled = false;

  for (const item of items) {
    if (opts.isCancelled()) {
      cancelled = true;
      opts.onEvent({ type: "cancelled", doneCount: ok + ko + skipped });
      break;
    }
    const recipe = resolveRecipe(item);
    if ("manual" in recipe) {
      skipped++;
      opts.onEvent({ type: "progress", key: item.key, name: item.name, step: "skip", reason: recipe.reason });
      continue;
    }
    try {
      const res = await run(recipe.script, recipe.args, { cwd: opts.cwd, onEvent: opts.onEvent }).done;
      if (res.type === "result") { ok += res.ok; ko += res.ko; skipped += res.skipped; }
    } catch (e) {
      ko++;
      opts.onEvent({ type: "progress", key: item.key, name: item.name, step: "error", err: (e as Error).message });
    }
  }
  return { ok, ko, skipped, cancelled };
}
```

- [ ] **Step 5: Lancer le test pour vérifier le succès**

Run (depuis `app/`): `npx vitest run src/main/extract.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add app/src/main/extract.ts app/src/main/extract.test.ts app/src/shared/types.ts
git commit -m "$(printf 'feat(app/main): orchestration file d extraction + annulation apres vaisseau courant\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 5: Câblage services + IPC + preload + `Api` (streaming main→renderer)

**Files:**
- Modify: `app/src/main/services.ts`, `app/src/main/ipc.ts`, `app/src/preload/index.ts`, `app/src/shared/types.ts`
- Test: `app/src/main/extract.service.test.ts`

**Interfaces:**
- Consumes: `runExtract` (Task 4), `ExtractItem`/`ExtractEvent`/`ExtractSummary`.
- Produces:
  - `services.startExtract(sender, items): Promise<ExtractSummary>` (verrou : une seule extraction à la fois) + `services.cancelExtract(): void`.
  - IPC `extract:start` / `extract:cancel` ; preload `startExtract` / `cancelExtract` / `onExtractEvent`.
  - `Api` gagne `startExtract(items): Promise<ExtractSummary>`, `cancelExtract(): Promise<void>`, `onExtractEvent(cb): () => void`.

- [ ] **Step 1: Étendre `Api` dans `shared/types.ts`**

Dans l'interface `Api`, ajouter (importe `ExtractItem`, `ExtractEvent`, `ExtractSummary` déjà définis dans le même fichier) :

```ts
  startExtract(items: ExtractItem[]): Promise<ExtractSummary>;
  cancelExtract(): Promise<void>;
  onExtractEvent(cb: (evt: ExtractEvent) => void): () => void;
```

- [ ] **Step 2: Écrire le test qui échoue (verrou)**

`app/src/main/extract.service.test.ts` :

```ts
import { test, expect } from "vitest";
import { createServices } from "./services";

// faux sender ipc
const sender = { send: () => {} };

test("startExtract refuse une seconde extraction concurrente", async () => {
  const svc = createServices(process.cwd());
  // items vides -> runExtract se termine tout de suite ; on teste le verrou en lançant 2 fois d'affilée
  // sans await sur la première : la seconde doit voir le verrou (ou les deux passent si trop rapides).
  // On force la concurrence avec un item bidon dont le spawn échouera vite mais garde le verrou le temps du run.
  const p1 = svc.startExtract(sender, [
    { key: "___NOPE___", name: "x", lengthM: 10, wantExterior: true, wantInterior: false },
  ]);
  await expect(
    svc.startExtract(sender, [{ key: "___NOPE2___", name: "y", lengthM: 10, wantExterior: true, wantInterior: false }]),
  ).rejects.toThrow(/déjà en cours/);
  await p1.catch(() => {}); // la 1re se termine (spawn échoue), on libère
});
```

- [ ] **Step 3: Lancer le test pour vérifier l'échec**

Run (depuis `app/`): `npx vitest run src/main/extract.service.test.ts`
Expected: FAIL (`startExtract` n'existe pas sur les services).

- [ ] **Step 4: Ajouter `startExtract`/`cancelExtract` dans `services.ts`**

En tête, ajouter les imports :

```ts
import { runExtract } from "./extract";
import type { AnalyzeResult, Prereqs, ExtractItem, ExtractSummary } from "../shared/types";
```

(remplacer la ligne d'import de types existante par celle-ci, qui ajoute `ExtractItem`/`ExtractSummary`.)

Dans `createServices`, avant le `return {`, ajouter l'état du verrou :

```ts
  let extractLock = false;
  let cancelFlag = false;
```

Dans l'objet retourné, ajouter deux méthodes :

```ts
    async startExtract(sender: { send(channel: string, evt: unknown): void }, items: ExtractItem[]): Promise<ExtractSummary> {
      if (extractLock) throw new Error("Une extraction est déjà en cours.");
      extractLock = true;
      cancelFlag = false;
      try {
        return await runExtract(items, {
          cwd: repoRoot,
          onEvent: (evt) => sender.send("extract:event", evt),
          isCancelled: () => cancelFlag,
        });
      } finally {
        extractLock = false;
      }
    },

    cancelExtract(): void {
      cancelFlag = true;
    },
```

- [ ] **Step 5: Lancer le test pour vérifier le succès**

Run (depuis `app/`): `npx vitest run src/main/extract.service.test.ts`
Expected: PASS.

- [ ] **Step 6: Brancher l'IPC et le preload**

`app/src/main/ipc.ts` — dans `registerIpc`, ajouter :

```ts
  ipcMain.handle("extract:start", (e, items) => svc.startExtract(e.sender, items));
  ipcMain.handle("extract:cancel", () => svc.cancelExtract());
```

`app/src/preload/index.ts` — dans l'objet `api`, ajouter :

```ts
  startExtract: (items) => ipcRenderer.invoke("extract:start", items),
  cancelExtract: () => ipcRenderer.invoke("extract:cancel"),
  onExtractEvent: (cb) => {
    const h = (_e: unknown, evt: unknown) => cb(evt as Parameters<typeof cb>[0]);
    ipcRenderer.on("extract:event", h);
    return () => { ipcRenderer.removeListener("extract:event", h); };
  },
```

- [ ] **Step 7: Vérifier compilation + suite complète**

Run (depuis `app/`): `npm test` puis `npm run build`
Expected: tous les tests verts, build sans erreur (les 3 nouvelles méthodes de `Api` sont implémentées dans le preload).

- [ ] **Step 8: Commit**

```bash
git add app/src/main/services.ts app/src/main/ipc.ts app/src/preload/index.ts app/src/shared/types.ts app/src/main/extract.service.test.ts
git commit -m "$(printf 'feat(app): IPC extraction streaming (startExtract/cancelExtract/onExtractEvent) + verrou\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 6: `extractReducer.ts` — état du panneau (pur)

**Files:**
- Create: `app/src/renderer/extractReducer.ts`, `app/src/renderer/extractReducer.test.ts`

**Interfaces:**
- Consumes: `ExtractItem`, `ExtractEvent`.
- Produces:
  - `RowStatus = "pending" | "running" | "done" | "skip" | "error"`.
  - `ExtractState { running: boolean; rows: Array<{ key; name; status: RowStatus; detail?: string }>; log: string[]; summary: ExtractSummary | null; cancelled: boolean }`.
  - `initExtractState(items: ExtractItem[]): ExtractState`.
  - `extractReducer(state: ExtractState, evt: ExtractEvent): ExtractState`.

- [ ] **Step 1: Écrire le test qui échoue**

`app/src/renderer/extractReducer.test.ts` :

```ts
import { test, expect } from "vitest";
import { initExtractState, extractReducer } from "./extractReducer";
import type { ExtractItem } from "../shared/types";

const items: ExtractItem[] = [
  { key: "A", name: "Alpha", lengthM: 30, wantExterior: true, wantInterior: false },
  { key: "B", name: "Bravo", lengthM: 240, wantExterior: false, wantInterior: true },
];

test("init : toutes les lignes en pending, running=true", () => {
  const s = initExtractState(items);
  expect(s.running).toBe(true);
  expect(s.rows.map((r) => r.status)).toEqual(["pending", "pending"]);
});

test("progress start→done marque la ligne, skip et error aussi", () => {
  let s = initExtractState(items);
  s = extractReducer(s, { type: "progress", key: "A", step: "start" });
  expect(s.rows.find((r) => r.key === "A")!.status).toBe("running");
  s = extractReducer(s, { type: "progress", key: "A", step: "done" });
  expect(s.rows.find((r) => r.key === "A")!.status).toBe("done");
  s = extractReducer(s, { type: "progress", key: "B", step: "skip", reason: "capital" });
  const b = s.rows.find((r) => r.key === "B")!;
  expect(b.status).toBe("skip");
  expect(b.detail).toBe("capital");
});

test("result fige le summary et running=false ; cancelled marque l'état", () => {
  let s = initExtractState(items);
  s = extractReducer(s, { type: "result", ok: 1, ko: 0, skipped: 1 });
  expect(s.running).toBe(false);
  expect(s.summary).toEqual({ ok: 1, ko: 0, skipped: 1, cancelled: false });
  s = extractReducer(initExtractState(items), { type: "cancelled", doneCount: 1 });
  expect(s.cancelled).toBe(true);
  expect(s.running).toBe(false);
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run (depuis `app/`): `npx vitest run src/renderer/extractReducer.test.ts`
Expected: FAIL (`./extractReducer` introuvable).

- [ ] **Step 3: Écrire `app/src/renderer/extractReducer.ts`**

```ts
import type { ExtractItem, ExtractEvent, ExtractSummary } from "../shared/types";

export type RowStatus = "pending" | "running" | "done" | "skip" | "error";
export interface ExtractRow { key: string; name: string; status: RowStatus; detail?: string }
export interface ExtractState {
  running: boolean;
  rows: ExtractRow[];
  log: string[];
  summary: ExtractSummary | null;
  cancelled: boolean;
}

export function initExtractState(items: ExtractItem[]): ExtractState {
  return {
    running: true,
    rows: items.map((i) => ({ key: i.key, name: i.name, status: "pending" })),
    log: [],
    summary: null,
    cancelled: false,
  };
}

function setRow(rows: ExtractRow[], key: string, patch: Partial<ExtractRow>): ExtractRow[] {
  return rows.map((r) => (r.key === key ? { ...r, ...patch } : r));
}

export function extractReducer(state: ExtractState, evt: ExtractEvent): ExtractState {
  switch (evt.type) {
    case "progress": {
      const status: RowStatus =
        evt.step === "start" ? "running" : evt.step === "done" ? "done" : evt.step === "skip" ? "skip" : "error";
      const detail = evt.reason ?? evt.err;
      const line =
        evt.step === "error" ? `✗ ${evt.name ?? evt.key} : ${evt.err ?? ""}` :
        evt.step === "skip" ? `⏭ ${evt.name ?? evt.key} : ${evt.reason ?? ""}` :
        evt.step === "done" ? `✓ ${evt.name ?? evt.key}` : `⏳ ${evt.name ?? evt.key}…`;
      return { ...state, rows: setRow(state.rows, evt.key, { status, detail }), log: [...state.log, line] };
    }
    case "result":
      return {
        ...state,
        running: false,
        summary: { ok: evt.ok, ko: evt.ko, skipped: evt.skipped, cancelled: state.cancelled },
        log: [...state.log, `— terminé : ${evt.ok} ok, ${evt.ko} échec(s), ${evt.skipped} ignoré(s)`],
      };
    case "cancelled":
      return { ...state, running: false, cancelled: true, log: [...state.log, `— annulé après ${evt.doneCount} vaisseau(x)`] };
    default:
      return state;
  }
}
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run (depuis `app/`): `npx vitest run src/renderer/extractReducer.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/renderer/extractReducer.ts app/src/renderer/extractReducer.test.ts
git commit -m "$(printf 'feat(app/ui): reducer d etat du panneau d extraction (pur, teste)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 7: Panneau superposé + câblage du bouton

**Files:**
- Create: `app/src/renderer/components/ExtractPanel.tsx`
- Modify: `app/src/renderer/App.tsx`, `app/src/renderer/styles.css`

**Interfaces:**
- Consumes: `api.startExtract`/`cancelExtract`/`onExtractEvent`, `initExtractState`/`extractReducer`, `Selection`, `Ship`.
- Produces: `ExtractPanel` (drawer) ; `AppBody` ouvre le panneau et lance `api.startExtract(items)` construits depuis la sélection.

- [ ] **Step 1: Créer `app/src/renderer/components/ExtractPanel.tsx`**

```tsx
import { useEffect, useReducer } from "react";
import { api } from "../api";
import { initExtractState, extractReducer } from "../extractReducer";
import type { ExtractItem } from "../../shared/types";

const ICON: Record<string, string> = { pending: "•", running: "⏳", done: "✓", skip: "⏭", error: "✗" };

export function ExtractPanel({ items, onClose }: { items: ExtractItem[]; onClose: () => void }) {
  const [state, dispatch] = useReducer(extractReducer, items, initExtractState);

  useEffect(() => {
    const off = api.onExtractEvent((evt) => dispatch(evt));
    api.startExtract(items).catch((e) => dispatch({ type: "progress", key: "?", step: "error", err: String(e?.message ?? e) }));
    return off;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="extract-panel">
      <div className="extract-head">
        <b>Extraction ({state.rows.length} vaisseau{state.rows.length > 1 ? "x" : ""})</b>
        <div className="spacer" />
        {state.running
          ? <button onClick={() => api.cancelExtract()}>Annuler</button>
          : <button onClick={onClose}>Fermer</button>}
      </div>
      <ul className="extract-rows">
        {state.rows.map((r) => (
          <li key={r.key} className={`row-${r.status}`}>
            <span className="ic">{ICON[r.status]}</span> {r.name}
            {r.detail && <span className="detail"> — {r.detail}</span>}
          </li>
        ))}
      </ul>
      <pre className="extract-log">{state.log.join("\n")}</pre>
      {state.summary && (
        <p className="extract-summary">
          {state.summary.ok} ok · {state.summary.ko} échec(s) · {state.summary.skipped} ignoré(s)
          {state.summary.cancelled ? " · annulé" : ""}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Câbler le bouton et le panneau dans `AppBody` (`App.tsx`)**

En tête de `App.tsx`, ajouter les imports :

```tsx
import { ExtractPanel } from "./components/ExtractPanel";
import type { ExtractItem } from "../shared/types";
```

Dans `AppBody`, ajouter l'état d'ouverture et la construction des items (juste après les états existants `query`/`filter`/`alpha`/`sel`) :

```tsx
  const [extracting, setExtracting] = useState(false);
  const canExtract = count > 0 && prereqs.starbreaker && prereqs.p4k;
  const buildItems = (): ExtractItem[] => {
    const out: ExtractItem[] = [];
    for (const s of data.ships) {
      const v = sel.get(s.key);
      if (!v || (!v.exterior && !v.interior)) continue;
      out.push({ key: s.key, name: s.name, lengthM: s.dims.l, wantExterior: v.exterior, wantInterior: v.interior });
    }
    return out;
  };
```

Remplacer la barre flottante actuelle (`<div className="floating-bar">…</div>`) par :

```tsx
      <div className="floating-bar">
        <button
          className="primary"
          disabled={!canExtract}
          title={canExtract ? "Lancer l'extraction clay" : "Sélection vide ou prérequis StarBreaker/Data.p4k manquants"}
          onClick={() => setExtracting(true)}
        >
          Extraire la sélection ({count})
        </button>
      </div>
      {extracting && <ExtractPanel items={buildItems()} onClose={() => setExtracting(false)} />}
```

- [ ] **Step 3: CSS du panneau**

Dans `app/src/renderer/styles.css`, ajouter :

```css
.extract-panel { position: fixed; right: 0; top: 0; bottom: 0; width: 460px; max-width: 90vw;
  background: #0e0d09; border-left: 1px solid #26251f; display: flex; flex-direction: column; z-index: 20; padding: 14px; }
.extract-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.extract-head .spacer { flex: 1; }
.extract-rows { list-style: none; margin: 0; padding: 0; overflow-y: auto; max-height: 40%; }
.extract-rows li { padding: 3px 0; font-size: 13px; }
.extract-rows .ic { display: inline-block; width: 18px; }
.row-done { color: #5dcaa5; } .row-error { color: #e06c6c; } .row-skip { color: #9a978d; } .row-running { color: #efb027; }
.extract-rows .detail { color: #9a978d; font-size: 11px; }
.extract-log { flex: 1; overflow-y: auto; background: #060504; border: 1px solid #1c1b16;
  font-size: 11px; padding: 8px; margin: 8px 0 0; white-space: pre-wrap; }
.extract-summary { font-size: 13px; color: #cfccc2; }
```

- [ ] **Step 4: Vérifier compilation + suite**

Run (depuis `app/`): `npm test` puis `npm run build`
Expected: tous les tests verts (recipe, stream, extract, extract.service, extractReducer + tests 2a/2b), build sans erreur.

- [ ] **Step 5: Vérification manuelle (checkpoint utilisateur)**

Run (depuis `app/`): `npm run dev`
Expected : galerie → sélection d'un petit vaisseau (ext ou int) → clic « Extraire » → panneau à droite : ligne ⏳→✓, log NDJSON lisible, résumé final. Un capital coché en intérieur apparaît ⏭ « capital — recette manuelle ». Le bouton reste désactivé si StarBreaker/Data.p4k manquent. (Test réel = un `.glb` clay écrit dans `models/` ; nécessite StarBreaker + Data.p4k configurés.)

- [ ] **Step 6: Commit**

```bash
git add app/src/renderer/components/ExtractPanel.tsx app/src/renderer/App.tsx app/src/renderer/styles.css
git commit -m "$(printf 'feat(app/ui): panneau d extraction superpose + cablage du bouton Extraire\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Vérification finale

- [ ] `node --test scripts/build-clay.dryrun.test.mjs` : vert (contrat NDJSON, sans StarBreaker).
- [ ] `cd app && npm test` : suite verte (recipe, stream, extract, extract.service, extractReducer + 2a/2b).
- [ ] `cd app && npm run build` : build sans erreur.
- [ ] `cd app && npm run dev` : bouton Extraire actif si sélection + prérequis ; panneau progression/log/annulation ; capitaux intérieur = ⏭ manuel.
- [ ] `git diff --stat` ne montre, sous `scripts/`, que `build-clay.mjs` + le nouveau test dry-run (aucun autre script du pipeline touché).

## Notes de portée (hors de ce plan, tranches suivantes)

- QA (`qa.mjs`) branchée + barrière de publication.
- Publication GitHub avec **patch chirurgical d'`index.json`** (jamais `build-index` en aveugle — cf. spec « garde-fou build-index »).
- Extraction des **capitaux** (recettes chunk/hull/navmesh par vaisseau) : mode avancé dédié.
- `release-patch.mjs` périmé (pilote encore le HD) : à réaligner sur le clay.
