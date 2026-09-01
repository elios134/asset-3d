# Plan 2b — flux màj + détection enrichie + galerie — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire évoluer l'app Electron (Plan 2a) vers un flux « vérifier → mettre à jour les données → n'afficher que ce qu'il y a à (ré)extraire », avec pré-cochage des modifiés, 3 filtres, tri alphabétique, masquage des variantes Alliance, et bouton d'extraction flottant.

**Architecture:** Additif sur l'app 2a. Le main process gagne un service `updateData()` (spawn `gen-meta`) et un service `visitable` (lecture read-only de `scfleet.db`, `crewMax>=2`) qui enrichit chaque `Ship` d'un booléen `visitable`. Le renderer passe à une machine à états (accueil → galerie gated), une galerie à 3 filtres + tri + pré-cochage, et une barre d'action flottante. Les scripts du Plan 1 ne sont **pas** modifiés.

**Tech Stack:** Electron, electron-vite, TypeScript, React 18, Vitest, `node:sqlite`. Node 22.

**Spec:** `docs/superpowers/specs/2026-09-01-plan-2b-flux-maj-galerie-design.md`
**Dépend de:** Plan 2a (branche `feature/desktop-app-2a`) et Plan 1 (`scripts/analyze.mjs`, `scripts/gen-meta.mjs`).

## Global Constraints

- Tout le code app sous `app/` ; TypeScript strict ; React 18. NE PAS modifier les scripts du Plan 1 (racine `scripts/`).
- Le renderer touche le système uniquement via `window.api` (contextIsolation:true, nodeIntegration:false, sandbox:false — inchangés).
- Réutilisation Plan 1 : `analyze` = spawn `node scripts/analyze.mjs --json` (cwd = racine) ; `updateData` = spawn `node scripts/gen-meta.mjs` (cwd = racine), succès = exit 0 puis relecture de `ships.meta.json`. Pas de `gen-meta --json`.
- `scfleet.db` accédé en **lecture seule** (`node:sqlite`). Chemin par défaut : `C:/Users/andre/AppData/Roaming/com.andre.sc-fleet-manager-v2/scfleet.db`, surchargeable par `scfleetDb` dans `app-config.json`. DB absente ⇒ ensemble visitable vide (jamais bloquant).
- « visitable » = `ShipData.crewMax >= 2`. « modifié » = `status === "version modifiée"` (déjà calculé par analyze). « new » = `!exterior.published`.
- Exclusion galerie = wikelo/pyam/Best In Show/BIS (sur le **nom**) **+** variantes Alliance (sur le suffixe de clé `_BTALA`). Le Basher reste affiché.
- Pré-cochage : modifié + `exterior.published` ⇒ extérieur coché ; modifié + `visitable` ⇒ intérieur coché ; nouveaux ⇒ décochés.
- Filtres : « À traiter » (new + modifié + intérieur manquant) · « Extraits » (`exterior.published`) · « Tout ». Exclusion appliquée en amont (niveau données), cohérente avec compteurs et onglets.
- Vitest depuis `app/`. Vérif UI par `npm run build` (compile) + checkpoint visuel utilisateur.

---

### Task 1: Main — ensemble « visitable » depuis scfleet.db + enrichissement de `analyze`

**Files:**
- Create: `app/src/main/visitable.ts`, `app/src/main/appconfig.ts`
- Modify: `app/src/shared/types.ts` (ajoute `visitable` à `Ship`), `app/src/main/services.ts` (enrichit `analyze()`)
- Test: `app/src/main/visitable.test.ts`

**Interfaces:**
- Consumes: `node:sqlite`.
- Produces:
  - `resolveScfleetDb(repoRoot: string): string` (dans `appconfig.ts`) — lit `<repoRoot>/app-config.json` `scfleetDb` si présent, sinon la constante par défaut.
  - `loadVisitableSet(dbPath: string): Set<string>` (dans `visitable.ts`) — requête `SELECT classNameCig FROM ShipData WHERE crewMax >= 2` ; renvoie un `Set` des clés ; **ne lève jamais** (DB absente/illisible ⇒ `Set` vide).
  - `Ship` gagne `visitable: boolean`.
  - `services.analyze()` renvoie des `Ship` dont `visitable` est renseigné via `loadVisitableSet(resolveScfleetDb(repoRoot))`.

- [ ] **Step 1: Ajouter `visitable` au type `Ship`**

Dans `app/src/shared/types.ts`, dans l'interface `Ship`, ajouter après `interior` :

```ts
  visitable: boolean;
```

- [ ] **Step 2: Écrire le test qui échoue**

`app/src/main/visitable.test.ts` :

```ts
import { test, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadVisitableSet } from "./visitable";

function fakeDb(rows: Array<[string, number]>): string {
  const dir = mkdtempSync(join(tmpdir(), "scf-"));
  const path = join(dir, "scfleet.db");
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE ShipData (classNameCig TEXT, crewMax INTEGER)");
  const ins = db.prepare("INSERT INTO ShipData (classNameCig, crewMax) VALUES (?, ?)");
  for (const [k, c] of rows) ins.run(k, c);
  db.close();
  return path;
}

test("loadVisitableSet ne garde que crewMax >= 2", () => {
  const path = fakeDb([["AEGS_Carrack", 4], ["AEGS_Gladius", 1], ["MISC_Freelancer", 2]]);
  const set = loadVisitableSet(path);
  expect(set.has("AEGS_Carrack")).toBe(true);
  expect(set.has("MISC_Freelancer")).toBe(true);
  expect(set.has("AEGS_Gladius")).toBe(false);
  rmSync(join(path, ".."), { recursive: true, force: true });
});

test("loadVisitableSet renvoie un Set vide si la DB est absente (jamais throw)", () => {
  const set = loadVisitableSet("Z:/nope/scfleet.db");
  expect(set.size).toBe(0);
});
```

- [ ] **Step 3: Lancer le test pour vérifier l'échec**

Run (depuis `app/`): `npx vitest run src/main/visitable.test.ts`
Expected: FAIL (`./visitable` introuvable).

- [ ] **Step 4: Écrire `app/src/main/visitable.ts`**

```ts
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

export function loadVisitableSet(dbPath: string): Set<string> {
  const set = new Set<string>();
  try {
    if (!existsSync(dbPath)) return set;
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare(
      "SELECT DISTINCT classNameCig FROM ShipData WHERE crewMax >= 2 AND classNameCig IS NOT NULL AND classNameCig <> ''",
    ).all() as Array<{ classNameCig: string }>;
    db.close();
    for (const r of rows) set.add(r.classNameCig);
  } catch {
    return set;
  }
  return set;
}
```

- [ ] **Step 5: Écrire `app/src/main/appconfig.ts`**

```ts
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_SCFLEET_DB = "C:/Users/andre/AppData/Roaming/com.andre.sc-fleet-manager-v2/scfleet.db";

export function resolveScfleetDb(repoRoot: string): string {
  try {
    const p = join(repoRoot, "app-config.json");
    if (existsSync(p)) {
      const cfg = JSON.parse(readFileSync(p, "utf8")) as { scfleetDb?: string };
      if (cfg.scfleetDb) return cfg.scfleetDb;
    }
  } catch {
    /* défaut ci-dessous */
  }
  return DEFAULT_SCFLEET_DB;
}
```

- [ ] **Step 6: Enrichir `services.analyze()`**

Dans `app/src/main/services.ts`, importer en tête :

```ts
import { loadVisitableSet } from "./visitable";
import { resolveScfleetDb } from "./appconfig";
```

et remplacer le corps de `analyze()` par :

```ts
    async analyze(): Promise<AnalyzeResult> {
      const result = (await runJson("scripts/analyze.mjs", ["--json"], { cwd: repoRoot })) as AnalyzeResult;
      const visitable = loadVisitableSet(resolveScfleetDb(repoRoot));
      result.ships = result.ships.map((s) => ({ ...s, visitable: visitable.has(s.key) }));
      return result;
    },
```

- [ ] **Step 7: Lancer le test pour vérifier le succès**

Run (depuis `app/`): `npx vitest run src/main/visitable.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Vérifier la compilation**

Run (depuis `app/`): `npm run build`
Expected: succès, aucune erreur TypeScript (le champ `visitable` est bien ajouté partout où `Ship` est construit — ici uniquement dans `analyze()`).

- [ ] **Step 9: Commit**

```bash
git add app/src/main/visitable.ts app/src/main/appconfig.ts app/src/main/visitable.test.ts app/src/shared/types.ts app/src/main/services.ts
git commit -m "feat(app/main): ensemble visitable (scfleet.db crewMax>=2) + enrichit analyze"
```

---

### Task 2: Main — service `updateData()` (spawn gen-meta) + IPC + preload

**Files:**
- Create: `app/src/main/update.ts`
- Modify: `app/src/main/services.ts` (expose `updateData`), `app/src/main/ipc.ts` (canal `updateData`), `app/src/preload/index.ts` (expose `updateData`), `app/src/shared/types.ts` (`Api.updateData`)
- Test: `app/src/main/update.test.ts`

**Interfaces:**
- Consumes: `runJson`-style spawn ; `ships.meta.json`.
- Produces: `runUpdate(repoRoot: string): Promise<{ ok: boolean; count: number }>` (dans `update.ts`) — spawn `node scripts/gen-meta.mjs` (cwd=repoRoot) ; à l'exit 0, relit `<repoRoot>/ships.meta.json` et compte les clés (hors `_comment`) → `{ ok:true, count }` ; sur exit non-zéro, rejette avec le stderr. `services.updateData()` appelle `runUpdate(repoRoot)`. `Api.updateData(): Promise<{ok:boolean; count:number}>`.

- [ ] **Step 1: Écrire le test qui échoue**

`app/src/main/update.test.ts` (fabrique un faux repo avec un `scripts/gen-meta.mjs` factice) :

```ts
import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runUpdate } from "./update";

function fakeRepo(genMetaBody: string): string {
  const root = mkdtempSync(join(tmpdir(), "upd-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts", "gen-meta.mjs"), genMetaBody);
  return root;
}

test("runUpdate : gen-meta OK → { ok, count } depuis ships.meta.json", async () => {
  const root = fakeRepo(
    `import { writeFileSync } from "node:fs";
     import { join, dirname } from "node:path";
     import { fileURLToPath } from "node:url";
     const r = join(dirname(fileURLToPath(import.meta.url)), "..");
     writeFileSync(join(r, "ships.meta.json"), JSON.stringify({ _comment: "x", A: {}, B: {}, C: {} }));`,
  );
  const res = await runUpdate(root);
  expect(res.ok).toBe(true);
  expect(res.count).toBe(3);
  rmSync(root, { recursive: true, force: true });
});

test("runUpdate : gen-meta échoue → rejette avec le stderr", async () => {
  const root = fakeRepo(`process.stderr.write("db introuvable"); process.exit(1);`);
  await expect(runUpdate(root)).rejects.toThrow(/db introuvable/);
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run (depuis `app/`): `npx vitest run src/main/update.test.ts`
Expected: FAIL (`./update` introuvable).

- [ ] **Step 3: Écrire `app/src/main/update.ts`**

```ts
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function runUpdate(repoRoot: string): Promise<{ ok: boolean; count: number }> {
  return new Promise((resolve, reject) => {
    execFile("node", ["scripts/gen-meta.mjs"], { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 }, (err, _out, stderr) => {
      if (err) {
        reject(new Error(`Échec de gen-meta : ${stderr?.toString().trim() || err.message}`));
        return;
      }
      try {
        const meta = JSON.parse(readFileSync(join(repoRoot, "ships.meta.json"), "utf8")) as Record<string, unknown>;
        const count = Object.keys(meta).filter((k) => k !== "_comment").length;
        resolve({ ok: true, count });
      } catch (e) {
        reject(new Error(`gen-meta terminé mais ships.meta.json illisible : ${(e as Error).message}`));
      }
    });
  });
}
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run (depuis `app/`): `npx vitest run src/main/update.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Exposer `updateData` (services + IPC + preload + type)**

`app/src/shared/types.ts` — dans `Api`, ajouter :

```ts
  updateData(): Promise<{ ok: boolean; count: number }>;
```

`app/src/main/services.ts` — ajouter l'import `import { runUpdate } from "./update";` et, dans l'objet retourné par `createServices`, une méthode :

```ts
    updateData(): Promise<{ ok: boolean; count: number }> {
      return runUpdate(repoRoot);
    },
```

`app/src/main/ipc.ts` — ajouter :

```ts
  ipcMain.handle("updateData", () => svc.updateData());
```

`app/src/preload/index.ts` — dans l'objet `api`, ajouter :

```ts
  updateData: () => ipcRenderer.invoke("updateData"),
```

- [ ] **Step 6: Vérifier compilation + suite**

Run (depuis `app/`): `npm test` puis `npm run build`
Expected: tous les tests verts, build sans erreur.

- [ ] **Step 7: Commit**

```bash
git add app/src/main/update.ts app/src/main/update.test.ts app/src/main/services.ts app/src/main/ipc.ts app/src/preload/index.ts app/src/shared/types.ts
git commit -m "feat(app): service updateData (spawn gen-meta) + IPC + preload"
```

---

### Task 3: Renderer — exclusion étendue aux variantes Alliance (_BTALA)

**Files:**
- Modify: `app/src/renderer/exclude.ts` (signature + règle `_BTALA`), `app/src/renderer/exclude.test.ts`, `app/src/renderer/App.tsx` (site d'appel)
- Test: `app/src/renderer/exclude.test.ts`

**Interfaces:**
- Consumes: `Ship`.
- Produces: `isExcluded(ship: { name: string; key: string }): boolean` — vrai si le **nom** matche wikelo/pyam/Best In Show/BIS **ou** si la **clé** matche `/_BTALA$/i`. Le Basher (`GLSN_Basher`) est faux.

- [ ] **Step 1: Réécrire le test (échoue avec l'ancienne signature)**

`app/src/renderer/exclude.test.ts` :

```ts
import { test, expect } from "vitest";
import { isExcluded } from "./exclude";

test("exclut wikelo / pyam / Best In Show / BIS (sur le nom)", () => {
  expect(isExcluded({ name: "Idris-P Wikelo War Special", key: "AEGS_Idris_P_Collector_Military" })).toBe(true);
  expect(isExcluded({ name: "Cutlass Black PYAM Exec", key: "DRAK_Cutlass_Black_Exec_Stealth" })).toBe(true);
  expect(isExcluded({ name: "Hammerhead 2949 Best In Show Edition", key: "AEGS_Hammerhead_Showdown" })).toBe(true);
  expect(isExcluded({ name: "600i 2951 BIS", key: "ORIG_600i_BIS2951" })).toBe(true);
});

test("exclut les variantes Alliance (suffixe clé _BTALA)", () => {
  expect(isExcluded({ name: "MOLE Alliance", key: "ARGO_MOLE_BTALA" })).toBe(true);
  expect(isExcluded({ name: "Golem Alliance", key: "DRAK_Golem_BTALA" })).toBe(true);
});

test("garde le Basher et les vaisseaux normaux", () => {
  expect(isExcluded({ name: "Basher", key: "GLSN_Basher" })).toBe(false);
  expect(isExcluded({ name: "Carrack", key: "ANVL_Carrack" })).toBe(false);
  expect(isExcluded({ name: "Cutlass Black", key: "DRAK_Cutlass_Black" })).toBe(false);
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run (depuis `app/`): `npx vitest run src/renderer/exclude.test.ts`
Expected: FAIL (`isExcluded` n'existe pas — l'ancien export est `isExcludedEdition(name)`).

- [ ] **Step 3: Réécrire `app/src/renderer/exclude.ts`**

```ts
// Éditions non exportables masquées de la galerie :
//  - peintures d'événement (wikelo / pyam / Best In Show, y c. l'abréviation BIS) — sur le nom ;
//  - variantes « Alliance » (suffixe interne CIG _BTALA) — sur la clé.
const EXCLUDED_NAME = /\bwikelo\b|\bpyam\b|best in show|\bbis\b/i;
const EXCLUDED_KEY = /_BTALA$/i;

export function isExcluded(ship: { name: string; key: string }): boolean {
  return EXCLUDED_NAME.test(ship.name) || EXCLUDED_KEY.test(ship.key);
}
```

- [ ] **Step 4: Mettre à jour le site d'appel dans `App.tsx`**

Dans `app/src/renderer/App.tsx`, remplacer l'import `import { isExcludedEdition } from "./exclude";` par `import { isExcluded } from "./exclude";`, et le filtre `a.ships.filter((s) => !isExcludedEdition(s.name))` par `a.ships.filter((s) => !isExcluded(s))`.

- [ ] **Step 5: Vérifier**

Run (depuis `app/`): `npx vitest run src/renderer/exclude.test.ts` puis `npm run build`
Expected: PASS (3 tests) ; build sans erreur (aucune référence restante à `isExcludedEdition`).

- [ ] **Step 6: Commit**

```bash
git add app/src/renderer/exclude.ts app/src/renderer/exclude.test.ts app/src/renderer/App.tsx
git commit -m "feat(app/ui): masque aussi les variantes Alliance (_BTALA), garde le Basher"
```

---

### Task 4: Renderer — machine à états (accueil → galerie gated) + « Mettre à jour les données »

**Files:**
- Create: `app/src/renderer/components/UpdateScreen.tsx`
- Modify: `app/src/renderer/App.tsx` (états `checking/needsUpdate/updating/ready/error`), `app/src/renderer/styles.css`
- Test: `app/src/renderer/gate.test.ts`

**Interfaces:**
- Consumes: `api.analyze`, `api.prereqs`, `api.updateData`, `compareVersion`-like logic.
- Produces:
  - `needsUpdate(published: string | null, local: string | null): boolean` (petite fonction pure dans `App.tsx` ou `gate.ts`) — vrai si `local` > `published` (versions `sc-x.y`). Réutilise une comparaison numérique major.minor.
  - Machine à états : `checking` (chargement initial) → si `needsUpdate` → `needsUpdate` (accueil avec bouton) ; sinon `ready` (galerie directe). Clic « Mettre à jour » → `updating` → `api.updateData()` puis `api.analyze()` → `ready`.

- [ ] **Step 1: Écrire le test de `needsUpdate` (échoue)**

`app/src/renderer/gate.test.ts` :

```ts
import { test, expect } from "vitest";
import { needsUpdate } from "./gate";

test("needsUpdate : locale > publiée ⇒ true", () => {
  expect(needsUpdate("sc-4.1", "sc-4.9")).toBe(true);
  expect(needsUpdate("sc-4.1", "sc-4.1")).toBe(false);
  expect(needsUpdate("sc-4.9", "sc-4.1")).toBe(false);
});

test("needsUpdate : version locale inconnue ⇒ false (rien à proposer)", () => {
  expect(needsUpdate("sc-4.1", null)).toBe(false);
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run (depuis `app/`): `npx vitest run src/renderer/gate.test.ts`
Expected: FAIL (`./gate` introuvable).

- [ ] **Step 3: Écrire `app/src/renderer/gate.ts`**

```ts
function parse(v: string | null): [number, number] | null {
  const m = /(\d+)\.(\d+)/.exec(v ?? "");
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export function needsUpdate(published: string | null, local: string | null): boolean {
  const p = parse(published), l = parse(local);
  if (!p || !l) return false;
  if (l[0] !== p[0]) return l[0] > p[0];
  return l[1] > p[1];
}
```

- [ ] **Step 4: Vérifier le succès**

Run (depuis `app/`): `npx vitest run src/renderer/gate.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Créer `app/src/renderer/components/UpdateScreen.tsx`**

```tsx
import type { AnalyzeResult, Prereqs } from "../../shared/types";

export function UpdateScreen({
  data, prereqs, updating, onUpdate,
}: {
  data: AnalyzeResult; prereqs: Prereqs; updating: boolean; onUpdate: () => void;
}) {
  return (
    <div className="app">
      <h1>asset-3D — hangar</h1>
      <div className="update-card">
        <div className="versions">
          <div><span className="lbl">Version publiée</span><b>{data.publishedVersion ?? "—"}</b></div>
          <div className="arrow">→</div>
          <div><span className="lbl">Version locale du jeu</span><b>{data.localVersion ?? "—"}</b></div>
        </div>
        <p className="muted">
          Les données du jeu sont plus récentes que le catalogue publié.
          Mettez à jour le catalogue avant d'afficher les vaisseaux à traiter.
        </p>
        <button className="primary" onClick={onUpdate} disabled={updating}>
          {updating ? "Mise à jour…" : "Mettre à jour les données"}
        </button>
        {(!prereqs.starbreaker || !prereqs.p4k) && (
          <p className="warn-note">Prérequis incomplets (StarBreaker / Data.p4k) — l'extraction ne sera pas possible.</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Refondre `app/src/renderer/App.tsx` en machine à états**

Réécrire `App` ainsi (conserver `Header`/`PrereqBar`/`AppBody`/imports existants ; ajouter `UpdateScreen`, `needsUpdate`, `isExcluded`). **Clé** : `fetchData()` rafraîchit les données SANS toucher à la phase ; seul l'effet initial décide du gating (sinon « Analyser » après mise à jour renverrait en boucle vers l'écran de mise à jour, car `gen-meta` ne change pas la version publiée) :

```tsx
import { useEffect, useState } from "react";
import { api } from "./api";
import { UpdateScreen } from "./components/UpdateScreen";
import { needsUpdate } from "./gate";
import { isExcluded } from "./exclude";
import type { AnalyzeResult, Prereqs } from "../shared/types";

type Phase = "checking" | "needsUpdate" | "updating" | "ready" | "error";

export function App() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [data, setData] = useState<AnalyzeResult | null>(null);
  const [prereqs, setPrereqs] = useState<Prereqs | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async (): Promise<AnalyzeResult> => {
    const [a, p] = await Promise.all([api.analyze(), api.prereqs()]);
    const ships = a.ships.filter((s) => !isExcluded(s));
    const filtered = { ...a, ships, counts: { total: ships.length, toProcess: ships.filter((s) => s.toProcess).length } };
    setData(filtered); setPrereqs(p);
    return filtered;
  };

  const fail = (e: unknown) => { setError(String((e as Error)?.message ?? e)); setPhase("error"); };

  useEffect(() => {
    fetchData()
      .then((d) => setPhase(needsUpdate(d.publishedVersion, d.localVersion) ? "needsUpdate" : "ready"))
      .catch(fail);
  }, []);

  const onUpdate = async (): Promise<void> => {
    setPhase("updating");
    try { await api.updateData(); await fetchData(); setPhase("ready"); } catch (e) { fail(e); }
  };

  if (phase === "error") return <div className="app"><p className="err">Erreur : {error}</p></div>;
  if (phase === "checking" || !data || !prereqs) return <div className="app"><p>Analyse en cours…</p></div>;
  if (phase === "needsUpdate" || phase === "updating")
    return <UpdateScreen data={data} prereqs={prereqs} updating={phase === "updating"} onUpdate={onUpdate} />;

  return <AppBody data={data} prereqs={prereqs} reload={() => { fetchData().catch(fail); }} />;
}
```

(`AppBody` reste défini plus bas dans le fichier ; Task 5 le réécrit. Le bouton « Analyser » (`reload`) rafraîchit les données et **reste** en galerie.)

- [ ] **Step 7: Ajouter le CSS de l'écran de mise à jour**

Dans `app/src/renderer/styles.css` :

```css
.update-card { max-width: 520px; margin: 40px auto; padding: 24px; background: #131209; border: 1px solid #26251f; border-radius: 12px; }
.versions { display: flex; align-items: center; gap: 18px; justify-content: center; margin-bottom: 12px; }
.versions .lbl { display: block; font-size: 12px; color: #9a978d; }
.versions b { font-size: 22px; font-weight: 500; }
.versions .arrow { color: #9a978d; font-size: 20px; }
.warn-note { color: #efb027; font-size: 12px; margin-top: 10px; }
```

- [ ] **Step 8: Vérifier compilation + suite**

Run (depuis `app/`): `npm test` puis `npm run build`
Expected: tests verts, build sans erreur.

- [ ] **Step 9: Commit**

```bash
git add app/src/renderer/gate.ts app/src/renderer/gate.test.ts app/src/renderer/components/UpdateScreen.tsx app/src/renderer/App.tsx app/src/renderer/styles.css
git commit -m "feat(app/ui): machine à états accueil→galerie + écran Mettre à jour les données"
```

---

### Task 5: Renderer — 3 filtres, tri alphabétique, badge visitable, pré-cochage

**Files:**
- Create: `app/src/renderer/preselect.ts`
- Modify: `app/src/renderer/components/Toolbar.tsx` (3 onglets + tri), `app/src/renderer/components/Gallery.tsx` (filtres + tri), `app/src/renderer/components/ShipCard.tsx` (badge visitable), `app/src/renderer/App.tsx` (AppBody : état filtre/tri + pré-sélection initiale)
- Test: `app/src/renderer/preselect.test.ts`

**Interfaces:**
- Consumes: `Ship`, `Selection`.
- Produces:
  - `initialSelection(ships: Ship[]): Selection` (dans `preselect.ts`) — pour chaque **modifié** (`status === "version modifiée"`) : `exterior=true` si `exterior.published`, `interior=true` si `visitable`. Les autres ne sont pas dans la map.
  - `Filter = "toProcess" | "extraits" | "all"`. Tri : booléen `alpha` (tri par `name` si vrai).

- [ ] **Step 1: Écrire le test de `initialSelection` (échoue)**

`app/src/renderer/preselect.test.ts` :

```ts
import { test, expect } from "vitest";
import { initialSelection } from "./preselect";
import type { Ship } from "../shared/types";

function ship(p: Partial<Ship> & { key: string; status: string }): Ship {
  return {
    key: p.key, name: p.key, manufacturer: "X", dims: { l: 1, b: 1, h: 1 },
    exterior: { published: p.exterior?.published ?? false, patchVersion: null },
    interior: { published: false, anchored: false },
    reasons: [], status: p.status, toProcess: p.status !== "à jour",
    availableLevels: ["exterior", "interior"], visitable: p.visitable ?? false,
  };
}

test("pré-coche extérieur d'un modifié publié, intérieur si visitable", () => {
  const ships = [
    ship({ key: "MOD_VIS", status: "version modifiée", exterior: { published: true, patchVersion: null }, visitable: true }),
    ship({ key: "MOD_NOVIS", status: "version modifiée", exterior: { published: true, patchVersion: null }, visitable: false }),
    ship({ key: "NEW", status: "nouveau", exterior: { published: false, patchVersion: null }, visitable: true }),
  ];
  const sel = initialSelection(ships);
  expect(sel.get("MOD_VIS")).toEqual({ exterior: true, interior: true });
  expect(sel.get("MOD_NOVIS")).toEqual({ exterior: true, interior: false });
  expect(sel.has("NEW")).toBe(false);
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run (depuis `app/`): `npx vitest run src/renderer/preselect.test.ts`
Expected: FAIL (`./preselect` introuvable).

- [ ] **Step 3: Écrire `app/src/renderer/preselect.ts`**

```ts
import type { Ship } from "../shared/types";
import type { Selection } from "./selection";

export function initialSelection(ships: Ship[]): Selection {
  const sel: Selection = new Map();
  for (const s of ships) {
    if (s.status !== "version modifiée") continue;
    const exterior = s.exterior.published;
    const interior = s.visitable;
    if (exterior || interior) sel.set(s.key, { exterior, interior });
  }
  return sel;
}
```

- [ ] **Step 4: Vérifier le succès**

Run (depuis `app/`): `npx vitest run src/renderer/preselect.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Réécrire `app/src/renderer/components/Toolbar.tsx` (3 onglets + tri)**

```tsx
export type Filter = "toProcess" | "extraits" | "all";

const TABS: Array<[Filter, string]> = [
  ["toProcess", "À traiter"], ["extraits", "Extraits"], ["all", "Tout le catalogue"],
];

export function Toolbar({
  query, onQuery, filter, onFilter, alpha, onAlpha, onAnalyze,
}: {
  query: string; onQuery: (v: string) => void;
  filter: Filter; onFilter: (f: Filter) => void;
  alpha: boolean; onAlpha: (v: boolean) => void;
  onAnalyze: () => void;
}) {
  return (
    <div className="toolbar">
      <input className="search" placeholder="Rechercher un vaisseau…" value={query} onChange={(e) => onQuery(e.target.value)} />
      <div className="tabs">
        {TABS.map(([f, label]) => (
          <button key={f} className={filter === f ? "on" : ""} onClick={() => onFilter(f)}>{label}</button>
        ))}
      </div>
      <label className="sort"><input type="checkbox" checked={alpha} onChange={(e) => onAlpha(e.target.checked)} /> A→Z</label>
      <button className="analyze" onClick={onAnalyze}>Analyser</button>
    </div>
  );
}
```

- [ ] **Step 6: Mettre à jour `app/src/renderer/components/Gallery.tsx` (filtres + tri)**

```tsx
import type { Ship } from "../../shared/types";
import type { Selection } from "../selection";
import type { Filter } from "./Toolbar";
import { ShipCard } from "./ShipCard";

export function Gallery({
  ships, query, filter, alpha, sel, onToggle,
}: {
  ships: Ship[]; query: string; filter: Filter; alpha: boolean; sel: Selection;
  onToggle: (key: string, level: "exterior" | "interior") => void;
}) {
  const q = query.trim().toLowerCase();
  let list = ships.filter((s) => {
    if (filter === "toProcess" && !s.toProcess) return false;
    if (filter === "extraits" && !s.exterior.published) return false;
    if (q && !`${s.name} ${s.manufacturer}`.toLowerCase().includes(q)) return false;
    return true;
  });
  if (alpha) list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="gallery">
      {list.map((s) => <ShipCard key={s.key} ship={s} sel={sel.get(s.key)} onToggle={onToggle} />)}
      {list.length === 0 && <p className="muted">Aucun vaisseau ne correspond.</p>}
    </div>
  );
}
```

- [ ] **Step 7: Badge visitable dans `app/src/renderer/components/ShipCard.tsx`**

Dans le bloc `.thumb`, à côté du badge `reason`, ajouter (quand `ship.visitable`) :

```tsx
        {ship.visitable && <span className="visitable" title="Intérieur visitable (crewMax ≥ 2)">visitable</span>}
```

(le placer juste après le `<span className={...reason...}>…</span>`.)

- [ ] **Step 8: Câbler filtre/tri/pré-sélection dans `AppBody` (`App.tsx`)**

Dans `AppBody`, remplacer l'état/le rendu par :

```tsx
import { Toolbar, type Filter } from "./components/Toolbar";
import { Gallery } from "./components/Gallery";
import { toggleLevel, selectionCount, type Selection } from "./selection";
import { initialSelection } from "./preselect";

function AppBody({ data, prereqs, reload }: { data: AnalyzeResult; prereqs: Prereqs; reload: () => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("toProcess");
  const [alpha, setAlpha] = useState(false);
  const [sel, setSel] = useState<Selection>(() => initialSelection(data.ships));
  const onToggle = (key: string, level: "exterior" | "interior") => setSel((s) => toggleLevel(s, key, level));
  const count = selectionCount(sel);

  return (
    <div className="app">
      <Header data={data} prereqs={prereqs} />
      <PrereqBar prereqs={prereqs} />
      <Toolbar query={query} onQuery={setQuery} filter={filter} onFilter={setFilter} alpha={alpha} onAlpha={setAlpha} onAnalyze={reload} />
      <Gallery ships={data.ships} query={query} filter={filter} alpha={alpha} sel={sel} onToggle={onToggle} />
      <footer className="footer">
        <button className="primary" disabled title="Extraction — plan ultérieur">Extraire la sélection ({count})</button>
      </footer>
    </div>
  );
}
```

(Garder les imports `Header`/`PrereqBar` en tête de fichier. `Header`/`PrereqBar` inchangés.)

- [ ] **Step 9: CSS badge visitable + toggle tri**

Dans `app/src/renderer/styles.css` :

```css
.visitable { position: absolute; top: 6px; left: 6px; font-size: 10px; padding: 1px 6px; border-radius: 6px; background: #0b0b0b; color: #5dcaa5; }
.sort { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: #cfccc2; }
```

- [ ] **Step 10: Vérifier compilation + suite**

Run (depuis `app/`): `npm test` puis `npm run build`
Expected: tests verts (dont `preselect`), build sans erreur.

- [ ] **Step 11: Commit**

```bash
git add app/src/renderer/preselect.ts app/src/renderer/preselect.test.ts app/src/renderer/components/Toolbar.tsx app/src/renderer/components/Gallery.tsx app/src/renderer/components/ShipCard.tsx app/src/renderer/App.tsx app/src/renderer/styles.css
git commit -m "feat(app/ui): 3 filtres + tri alpha + badge visitable + pré-cochage des modifiés"
```

---

### Task 6: Renderer — bouton « Extraire » flottant

**Files:**
- Modify: `app/src/renderer/App.tsx` (structure du footer), `app/src/renderer/styles.css`

**Interfaces:**
- Consumes: rien de nouveau.
- Produces: le pied de page « Extraire la sélection (N) » devient une **barre flottante** `position: fixed` en bas de la fenêtre, toujours visible, avec un espace en bas de la galerie pour ne rien masquer.

- [ ] **Step 1: Ajouter les classes flottantes au footer**

Dans `AppBody` (`App.tsx`), remplacer le `<footer className="footer">…</footer>` par :

```tsx
      <div className="floating-bar">
        <button className="primary" disabled title="Extraction — plan ultérieur">Extraire la sélection ({count})</button>
      </div>
```

- [ ] **Step 2: CSS de la barre flottante**

Dans `app/src/renderer/styles.css`, retirer/remplacer l'ancien `.footer` par :

```css
.floating-bar {
  position: fixed; left: 0; right: 0; bottom: 0;
  display: flex; justify-content: flex-end;
  padding: 12px 24px; background: rgba(11, 11, 11, 0.92);
  border-top: 1px solid #26251f; backdrop-filter: blur(4px); z-index: 10;
}
.app { padding-bottom: 72px; }
```

- [ ] **Step 3: Vérifier compilation**

Run (depuis `app/`): `npm run build`
Expected: build sans erreur.

- [ ] **Step 4: Vérification manuelle (checkpoint utilisateur)**

Run (depuis `app/`): `npm run dev`
Expected : l'app démarre sur l'écran **« Mettre à jour les données »** (jeu sc-4.9 > publié sc-4.1). Clic → gen-meta tourne → la **galerie** apparaît : onglet « À traiter » par défaut, les modifiés pré-cochés (extérieur + intérieur si visitable), badge « visitable », **aucun** vaisseau Alliance/wikelo/pyam/BIS, tri A→Z fonctionnel, onglet « Extraits », et le bouton **« Extraire la sélection (N) » flottant** reste visible en bas pendant le défilement.

- [ ] **Step 5: Commit**

```bash
git add app/src/renderer/App.tsx app/src/renderer/styles.css
git commit -m "feat(app/ui): bouton Extraire flottant toujours visible"
```

---

## Vérification finale (Plan 2b)

- [ ] `cd app && npm test` : suite verte (visitable, update, exclude, gate, preselect, + tests 2a).
- [ ] `cd app && npm run build` : build sans erreur.
- [ ] `cd app && npm run dev` : flux accueil → mise à jour → galerie 3 filtres + tri + pré-cochage + bouton flottant ; Alliance/éditions masquées ; Basher présent.
- [ ] `git diff --stat` ne montre **aucune** modification sous `scripts/` (Plan 1 intact).
