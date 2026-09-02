# App desktop — flux d'extraction (pipeline clay) — Design

Date : 2026-09-02. Branche : `feature/desktop-app-2a`. Suit les Plans 1 / 2a / 2b (galerie + flux màj, terminés, 20/20 tests).

## Contexte & problème

L'app Electron analyse et affiche le catalogue, mais le bouton « Extraire la sélection » est un stub `disabled`. Cette tranche le câble.

**Constat décisif (vérifié dans `index.json`)** : le catalogue publié est **100 % clay** — 229 extérieurs clay, 92 intérieurs clay, **zéro HD**. Le pipeline réel des deux niveaux est donc **`build-clay.mjs`**, pas `batch-export.mjs`/`batch-interior.mjs` (= chaîne HD « filet de secours » legacy). Corollaires :

- `reposition-interior.mjs` et le gating `convention/manuel` appartiennent au monde HD. Le clay ne repositionne pas (placement géré par cull de modules + `generate-floor`/`floor-navmesh`). **Aucune reposition dans cette tranche.**
- `build-clay.mjs` **n'a pas de mode `--json`/NDJSON** : il n'est pas pilotable par l'app en l'état. C'est le prérequis central à créer.
- `release-patch.mjs` est périmé (il enchaîne `batch-export --all` = HD). Hors périmètre ici, mais à corriger plus tard.

## Périmètre

**Dans cette tranche :**
- Ajouter un mode `--json` à `build-clay.mjs` (émission NDJSON via `lib/emit.mjs`, silence du stdout humain).
- Runner **streaming** côté main (spawn + lecture ligne à ligne + events IPC).
- Orchestration **par vaisseau** (annulation « après le vaisseau en cours ») avec un **résolveur de recette** par (clé, niveau).
- UI : **panneau superposé** (drawer) sur la galerie — file, statut par vaisseau, log, Annuler, résumé.
- Câblage du bouton flottant « Extraire ».
- Garde-fou prérequis (StarBreaker/p4k absents ⇒ start bloqué).

**Hors périmètre (tranches suivantes, assumé et confirmé) :**
- **Capitaux (l ≥ 100 m)** : recettes taillées à la main par vaisseau (`--chunk --modules --int-lod=1 --prop-min=0`, + `--floor-navmesh --spawn-largest`, + `--max-yspread` variables, + `collision_hull`). Non reproductibles par un bouton unique. Dans cette tranche ils sont **listés comme « avancé — non extrait automatiquement »**, jamais lancés avec une recette devinée.
- QA (`qa.mjs`) et barrière de publication : tranche suivante.
- Publication GitHub (release + patch chirurgical d'`index.json` — cf. garde-fou build-index) : tranche suivante.

## Architecture

### 1. `build-clay.mjs --json` (script, modification minimale)

- `import { makeEmitter } from "./lib/emit.mjs";` ; `const JSON_MODE = process.argv.includes("--json");` ; `const emit = makeEmitter(JSON_MODE);`.
- En mode JSON, **stdout ne doit émettre que du NDJSON** : envelopper les `console.log` humains existants dans `if (!JSON_MODE)`. (Les logs de progression fins peuvent aussi partir sur `console.error` — stderr — sans polluer le flux.)
- Émettre, alignés sur le contrat commun (`batch-export`/`batch-interior`) :
  - au début de chaque vaisseau : `{ type:"progress", key, name, level, step:"start" }` ;
  - en fin OK : `{ type:"progress", key, name, level, step:"done", tris, sizeBytes, file }` ;
  - sur SKIP (invariant `collision_walk` vide) : `{ type:"progress", key, name, level, step:"skip", reason }` ;
  - sur échec : `{ type:"progress", key, name, level, step:"error", err }` (déjà `try/catch` par vaisseau) ;
  - à la fin : `{ type:"result", ok, ko, skipped, items }`.
- `level` = `"exterior"` si `--ext-only`, sinon `"interior"`. L'app lance **un niveau par process** (voir résolveur), donc un run = un niveau homogène.
- Aucune autre logique changée. Les tests dry-run existants des scripts HD servent de modèle.

### 2. Résolveur de recette (main, pur, testable) — `app/src/main/recipe.ts`

`resolveRecipe(ship, level): { script:"build-clay.mjs", args:string[] } | { manual:true, reason:string }`

- `level === "exterior"` ⇒ `["build-clay.mjs", key, "--ext-only", "--modules", "--json"]`.
- `level === "interior"` et **capital** (`ship.dims.l >= 100`) ⇒ `{ manual:true, reason:"capital — recette taillée à la main" }`.
- `level === "interior"` sinon (habitable régulier) ⇒ `["build-clay.mjs", key, "--json"]`.

Seuil capital = `dims.l >= 100` (source `ship.dims`, déjà dans `Ship`). Fonction pure ⇒ testée directement.

### 3. Runner streaming (main) — `app/src/main/stream.ts`

`runStream(script, args, { cwd, onEvent }): { done: Promise<ResultEvent>, kill(): void }`

- `spawn("node", [script, ...args], { cwd })` ; `readline` sur `child.stdout` ; chaque ligne `JSON.parse` ⇒ `onEvent(evt)` (lignes non-JSON ignorées, tolérant). `done` résout au premier `{type:"result"}` (ou à la sortie), rejette sur exit non-zéro sans result, en incluant `stderr`.
- `kill()` = SIGTERM du child (utilisé seulement si l'utilisateur ferme l'app en cours ; l'annulation normale est gérée au niveau file, cf. §4).

### 4. Service `runExtract` (main) — `app/src/main/extract.ts`

`runExtract(selection, { onEvent, isCancelled }): Promise<ExtractSummary>`

- Construit une **file** `[{ key, level }]` depuis la `Selection` (exterior puis interior par clé). Pour chaque item : `resolveRecipe`.
  - `manual` ⇒ émet `{ type:"progress", key, level, step:"skip", reason }` (surfacé, non lancé).
  - sinon ⇒ `runStream(...)`, transfert des events via `onEvent`, `await done`.
- **Entre chaque item** : si `isCancelled()` ⇒ arrêt propre (le vaisseau courant a fini son process, aucun `.glb` à moitié écrit). Émet `{ type:"cancelled", doneCount }`.
- Agrège ⇒ `ExtractSummary { ok, ko, skipped, cancelled }`.
- Un seul run d'extraction à la fois (verrou module ; second start rejeté).

### 5. IPC (événements, pas request/response)

- `ipcMain.handle("extract:start", (e, selection) => svc.startExtract(e.sender, selection))` — `startExtract` pose le verrou, appelle `runExtract` avec `onEvent = (evt) => sender.send("extract:event", evt)`, résout au summary.
- `ipcMain.handle("extract:cancel", () => svc.cancelExtract())` — lève le flag `isCancelled`.
- Preload : `startExtract(selection)`, `cancelExtract()`, `onExtractEvent(cb): () => void` (abonnement `ipcRenderer.on`, renvoie un désabonnement). Types ajoutés à `Api` dans `shared/types.ts`.

### 6. UI — panneau superposé — `app/src/renderer/components/ExtractPanel.tsx`

- Drawer `position: fixed` sur la galerie, ouvert par le bouton flottant. Le bouton passe de `disabled` à actif dès qu'une sélection existe **et** que les prérequis StarBreaker/p4k sont présents.
- Contenu : titre + compteurs (file / faits / erreurs / avancés-ignorés) ; **liste des vaisseaux** avec statut par ligne (⏳ start · ✓ done · ✗ error · ⏭ skip/manuel) ; **log défilant** (dernières lignes NDJSON lisibles + erreurs copiables) ; bouton **Annuler** (actif pendant le run) ; **résumé final**.
- État géré par un **réducteur pur** `extractReducer(state, evt)` (`app/src/renderer/extractReducer.ts`) — testé isolément (progress/skip/error/result/cancelled ⇒ transitions).
- Au montage : `onExtractEvent` branché ; au clic Extraire : `startExtract(selection)`.

## Flux de données

`Selection (renderer)` → `extract:start` → `runExtract` construit la file → par vaisseau `resolveRecipe` → `runStream(build-clay … --json)` → NDJSON → `extract:event` → `extractReducer` → panneau. `.glb` écrits dans `models/` (nommage `KEY.clay-{exterior,interior}.glb`, repris tel quel par `build-index` ultérieurement).

## Gestion des erreurs

- Prérequis manquants ⇒ start bloqué (bouton désactivé + note), jamais de spawn.
- Échec d'un vaisseau ⇒ `step:"error"` + `err` dans le log, **la file continue** (robustesse déjà dans build-clay).
- Exit non-zéro sans `result` ⇒ rejet du `runStream` avec stderr ⇒ item marqué erreur, file continue.
- Annulation ⇒ arrêt après le vaisseau courant, résumé partiel affiché.
- Capital / recette manuelle ⇒ `skip` explicite (ni erreur, ni faux succès).

## Tests

- `recipe.test.ts` — résolveur : exterior ⇒ `--ext-only --modules` ; interior régulier ⇒ défaut ; interior capital (l≥100) ⇒ `manual`.
- `stream.test.ts` — faux script Node émettant du NDJSON connu (+ une ligne non-JSON ignorée, + un cas exit≠0) ⇒ events transférés, `done` résout/rejette correctement.
- `extract.test.ts` — faux scripts ⇒ ordre de file (ext avant int), `skip` des manuels, **annulation après le vaisseau courant**, agrégation du summary.
- `extractReducer.test.ts` — transitions pures.
- Vérif finale : `cd app && npm test` vert + `npm run build` + checkpoint visuel utilisateur (`npm run dev`).

## Décisions ouvertes (à confirmer avant plan)

1. Seuil capital = `dims.l >= 100 m` (aligné « 16 capitaux l≥100m » de la mémoire). OK ?
2. En mode JSON, silencier les `console.log` humains de build-clay via `if (!JSON_MODE)` (option : les rediriger sur stderr). Préférence ?
3. Extérieur toujours `--modules` (galerie proche du jeu, cf. MAJ2 publiée). Confirmé.
