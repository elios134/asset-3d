# Moteur pilotable (backend CLI) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre les scripts `.mjs` du pipeline pilotables par une application (chemins configurables, sortie JSON, `--dry-run`, commande d'analyse, service vignettes), sans coquille Electron — tout testable en `node --test`.

**Architecture:** On ajoute une couche `scripts/lib/*.mjs` de modules purs et testables (config, détection, comparaison de versions, vignettes, prérequis, lecture version jeu, émission NDJSON). Les scripts existants (`batch-export`, `batch-interior`) sont modifiés pour lire leurs chemins depuis la config et émettre du NDJSON en mode `--json`. Un nouveau `scripts/analyze.mjs` produit la liste des vaisseaux à traiter en JSON.

**Tech Stack:** Node.js 22 (runner de test intégré `node:test` + `node:assert`, aucune dépendance nouvelle), `@gltf-transform/*` + `meshoptimizer` (déjà présents), `fetch` global (Node 22).

**Spec:** `docs/superpowers/specs/2026-09-01-app-desktop-gestion-api-design.md`

## Global Constraints

- Node.js 22+ ; ESM (`"type": "module"`), extension `.mjs`.
- Aucune dépendance npm nouvelle. Tests via `node --test` uniquement.
- Chemins machine (`starbreaker`, `p4k`) JAMAIS codés en dur ni commités : lus depuis `app-config.json` (gitignoré).
- Le SC Wiki est cosmétique : une vignette absente ne doit jamais faire échouer un traitement.
- Sortie `--json` = **NDJSON** sur stdout (une ligne JSON par événement), rien d'autre sur stdout dans ce mode.
- Version de patch au format `sc-<major>.<minor>` (ex. `sc-4.2`). Comparaison numérique sur `<major>.<minor>`.
- Identité GitHub : `elios134/asset-3d` (dans `config.json`).

---

### Task 1: Fondations — test runner, gitignore, module de config

**Files:**
- Modify: `package.json` (ajouter le script `test`)
- Modify: `.gitignore` (ajouter `app-config.json`, `.cache/`)
- Create: `app-config.example.json`
- Create: `scripts/lib/config.mjs`
- Test: `scripts/lib/config.test.mjs`

**Interfaces:**
- Consumes: rien.
- Produces: `loadConfig({ root }) -> { githubOwner, githubRepo, patchVersion, levels, budget, paths: { starbreaker, p4k } }`. Lève une `Error` explicite si `app-config.json` est absent ou si une clé de chemin manque. `root` par défaut = racine du dépôt.

- [ ] **Step 1: Ajouter le script de test à `package.json`**

Dans `scripts`, ajouter :

```json
"test": "node --test"
```

- [ ] **Step 2: Étendre `.gitignore`**

Ajouter à la fin du fichier :

```
# Config machine locale et cache app (non commités)
app-config.json
.cache/
```

- [ ] **Step 3: Créer le gabarit `app-config.example.json`**

```json
{
  "paths": {
    "starbreaker": "C:/Users/andre/Documents/starbreaker/starbreaker.exe",
    "p4k": "D:/Program Files/RSI Launcher/StarCitizen/LIVE/Data.p4k"
  }
}
```

- [ ] **Step 4: Écrire le test qui échoue**

`scripts/lib/config.test.mjs` :

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.mjs";

function scratchRoot(appConfig) {
  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  writeFileSync(join(dir, "config.json"), JSON.stringify({
    githubOwner: "elios134", githubRepo: "asset-3d", patchVersion: "sc-4.1",
    levels: [], budget: {},
  }));
  if (appConfig) writeFileSync(join(dir, "app-config.json"), JSON.stringify(appConfig));
  return dir;
}

test("loadConfig fusionne config.json et app-config.json", () => {
  const root = scratchRoot({ paths: { starbreaker: "S.exe", p4k: "D.p4k" } });
  const cfg = loadConfig({ root });
  assert.equal(cfg.githubOwner, "elios134");
  assert.equal(cfg.paths.starbreaker, "S.exe");
  assert.equal(cfg.paths.p4k, "D.p4k");
  rmSync(root, { recursive: true, force: true });
});

test("loadConfig échoue clairement si app-config.json manque", () => {
  const root = scratchRoot(null);
  assert.throws(() => loadConfig({ root }), /app-config\.json/);
  rmSync(root, { recursive: true, force: true });
});

test("loadConfig échoue si un chemin manque", () => {
  const root = scratchRoot({ paths: { starbreaker: "S.exe" } });
  assert.throws(() => loadConfig({ root }), /p4k/);
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 5: Lancer le test pour vérifier l'échec**

Run: `node --test scripts/lib/config.test.mjs`
Expected: FAIL (`Cannot find module ./config.mjs`).

- [ ] **Step 6: Écrire l'implémentation minimale**

`scripts/lib/config.mjs` :

```javascript
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadConfig({ root = DEFAULT_ROOT } = {}) {
  const base = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
  const appPath = join(root, "app-config.json");
  if (!existsSync(appPath)) {
    throw new Error(`app-config.json introuvable dans ${root}. Copiez app-config.example.json et renseignez les chemins.`);
  }
  const app = JSON.parse(readFileSync(appPath, "utf8"));
  const paths = app.paths ?? {};
  for (const key of ["starbreaker", "p4k"]) {
    if (!paths[key]) throw new Error(`app-config.json : chemin "${key}" manquant.`);
  }
  return { ...base, paths: { starbreaker: paths.starbreaker, p4k: paths.p4k } };
}
```

- [ ] **Step 7: Lancer le test pour vérifier le succès**

Run: `node --test scripts/lib/config.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add package.json .gitignore app-config.example.json scripts/lib/config.mjs scripts/lib/config.test.mjs
git commit -m "feat(config): chargement config + app-config (chemins machine externalisés)"
```

---

### Task 2: Comparaison de versions + logique de détection (pure)

**Files:**
- Create: `scripts/lib/detect.mjs`
- Test: `scripts/lib/detect.test.mjs`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `compareVersion(a, b) -> -1 | 0 | 1` (compare `sc-x.y` ; `null`/illisible trié comme le plus petit).
  - `analyzeShips({ meta, index, localVersion, anchorKeys }) -> Ship[]` où
    `Ship = { key, name, manufacturer, dims, exterior: { published: boolean, patchVersion: string|null }, interior: { published: boolean, anchored: boolean }, reasons: string[], status: string, toProcess: boolean, availableLevels: ["exterior","interior"] }`.
    `meta` = objet `ships.meta.json` ; `index` = objet `index.json` ou `null` ; `localVersion` = string ou `null` ; `anchorKeys` = `Set<string>`.
    `reasons ⊂ { "nouveau", "version modifiée", "intérieur manquant" }`. `status` = `reasons[0]` sinon `"à jour"`.

- [ ] **Step 1: Écrire les tests qui échouent**

`scripts/lib/detect.test.mjs` :

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersion, analyzeShips } from "./detect.mjs";

test("compareVersion compare sur major.minor", () => {
  assert.equal(compareVersion("sc-4.2", "sc-4.1"), 1);
  assert.equal(compareVersion("sc-4.1", "sc-4.1"), 0);
  assert.equal(compareVersion("sc-4.0", "sc-4.1"), -1);
  assert.equal(compareVersion(null, "sc-4.1"), -1);
});

const meta = {
  _comment: "x",
  AAA_New: { name: "New One", manufacturer: "Acme", dims: { l: 20, b: 10, h: 5 } },
  BBB_Old: { name: "Old One", manufacturer: "Acme", dims: { l: 30, b: 12, h: 6 } },
  CCC_NoInt: { name: "No Interior", manufacturer: "Acme", dims: { l: 40, b: 14, h: 7 } },
  DDD_UpToDate: { name: "Fresh", manufacturer: "Acme", dims: { l: 50, b: 16, h: 8 } },
};

const index = {
  patchVersion: "sc-4.1",
  ships: [
    { key: "BBB_Old", patchVersion: "sc-4.0", variants: [{ level: "exterior" }, { level: "interior" }] },
    { key: "CCC_NoInt", patchVersion: "sc-4.2", variants: [{ level: "exterior" }] },
    { key: "DDD_UpToDate", patchVersion: "sc-4.2", variants: [{ level: "exterior" }, { level: "interior" }] },
  ],
};

test("un vaisseau absent du catalogue = nouveau", () => {
  const ships = analyzeShips({ meta, index, localVersion: "sc-4.2", anchorKeys: new Set() });
  const s = ships.find((x) => x.key === "AAA_New");
  assert.deepEqual(s.reasons, ["nouveau"]);
  assert.equal(s.toProcess, true);
  assert.equal(s.exterior.published, false);
});

test("publié sous une version antérieure = version modifiée", () => {
  const ships = analyzeShips({ meta, index, localVersion: "sc-4.2", anchorKeys: new Set() });
  const s = ships.find((x) => x.key === "BBB_Old");
  assert.ok(s.reasons.includes("version modifiée"));
});

test("extérieur publié sans intérieur = intérieur manquant", () => {
  const ships = analyzeShips({ meta, index, localVersion: "sc-4.2", anchorKeys: new Set() });
  const s = ships.find((x) => x.key === "CCC_NoInt");
  assert.ok(s.reasons.includes("intérieur manquant"));
  assert.equal(s.interior.published, false);
});

test("publié à jour et complet = à jour, non traité", () => {
  const ships = analyzeShips({ meta, index, localVersion: "sc-4.2", anchorKeys: new Set() });
  const s = ships.find((x) => x.key === "DDD_UpToDate");
  assert.deepEqual(s.reasons, []);
  assert.equal(s.status, "à jour");
  assert.equal(s.toProcess, false);
});

test("anchorKeys renseigne interior.anchored", () => {
  const ships = analyzeShips({ meta, index, localVersion: "sc-4.2", anchorKeys: new Set(["BBB_Old"]) });
  assert.equal(ships.find((x) => x.key === "BBB_Old").interior.anchored, true);
  assert.equal(ships.find((x) => x.key === "CCC_NoInt").interior.anchored, false);
});

test("_comment est ignoré", () => {
  const ships = analyzeShips({ meta, index, localVersion: "sc-4.2", anchorKeys: new Set() });
  assert.equal(ships.some((x) => x.key === "_comment"), false);
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `node --test scripts/lib/detect.test.mjs`
Expected: FAIL (`Cannot find module ./detect.mjs`).

- [ ] **Step 3: Écrire l'implémentation minimale**

`scripts/lib/detect.mjs` :

```javascript
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
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `node --test scripts/lib/detect.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/detect.mjs scripts/lib/detect.test.mjs
git commit -m "feat(detect): comparaison de versions + détection des vaisseaux à traiter"
```

---

### Task 3: Commande `analyze.mjs` (lit les fichiers, émet du JSON)

**Files:**
- Create: `scripts/analyze.mjs`
- Test: `scripts/analyze.test.mjs`

**Interfaces:**
- Consumes: `analyzeShips` (Task 2), `ships.meta.json`, `index.json` (optionnel), `interior-anchors.json` (optionnel).
- Produces: exécutable CLI. Sans `--json` : rapport texte lisible. Avec `--json` : un unique objet JSON `{ localVersion, publishedVersion, counts: { toProcess, total }, ships: Ship[] }` sur stdout. La version locale du jeu est passée par `--local-version <v>` (la lecture auto `Data.p4k` arrive en Task 8) ; absente ⇒ `null`.

- [ ] **Step 1: Écrire le test qui échoue**

`scripts/analyze.test.mjs` :

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = join(fileURLToPath(import.meta.url), "..");

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "analyze-"));
  writeFileSync(join(dir, "ships.meta.json"), JSON.stringify({
    _comment: "x",
    AAA_New: { name: "New", manufacturer: "Acme", dims: { l: 20, b: 10, h: 5 } },
    BBB_Old: { name: "Old", manufacturer: "Acme", dims: { l: 30, b: 12, h: 6 } },
  }));
  writeFileSync(join(dir, "index.json"), JSON.stringify({
    patchVersion: "sc-4.1",
    ships: [{ key: "BBB_Old", patchVersion: "sc-4.0", variants: [{ level: "exterior" }, { level: "interior" }] }],
  }));
  writeFileSync(join(dir, "interior-anchors.json"), JSON.stringify({ _comment: "x" }));
  cpSync(join(HERE, "analyze.mjs"), join(dir, "analyze.mjs"));
  cpSync(join(HERE, "lib"), join(dir, "lib"), { recursive: true });
  return dir;
}

test("analyze --json émet la liste et les compteurs", () => {
  const dir = scratch();
  const out = execFileSync("node", ["analyze.mjs", "--json", "--local-version", "sc-4.2"], { cwd: dir, encoding: "utf8" });
  const data = JSON.parse(out);
  assert.equal(data.localVersion, "sc-4.2");
  assert.equal(data.publishedVersion, "sc-4.1");
  assert.equal(data.counts.total, 2);
  assert.equal(data.counts.toProcess, 2);
  assert.equal(data.ships.find((s) => s.key === "AAA_New").status, "nouveau");
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `node --test scripts/analyze.test.mjs`
Expected: FAIL (`analyze.mjs` inexistant → `execFileSync` lève).

- [ ] **Step 3: Écrire l'implémentation minimale**

`scripts/analyze.mjs` :

```javascript
#!/usr/bin/env node
// analyze.mjs — compare version locale, catalogue publié et méta ; liste les vaisseaux à traiter.
// Usage : node scripts/analyze.mjs [--json] [--local-version sc-4.2]
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { analyzeShips } from "./lib/detect.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JSON_MODE = process.argv.includes("--json");
const lvIdx = process.argv.indexOf("--local-version");
const localVersion = lvIdx >= 0 ? process.argv[lvIdx + 1] : null;

const readJson = (p, fallback) => (existsSync(join(ROOT, p)) ? JSON.parse(readFileSync(join(ROOT, p), "utf8")) : fallback);
const meta = readJson("ships.meta.json", {});
const index = readJson("index.json", null);
const anchors = readJson("interior-anchors.json", {});
const anchorKeys = new Set(Object.keys(anchors).filter((k) => k !== "_comment"));

const ships = analyzeShips({ meta, index, localVersion, anchorKeys });
const toProcess = ships.filter((s) => s.toProcess);
const publishedVersion = index?.patchVersion ?? null;

if (JSON_MODE) {
  process.stdout.write(JSON.stringify({
    localVersion: localVersion ?? null, publishedVersion,
    counts: { toProcess: toProcess.length, total: ships.length }, ships,
  }));
} else {
  console.log(`Version locale : ${localVersion ?? "(inconnue)"} · publiée : ${publishedVersion ?? "(aucune)"}`);
  console.log(`${toProcess.length}/${ships.length} vaisseaux à traiter :`);
  for (const s of toProcess) console.log(`  - ${s.name.padEnd(28)} ${s.reasons.join(", ")}`);
}
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `node --test scripts/analyze.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/analyze.mjs scripts/analyze.test.mjs
git commit -m "feat(analyze): commande d'analyse des changements (JSON + texte)"
```

---

### Task 4: Service vignettes SC Wiki (matching + cache)

**Files:**
- Create: `scripts/lib/thumbnails.mjs`
- Test: `scripts/lib/thumbnails.test.mjs`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `baseName(name) -> string` : retire les suffixes d'édition connus pour le repli (`"Avenger Titan Renegade"` → `"Avenger Titan"`).
  - `pickImageUrl(vehicle) -> string|null` : extrait `images[0].thumbnail_url` d'une entrée de l'API, sinon `null`.
  - `async getThumbnail({ name, cacheDir, fetchImpl = fetch, apiBase }) -> { path: string|null, source: "cache"|"wiki"|"none" }` : renvoie le chemin de la vignette en cache (`<cacheDir>/<slug(name)>.jpg`), la télécharge si absente, et ne lève JAMAIS — en cas d'échec réseau renvoie `{ path: null, source: "none" }`.

- [ ] **Step 1: Écrire les tests qui échouent**

`scripts/lib/thumbnails.test.mjs` :

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseName, pickImageUrl, getThumbnail } from "./thumbnails.mjs";

test("baseName retire les suffixes d'édition", () => {
  assert.equal(baseName("Avenger Titan Renegade"), "Avenger Titan");
  assert.equal(baseName("Cutlass Black Best In Show"), "Cutlass Black");
  assert.equal(baseName("Carrack"), "Carrack");
});

test("pickImageUrl extrait la miniature ou null", () => {
  assert.equal(pickImageUrl({ images: [{ thumbnail_url: "http://x/y.jpg" }] }), "http://x/y.jpg");
  assert.equal(pickImageUrl({ images: [] }), null);
  assert.equal(pickImageUrl({}), null);
});

test("getThumbnail télécharge puis met en cache", async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "thumbs-"));
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    if (url.includes("/vehicles")) return { ok: true, json: async () => ({ data: [{ images: [{ thumbnail_url: "http://img/x.jpg" }] }] }) };
    return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  };
  const a = await getThumbnail({ name: "Carrack", cacheDir, fetchImpl, apiBase: "http://api" });
  assert.equal(a.source, "wiki");
  assert.ok(existsSync(a.path));
  const before = calls;
  const b = await getThumbnail({ name: "Carrack", cacheDir, fetchImpl, apiBase: "http://api" });
  assert.equal(b.source, "cache");
  assert.equal(calls, before); // pas de nouvel appel réseau
  rmSync(cacheDir, { recursive: true, force: true });
});

test("getThumbnail ne lève jamais en cas d'échec réseau", async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "thumbs-"));
  const fetchImpl = async () => { throw new Error("offline"); };
  const r = await getThumbnail({ name: "Carrack", cacheDir, fetchImpl, apiBase: "http://api" });
  assert.deepEqual(r, { path: null, source: "none" });
  rmSync(cacheDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `node --test scripts/lib/thumbnails.test.mjs`
Expected: FAIL (`Cannot find module ./thumbnails.mjs`).

- [ ] **Step 3: Écrire l'implémentation minimale**

`scripts/lib/thumbnails.mjs` :

```javascript
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
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `node --test scripts/lib/thumbnails.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/thumbnails.mjs scripts/lib/thumbnails.test.mjs
git commit -m "feat(thumbnails): service vignettes SC Wiki avec cache et repli non bloquant"
```

---

### Task 5: Helper NDJSON + `batch-export.mjs` configurable, `--json`, `--dry-run`

**Files:**
- Create: `scripts/lib/emit.mjs`
- Modify: `scripts/batch-export.mjs:22-26` (chemins), `scripts/batch-export.mjs:30-33` (flags/args), boucle d'export
- Test: `scripts/lib/emit.test.mjs`, `scripts/batch-export.dryrun.test.mjs`

**Interfaces:**
- Consumes: `loadConfig` (Task 1).
- Produces:
  - `emit(event)` : écrit `JSON.stringify(event) + "\n"` sur stdout (activé seulement en mode `--json`).
  - `batch-export.mjs` : lit `starbreaker`/`p4k` depuis la config ; en `--dry-run`, n'appelle PAS StarBreaker et émet un événement `{type:"plan",...}` par vaisseau ; en `--json`, émet `{type:"progress"}` / `{type:"result"}` en NDJSON.

- [ ] **Step 1: Écrire le test du helper (échoue)**

`scripts/lib/emit.test.mjs` :

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEmitter } from "./emit.mjs";

test("makeEmitter écrit du NDJSON quand actif", () => {
  const lines = [];
  const emit = makeEmitter(true, (s) => lines.push(s));
  emit({ type: "progress", key: "X" });
  emit({ type: "result", ok: 1 });
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]), { type: "progress", key: "X" });
  assert.ok(lines[0].endsWith("\n"));
});

test("makeEmitter est muet quand inactif", () => {
  const lines = [];
  const emit = makeEmitter(false, (s) => lines.push(s));
  emit({ type: "progress" });
  assert.equal(lines.length, 0);
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `node --test scripts/lib/emit.test.mjs`
Expected: FAIL (`Cannot find module ./emit.mjs`).

- [ ] **Step 3: Écrire le helper**

`scripts/lib/emit.mjs` :

```javascript
export function makeEmitter(active, write = (s) => process.stdout.write(s)) {
  return (event) => { if (active) write(JSON.stringify(event) + "\n"); };
}
```

- [ ] **Step 4: Vérifier le succès du helper**

Run: `node --test scripts/lib/emit.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Câbler la config et les flags dans `batch-export.mjs`**

Remplacer les constantes de chemins (lignes ~22-26) :

```javascript
import { loadConfig } from "./lib/config.mjs";
import { makeEmitter } from "./lib/emit.mjs";

const ROOT = pjoin(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = pjoin(ROOT, "models");
const cfg = loadConfig();
const STARBREAKER = cfg.paths.starbreaker;
const P4K = cfg.paths.p4k;

const JSON_MODE = process.argv.includes("--json");
const DRY_RUN = process.argv.includes("--dry-run");
const emit = makeEmitter(JSON_MODE);
```

Dans la sélection d'args existante, garder l'exclusion des flags : `process.argv.slice(2).filter((a) => !a.startsWith("--"))` couvre déjà `--json`/`--dry-run`.

- [ ] **Step 6: Émettre les événements dans la boucle**

Au début de la boucle `for (const key of batch)`, après le calcul de `label`, ajouter :

```javascript
    emit({ type: "progress", key, name: m.name, step: "start" });
    if (DRY_RUN) {
      emit({ type: "plan", key, name: m.name, lod, out });
      results.push({ key, name: m.name, ok: true, planned: true });
      continue;
    }
```

À la fin du `try` (succès), après le `console.log` existant, ajouter :

```javascript
      emit({ type: "progress", key, name: m.name, step: "done", tris: s.tris });
```

Dans le `catch`, après le `console.log` d'échec, ajouter :

```javascript
      emit({ type: "progress", key, name: m.name, step: "error", err: e.message.split("\n")[0] });
```

Après la boucle, avant les `console.log` de résumé, ajouter :

```javascript
  emit({ type: "result", ok: results.filter((r) => r.ok).length, ko: results.filter((r) => !r.ok).length, items: results });
```

Enfin, garder les `console.log` texte seulement hors mode JSON : envelopper les `console.log` de résumé final dans `if (!JSON_MODE) { ... }` (les lignes 105-110 du résumé). Les `console.log` par vaisseau dans la boucle doivent aussi être conditionnés par `if (!JSON_MODE)` pour ne pas polluer stdout NDJSON.

- [ ] **Step 7: Écrire le test `--dry-run` (échoue avant l'édition, passe après)**

`scripts/batch-export.dryrun.test.mjs` :

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, writeFileSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("batch-export --dry-run --json n'appelle pas StarBreaker et émet des events 'plan'", () => {
  if (!existsSync(join(ROOT, "app-config.json"))) {
    writeFileSync(join(ROOT, "app-config.json"), JSON.stringify({ paths: { starbreaker: "NOPE.exe", p4k: "NOPE.p4k" } }));
  }
  const out = execFileSync("node", ["scripts/batch-export.mjs", "AEGS_Avenger_Titan", "--dry-run", "--json"], { cwd: ROOT, encoding: "utf8" });
  const lines = out.trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(lines.some((e) => e.type === "plan" && e.key === "AEGS_Avenger_Titan"));
  assert.ok(lines.some((e) => e.type === "result"));
});
```

- [ ] **Step 8: Lancer le test pour vérifier le succès**

Run: `node --test scripts/batch-export.dryrun.test.mjs`
Expected: PASS (aucun appel StarBreaker, un event `plan` + un event `result`).

- [ ] **Step 9: Commit**

```bash
git add scripts/lib/emit.mjs scripts/lib/emit.test.mjs scripts/batch-export.mjs scripts/batch-export.dryrun.test.mjs
git commit -m "feat(batch-export): chemins configurables + sortie NDJSON + --dry-run"
```

---

### Task 6: `batch-interior.mjs` configurable, `--json`, `--dry-run` (+ catégorie pour détection manuelle)

**Files:**
- Modify: `scripts/batch-interior.mjs:25-28` (chemins), flags, boucle
- Test: `scripts/batch-interior.dryrun.test.mjs`

**Interfaces:**
- Consumes: `loadConfig` (Task 1), `makeEmitter` (Task 5).
- Produces: `batch-interior.mjs` accepte `--json` et `--dry-run` comme `batch-export`. En mode `--json`, l'event `result` inclut, par item traité, le champ `cat` déjà calculé (`"convention" | "modulesNoHp" | "none"`) — c'est la source autoritative du statut `manuel requis` (cat ≠ `convention`).

- [ ] **Step 1: Câbler config + flags**

Remplacer les constantes de chemins (lignes ~25-28) par le même bloc qu'en Task 5 Step 5 (import `loadConfig`, `makeEmitter`, `JSON_MODE`, `DRY_RUN`, `emit`).

- [ ] **Step 2: Émettre les événements dans la boucle**

Au début de la boucle, après `label` :

```javascript
    emit({ type: "progress", key, name: m.name, step: "start" });
    if (DRY_RUN) {
      emit({ type: "plan", key, name: m.name, lod, out });
      results.push({ key, name: m.name, ok: true, planned: true });
      continue;
    }
```

Après le succès (le `results.push({... cat ...})` existant), ajouter :

```javascript
    emit({ type: "progress", key, name: m.name, step: "done", cat });
```

Dans le `catch` :

```javascript
    emit({ type: "progress", key, name: m.name, step: "error", err: e.message.split("\n")[0] });
```

Après la boucle :

```javascript
  emit({ type: "result", ok: results.filter((r) => r.ok).length, ko: results.filter((r) => !r.ok).length, items: results });
```

Conditionner tous les `console.log` (boucle + résumé) par `if (!JSON_MODE)`.

- [ ] **Step 3: Écrire le test `--dry-run`**

`scripts/batch-interior.dryrun.test.mjs` :

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, writeFileSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("batch-interior --dry-run --json émet un plan sans appeler StarBreaker", () => {
  if (!existsSync(join(ROOT, "app-config.json"))) {
    writeFileSync(join(ROOT, "app-config.json"), JSON.stringify({ paths: { starbreaker: "NOPE.exe", p4k: "NOPE.p4k" } }));
  }
  const out = execFileSync("node", ["scripts/batch-interior.mjs", "AEGS_Avenger_Titan", "--dry-run", "--json"], { cwd: ROOT, encoding: "utf8" });
  const lines = out.trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(lines.some((e) => e.type === "plan"));
  assert.ok(lines.some((e) => e.type === "result"));
});
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `node --test scripts/batch-interior.dryrun.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/batch-interior.mjs scripts/batch-interior.dryrun.test.mjs
git commit -m "feat(batch-interior): chemins configurables + NDJSON + --dry-run + catégorie exposée"
```

---

### Task 7: Détection des prérequis

**Files:**
- Create: `scripts/lib/prereqs.mjs`
- Test: `scripts/lib/prereqs.test.mjs`

**Interfaces:**
- Consumes: `loadConfig` (Task 1).
- Produces: `checkPrereqs({ paths, which = defaultWhich }) -> { node, starbreaker, p4k, git, gh }` où chaque valeur est un booléen. `paths` = `{ starbreaker, p4k }`. `which(cmd) -> boolean` teste la présence d'un exécutable dans le PATH (injectable pour les tests). `node` est toujours `true`. `starbreaker`/`p4k` testent l'existence du fichier ; `git`/`gh` testent via `which`.

- [ ] **Step 1: Écrire les tests qui échouent**

`scripts/lib/prereqs.test.mjs` :

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { checkPrereqs } from "./prereqs.mjs";

const thisFile = fileURLToPath(import.meta.url);

test("checkPrereqs détecte fichiers présents/absents et commandes", () => {
  const r = checkPrereqs({
    paths: { starbreaker: thisFile, p4k: "Z:/nope/Data.p4k" },
    which: (cmd) => cmd === "git",
  });
  assert.equal(r.node, true);
  assert.equal(r.starbreaker, true);   // le fichier de test existe
  assert.equal(r.p4k, false);
  assert.equal(r.git, true);
  assert.equal(r.gh, false);
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `node --test scripts/lib/prereqs.test.mjs`
Expected: FAIL (`Cannot find module ./prereqs.mjs`).

- [ ] **Step 3: Écrire l'implémentation minimale**

`scripts/lib/prereqs.mjs` :

```javascript
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

export function defaultWhich(cmd) {
  const probe = process.platform === "win32" ? "where" : "which";
  try { execFileSync(probe, [cmd], { stdio: "ignore" }); return true; }
  catch { return false; }
}

export function checkPrereqs({ paths, which = defaultWhich }) {
  return {
    node: true,
    starbreaker: !!paths?.starbreaker && existsSync(paths.starbreaker),
    p4k: !!paths?.p4k && existsSync(paths.p4k),
    git: which("git"),
    gh: which("gh"),
  };
}
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `node --test scripts/lib/prereqs.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/prereqs.mjs scripts/lib/prereqs.test.mjs
git commit -m "feat(prereqs): détection Node/StarBreaker/Data.p4k/Git/gh"
```

---

### Task 8: Lecture best-effort de la version du jeu (`Data.p4k`) + repli

**Files:**
- Create: `scripts/lib/game-version.mjs`
- Test: `scripts/lib/game-version.test.mjs`

**Interfaces:**
- Consumes: rien.
- Produces: `readLocalGameVersion(p4kPath) -> string | null`. Cherche un fichier de version à côté du `Data.p4k` (dans le même dossier LIVE) : `f_win_game_launcher.log`/`build_manifest.id` ne sont pas garantis — on tente d'abord un fichier frère `c_win_shader_permutations`... non. Concrètement : tente de lire un fichier `<dossierLIVE>/build_manifest.id` (JSON contenant un champ de version type `Data.Branch`/`Data.RequestedP4kVersion`) ; si absent ou illisible, renvoie `null`. **Ne lève jamais.** Le `null` déclenche la saisie manuelle côté app.

> Note spike : le format exact du champ de version SC n'est pas garanti stable. Cette tâche fournit un lecteur best-effort + tests sur les chemins « fichier absent » et « champ trouvé ». Le raffinement du parsing réel est un spike séparé, non bloquant pour le MVP (repli saisie manuelle).

- [ ] **Step 1: Écrire les tests qui échouent**

`scripts/lib/game-version.test.mjs` :

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLocalGameVersion } from "./game-version.mjs";

test("renvoie null si le p4k ou le manifest est absent", () => {
  assert.equal(readLocalGameVersion("Z:/nope/Data.p4k"), null);
});

test("extrait une version sc-x.y depuis un build_manifest.id frère", () => {
  const live = mkdtempSync(join(tmpdir(), "live-"));
  writeFileSync(join(live, "Data.p4k"), "x");
  writeFileSync(join(live, "build_manifest.id"), JSON.stringify({ Data: { Branch: "sc-alpha-4.2" } }));
  assert.equal(readLocalGameVersion(join(live, "Data.p4k")), "sc-4.2");
  rmSync(live, { recursive: true, force: true });
});

test("renvoie null si aucun champ de version reconnaissable", () => {
  const live = mkdtempSync(join(tmpdir(), "live-"));
  writeFileSync(join(live, "Data.p4k"), "x");
  writeFileSync(join(live, "build_manifest.id"), JSON.stringify({ Data: { Foo: "bar" } }));
  assert.equal(readLocalGameVersion(join(live, "Data.p4k")), null);
  rmSync(live, { recursive: true, force: true });
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `node --test scripts/lib/game-version.test.mjs`
Expected: FAIL (`Cannot find module ./game-version.mjs`).

- [ ] **Step 3: Écrire l'implémentation minimale**

`scripts/lib/game-version.mjs` :

```javascript
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Extrait "sc-4.2" d'une chaîne contenant un x.y (ex. "sc-alpha-4.2", "LIVE-4.2.1").
function normalize(raw) {
  const m = /(\d+)\.(\d+)/.exec(String(raw ?? ""));
  return m ? `sc-${m[1]}.${m[2]}` : null;
}

export function readLocalGameVersion(p4kPath) {
  try {
    if (!p4kPath || !existsSync(p4kPath)) return null;
    const manifest = join(dirname(p4kPath), "build_manifest.id");
    if (!existsSync(manifest)) return null;
    const data = JSON.parse(readFileSync(manifest, "utf8"));
    const candidate = data?.Data?.Branch ?? data?.Data?.RequestedP4kVersion ?? data?.Branch ?? null;
    return normalize(candidate);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `node --test scripts/lib/game-version.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Brancher la lecture auto dans `analyze.mjs`**

Dans `scripts/analyze.mjs`, quand `--local-version` n'est pas fourni, tenter la lecture auto via la config (best-effort). Ajouter après le calcul de `localVersion` :

```javascript
import { loadConfig } from "./lib/config.mjs";
import { readLocalGameVersion } from "./lib/game-version.mjs";

let resolvedLocal = localVersion;
if (!resolvedLocal) {
  try { resolvedLocal = readLocalGameVersion(loadConfig({ root: ROOT }).paths.p4k); } catch { resolvedLocal = null; }
}
```

Puis utiliser `resolvedLocal` à la place de `localVersion` dans l'appel `analyzeShips` et la sortie. (Le `try/catch` autour de `loadConfig` évite de casser `analyze` quand `app-config.json` est absent.)

- [ ] **Step 6: Lancer toute la suite**

Run: `node --test`
Expected: PASS (tous les fichiers de test verts).

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/game-version.mjs scripts/lib/game-version.test.mjs scripts/analyze.mjs
git commit -m "feat(game-version): lecture best-effort de la version SC + repli null, branchée dans analyze"
```

---

## Verification finale

- [ ] `node --test` : toute la suite verte.
- [ ] `node scripts/analyze.mjs` (sans app-config) : produit un rapport texte sans planter.
- [ ] `node scripts/analyze.mjs --json` : produit un unique objet JSON valide.
- [ ] `git grep -n "starbreaker.exe" scripts/batch-export.mjs scripts/batch-interior.mjs` : plus aucun chemin machine codé en dur.
