# Design — Application desktop de gestion de l'API asset-3D (MVP)

Date : 2026-09-01
Statut : en attente de relecture utilisateur
Auteur : brainstorming Claude + elios134

## 1. Objectif

Transformer le pipeline `asset-3d` (scripts Node lancés à la main) en une application
desktop Windows simple qui, en un minimum de clics :

1. détecte la version locale de Star Citizen et la compare à la version publiée ;
2. présente un **hangar** (galerie) des vaisseaux avec vignettes, filtrable, où l'on
   choisit par vaisseau ce qu'on extrait (extérieur / intérieur) ;
3. lance extraction + optimisation + QA en streaming ;
4. publie sur GitHub, **uniquement si la QA passe**.

L'application ne réécrit pas le moteur : elle **pilote les scripts `.mjs` existants**.

## 2. Décisions actées (brainstorming)

| Sujet | Décision |
|---|---|
| Périmètre MVP | Extérieurs **et** intérieurs (avec nuance intérieurs, §5) |
| Version locale du jeu | Lue dans `Data.p4k` (spike requis, repli saisie manuelle — §12) |
| Version publiée | Lue dans `index.json` |
| Détection « à traiter » | Simple : présence dans `models/` + comparaison de version de patch |
| Techno desktop | **Electron + React** (Node intégré nativement, moteur 100% Node) |
| Auth GitHub | `gh` CLI déjà installé et connecté — aucun token stocké |
| Ajouts demandés | Listing complet des 273 vaisseaux + choix ext/int par vaisseau + vignettes SC Wiki |

## 3. Périmètre MVP — inclus

- Écran unique « hangar » (voir §8) : header versions/statut, recherche, filtre
  « À traiter / Tout le catalogue », galerie de cartes vaisseau avec vignette.
- Détection version locale (`Data.p4k`, repli saisie manuelle) + version publiée (`index.json`).
- Analyse des changements → raison par vaisseau (nouveau / modifié / intérieur manquant /
  manuel requis / à jour).
- Choix par vaisseau : `Extérieur`, `Intérieur`, ou les deux.
- Extraction + optimisation en streaming (progression + logs copiables).
- QA géométrique ; **publication bloquée si QA non conforme**.
- Publication GitHub : release, upload `.glb`, `index.json`, commit, push, liens affichés.
- Vignettes SC Wiki avec cache disque et repli (jamais bloquant).
- Détection des prérequis au démarrage (Node, StarBreaker, `Data.p4k`, Git, `gh`).

## 4. Périmètre MVP — exclu (chantiers ultérieurs)

Détection fine « modifié » intra-patch · reprise après interruption · historique riche ·
coffre-fort Windows / gestion de token · tests sur machine vierge · installeur signé ·
génération automatique d'intérieurs non conventionnels.

## 5. Nuance intérieurs (honnêteté technique)

Les intérieurs ne s'industrialisent pas en bloc (RUNBOOK §B) : la convention d'ancrage
varie par vaisseau. Traitement selon la catégorie (`batch-interior.mjs` la calcule déjà) :

- **Extérieurs** → 100% automatisés (export → optimise → QA → publie).
- **Intérieurs conventionnels** (dans `interior-anchors.json`, ou catégorie `convention`)
  → automatisés : export → `reposition-interior` auto → QA → publie.
- **Intérieurs non conventionnels** → marqués `manuel requis` : listés, non lancés en auto ;
  l'app ouvre le RUNBOOK / le dossier pour la correction cas-par-cas.

## 6. Architecture (Electron, 3 couches)

```
Renderer (React)  ── UI galerie, aucune logique pipeline
      │  IPC (preload, contextIsolation)
Main process (Node) ── "backend" : lit config, spawn des scripts .mjs (child_process),
      │                 parse le JSON/NDJSON, service vignettes, appels gh
Scripts .mjs      ── moteur inchangé, rendus pilotables (§7)
```

Règle (TODO §3) : les commandes sont exécutées **depuis le main process**, jamais depuis
le renderer.

### Modules du main process

- `config` : fusionne `config.json` (commité) + `app-config.json` (local, non commité :
  chemins machine `starbreaker`, `p4k`).
- `versions` : lit version locale (`Data.p4k` / repli manuel) + version publiée (`index.json`).
- `prereqs` : vérifie présence Node / StarBreaker / `Data.p4k` / Git / `gh`.
- `runner` : spawn d'un script `.mjs`, streaming NDJSON → événements IPC, annulation (kill).
- `thumbnails` : service vignettes SC Wiki + cache disque (§9).
- `publisher` : orchestration `gh release` / `build-index` / commit / push.

## 7. Chantier « scripts pilotables » (premier chantier technique)

Sans sortie structurée, l'UI ne peut rien afficher. Pour chaque script clé :

1. **Externaliser les chemins** : `STARBREAKER` et `P4K` codés en dur dans
   `batch-export.mjs` (l.24-25) et `batch-interior.mjs` (l.27-28) → lus depuis `app-config.json`
   (via variable d'env `SC_DATA_P4K` déjà supportée + nouveau chemin StarBreaker configurable).
2. **`--json`** : émettre un flux NDJSON (une ligne JSON par événement) sur stdout :
   - `{"type":"progress","key":"...","step":"export|optimize|done","...}`
   - un objet final `{"type":"result","ok":N,"ko":N,"items":[...]}` (succès, échecs,
     fichiers créés, durée, taille, erreurs).
   Le mode texte actuel (console lisible) reste le défaut hors `--json`.
3. **`--dry-run`** : afficher les actions sans les exécuter.
4. **Nouveau `scripts/analyze.mjs`** : la commande de comparaison. Lit version locale,
   `index.json` publié et le contenu de `models/` → renvoie en JSON la liste
   `[{key, name, manufacturer, dims, reason, availableLevels, hasInteriorConvention}]`.

Scripts concernés : `analyze.mjs` (nouveau), `batch-export.mjs`, `batch-interior.mjs`,
`qa.mjs`, `build-index.mjs`. `reposition-interior.mjs` est appelé automatiquement pour les
intérieurs conventionnels.

## 8. Logique de détection (simple)

Pour chaque vaisseau de `ships.meta.json` :

- `.exterior.glb` absent de `models/` → `nouveau`.
- extérieur présent mais `.interior.glb` absent → `intérieur manquant`.
- version du jeu (local) > version publiée (`index.json`) → les vaisseaux présents passent
  `version modifiée` (geste réel d'un nouveau patch SC : on régénère).
- intérieur hors convention (pas dans `interior-anchors.json` et catégorie ≠ `convention`)
  → l'axe intérieur est marqué `manuel requis`.
- sinon → `à jour` (masqué par le filtre « À traiter »).

Limite assumée : ne détecte pas un vaisseau modifié *au sein d'un même patch*
(post-MVP : hash/date des assets `.p4k`).

## 9. Service vignettes (SC Wiki)

- Source : `https://api.star-citizen.wiki/api/v2/vehicles` (champ `name`, `manufacturer.name`,
  `images[].thumbnail_url`). Vérifié : `name` correspond à notre champ `name`.
- Matching : par `name` exact ; repli sur le vaisseau de base pour les éditions
  (ex. « Avenger Titan Renegade » → « Avenger Titan ») ; sinon silhouette générique.
- **Cache disque** : `.cache/thumbs/<key>.jpg` (téléchargé une fois, non commité).
- **Jamais bloquant** : une vignette absente n'empêche pas l'analyse ni l'extraction.
- Fetch depuis le main process (pas de CORS), throttlé pour respecter l'API.

## 10. Flux d'un cycle

1. Démarrage → détection versions + prérequis → header + galerie.
2. **Analyser** → `analyze.mjs --json` → raisons + niveaux par carte.
3. Sélection (puces ext/int par vaisseau) → **Extraire la sélection** →
   `batch-export.mjs`/`batch-interior.mjs --json` (+ `reposition` auto) en streaming.
4. **QA** → `qa.mjs` → conforme / non conforme.
5. **Publier** (si QA conforme) → confirmation utilisateur (dépôt, tag, titre, notes) →
   `gh release create/upload` + `build-index.mjs` + commit + push → liens affichés.

## 11. Gestion d'erreurs (sous-ensemble MVP)

- Prérequis manquants → signalés au démarrage (bandeau prérequis).
- Échec d'un vaisseau → loggé, le batch continue (comportement actuel conservé).
- QA non conforme → publication désactivée.
- Annulation utilisateur → `kill` du process enfant en cours.

## 12. Risques & spikes

- **Lecture de version dans `Data.p4k`** : format non garanti trivial à parser. Spike avant
  implémentation ; **repli MVP** : champ de saisie manuelle de la version (toujours présent,
  pré-rempli si la lecture auto réussit). Le MVP n'est pas bloqué par ce spike.
- **Matching wiki** : quelques éditions absentes → repli documenté (§9), non bloquant.

## 13. Tests

- Scripts `--json` testables en isolation (sortie NDJSON déterministe).
- `analyze.mjs` testable sur fixtures (`index.json` factice + faux dossier `models/`).
- `qa.mjs` renvoie déjà un code de sortie ≠ 0 → barrière publication testable.
- Coquille Electron : test end-to-end manuel du flux (analyser → extraire → QA → publier
  en `--dry-run`).

## 14. Sécurité & auth

`gh` CLI déjà connecté au compte propriétaire (`elios134/asset-3d`). Aucun token en clair
dans le projet. `app-config.json` (chemins machine) et `.cache/` sont gitignorés.

## 15. Ordre d'implémentation proposé

1. Chantier scripts pilotables (§7) — débloque tout, testable seul.
2. `analyze.mjs` + logique de détection (§8).
3. Service vignettes (§9).
4. Coquille Electron + galerie (§6, §8 UI).
5. Streaming extraction + QA (§10 étapes 3-4).
6. Publication `gh` derrière la barrière QA (§10 étape 5).
