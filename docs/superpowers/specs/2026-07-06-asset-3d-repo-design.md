# Spec — Dépôt `asset-3d` (mini-API statique de modèles 3D)

Date : 2026-07-06
Statut : **LIVRÉ** (POC dépassé). Ce document est le design initial ; l'état réel et le pipeline
complet sont dans [README](../../../README.md) + [RUNBOOK](../../RUNBOOK.md). Livré : 229 vaisseaux
extérieurs + intérieur Cutlass corrigé/validé, schéma v2 multi-variantes, pipeline reproductible par patch.

## Objectif

Fournir une mini-API statique servant des modèles 3D « lite » (`.glb`) des vaisseaux Star Citizen,
consommée par l'onglet « Vaisseaux 3D » de SC Fleet Manager. Ce spec ne couvre **que le dépôt** :
structure, schéma `index.json`, script de génération, hébergement, légal. Le pipeline d'extraction
(StarBreaker + Blender) et l'intégration app font l'objet de specs séparés.

## Décisions validées

| Sujet | Choix |
|---|---|
| Hébergement des `.glb` | GitHub **Releases**, un tag = patchVersion (ex. `sc-4.1`) |
| Clef vaisseau | `key` = className CIG (ex. `DRAK_Cutlass_Black`) = nom du fichier ; `name` = `ShipData.name` pour le JOIN app |
| Budget lite | Couleurs à plat, ~10-25k tris, cible < 1-4 Mo/`.glb` |
| Périmètre modèles | Extérieur seul (POC), via `--no-interior` de StarBreaker |
| POC | Cutlass Black (petit) + Idris (gros) |

## Structure du dépôt

```
asset-3d/
├── index.json            # catalogue genere (committe sur main) — le contrat
├── ships.meta.json       # meta par vaisseau : key -> name, manufacturer, dims, classification, materials
├── config.json           # githubOwner, githubRepo, patchVersion, budget{maxTris,maxSizeBytes}
├── models/               # staging local des .glb — GITIGNORE (binaires -> Releases)
├── scripts/
│   └── build-index.mjs   # scanne models/, calcule sha256+tris+taille, joint meta -> index.json
├── package.json          # type:module, scripts build / build:strict — zero dependance
├── .gitignore            # models/*.glb, node_modules
└── README.md             # legal + mode d'emploi
```

## Schéma `index.json`

Voir README. Champs par vaisseau : `key`, `name`, `manufacturer`, `classification`, `modelUrl`,
`dims{l,b,h}`, `tris`, `sizeBytes`, `materials` (`flat`|`baked`), `sha256`, `patchVersion`.
En-tête : `schemaVersion`, `generatedAt`, `patchVersion`.

- `modelUrl` = `https://github.com/<owner>/<repo>/releases/download/<patchVersion>/<key>.glb`
- `sha256` sert aussi de clef de cache côté app (invalide le cache si le modèle change).
- `materials` par vaisseau → permet de passer flat→baked au cas par cas sans changer le schéma.

## `build-index.mjs`

- Zéro dépendance : parse le binaire GLB lui-même pour compter les triangles (chunk JSON,
  somme des primitives, gère modes TRIANGLES/STRIP/FAN).
- `sha256` via `node:crypto`, taille via `fs.statSync`.
- Jointure avec `ships.meta.json` (erreur signalée si un `.glb` n'a pas de meta).
- Validation budget : avertissement, ou échec avec `--strict`.
- Sortie déterministe (vaisseaux triés par `key`) → diffs propres par patch.

## Alimentation (workflow mainteneur)

1. Export lite StarBreaker → `models/<key>.glb`
2. Renseigner le vaisseau dans `ships.meta.json`
3. `node scripts/build-index.mjs`
4. `git commit index.json` + `gh release upload <patch> models/<key>.glb`

## Hors périmètre (specs à venir)

- **Pipeline** : scripts d'export/allègement, décimation Blender si dépassement budget,
  degré d'automatisation, export auto des dims depuis ShipData.
- **App** : onglet « Vaisseaux 3D », fetch `index.json`, rendu three.js + cache local.
