# Design — Plan 2b : flux mise-à-jour + détection enrichie + galerie (app desktop asset-3D)

Date : 2026-09-01
Statut : en attente de relecture utilisateur
Base : Plan 2a livré (coquille Electron + galerie, branche `feature/desktop-app-2a`)

## 1. Objectif

Transformer la galerie « catalogue statique » du Plan 2a en un **flux de travail** :
vérifier l'écart de version → mettre à jour les données du catalogue → n'afficher que ce
qu'il y a à (ré)extraire, avec pré-cochage intelligent, filtres, tri, et un bouton d'action
flottant. L'extraction/QA/publication réelles restent hors périmètre (plan ultérieur) ; 2b
prépare et présente le travail à faire.

## 2. Faits établis (investigation `scfleet.db` + fichiers asset-3D)

- `ships.meta.json` est généré par `scripts/gen-meta.mjs` depuis la table `ShipData` de
  `scfleet.db` (`C:/Users/andre/AppData/Roaming/com.andre.sc-fleet-manager-v2/scfleet.db`).
- **Version des données actuelle** : `ShipData.wikiVersion = 4.9.0-LIVE.…` (global, identique
  pour les 295 lignes). **Version du jeu local** (lue par le Plan 1 dans `Data.p4k`) = `sc-4.9`.
  **Version publiée** (`index.json.patchVersion`) = `sc-4.1`.
- `gen-meta` (dedup par nom) produirait **278** vaisseaux (vs 273 actuels) → **5 nouveautés**
  réelles (4 vrais nouveaux : MOLE/Golem/Prospector « Alliance », Basher ; + 1 édition Wikelo
  déjà masquée). Les « 22 » étaient un artefact (295 lignes brutes → 278 après dedup).
- **« Visitable »** = `ShipData.crewMax >= 2` (règle de l'app SC Fleet v2, cf.
  `visitable-interiors.json` : 107 clés). `index.json` publie **92 intérieurs**.
- **« Gold standard » n'existe pas** comme donnée (ni colonne DB, ni fichier) — concept externe.
- Le seul signal de version **par vaisseau** disponible : `index.json` porte une `patchVersion`
  **par vaisseau**. L'analyse actuelle donne, aujourd'hui, **229 « version modifiée »** (publiés
  en 4.1, jeu en 4.9) + **44 « nouveau »** — comportement correct, pas un bug.

## 3. Décisions actées

| Sujet | Décision |
|---|---|
| « Mettre à jour les données » | Relancer `gen-meta` (rafraîchit `ships.meta.json` depuis `ShipData`). Aucune extraction. |
| Définition de « modifié » | **Coarse (Option A)** : vaisseau publié dont la `patchVersion` d'extraction < version actuelle. Faute de granularité par-vaisseau dans la donnée. |
| Deltas fins par vaisseau | **Hors 2b** : on prévoit de stocker la `wikiVersion` par vaisseau à l'extraction (plan d'extraction ultérieur) pour des « modifiés » fins aux prochains patches. |
| « Visitable » | `ShipData.crewMax >= 2`, lu en direct depuis `scfleet.db` par le main process. |
| Pré-cochage | Uniquement pour les **modifiés déjà extraits** : axe extérieur si publié ; axe intérieur si le vaisseau est **visitable**. Les **nouveaux** restent décochés. |
| Vue par défaut | **« À traiter »** = nouveaux + modifiés. + onglet **« Extraits »** (déjà publiés) + **« Tout »**. |
| Tri | Option de **tri alphabétique** (par nom). |
| Bouton « Extraire » | **Flottant**, toujours visible. |
| Éditions masquées | On conserve le filtre 2a (wikelo/pyam/Best In Show/BIS). Les variantes « Alliance/BTALA » restent **affichées** sauf décision contraire (point ouvert §9). |

## 4. Flux utilisateur

```
Démarrage
  ├─ lit : version publiée (index.json) · version locale jeu (Data.p4k) · prérequis
  ├─ SI publiée < locale (mise à jour disponible) :
  │     → écran d'accueil : 2 versions + statut + bouton « Mettre à jour les données »
  │       (galerie MASQUÉE)  ← point 3
  │     → clic : spawn gen-meta → re-analyse (+ visitable) → révèle la galerie
  └─ SINON (à jour) : galerie directement (peu/rien « à traiter »)

Galerie (après mise à jour)
  ├─ filtres : [À traiter] (défaut) · [Extraits] · [Tout]     ← point 4
  ├─ recherche (nom/fabricant) + tri alphabétique (toggle)     ← point 5
  ├─ cartes : vignette, badge statut/visitable, puces ext/int (pré-cochées selon §5)
  └─ barre flottante : « Extraire la sélection (N) » (désactivé — extraction = plan ultérieur)
```

## 5. Détection & pré-cochage (par vaisseau)

Entrées : sortie `analyze.mjs` (déjà : `status`, `exterior.published`, `interior.published`,
`reasons`) + `visitable` (ajouté par le main process depuis `scfleet.db`).

- **new** = présent dans `ships.meta.json` mais pas publié (`!exterior.published`).
- **modified** = publié mais `patchVersion` d'extraction < version courante (déjà calculé
  comme `"version modifiée"`).
- **visitable** = `crewMax >= 2`.
- **Filtre « À traiter »** = `status ∈ { nouveau, version modifiée, intérieur manquant }`.
- **Filtre « Extraits »** = `exterior.published === true`.
- **Filtre « Tout »** = tous (hors éditions masquées).
- **Pré-cochage initial** (au chargement de la galerie) :
  - `exterior = true` si **modified** et `exterior.published`.
  - `interior = true` si **modified** et `visitable`.
  - **new** → tout décoché.

Le filtre d'exclusion (wikelo/pyam/BIS) reste appliqué **une seule fois** au niveau des
données (`App`, comme corrigé en 2a), donc cohérent avec les compteurs et les 3 onglets.

## 6. Architecture (impact sur le Plan 2a)

Réutilisation maximale ; changements additifs.

### Main process (`app/src/main`)
- **`updateData()`** (nouveau service) : `runJson`-style spawn de `node scripts/gen-meta.mjs`
  avec `cwd` = racine ; succès = exit 0. (gen-meta lit `scfleet.db` au chemin par défaut,
  écrit `ships.meta.json`.) Retour : `{ ok, count }` (ajouter un `--json` léger à gen-meta,
  ou parser sa dernière ligne / exit code).
- **`visitableSet()`** (nouveau) : lit `scfleet.db` en lecture seule (`node:sqlite`, comme
  gen-meta) → `Set<classNameCig>` des `crewMax >= 2`. Le service `analyze()` **enrichit**
  chaque `Ship` d'un booléen `visitable` avant de le renvoyer au renderer (l'accès DB reste
  dans la couche app ; les scripts Plan 1 restent inchangés).
- IPC ajoutés : `updateData`. `analyze` renvoie désormais des `Ship` enrichis (`visitable`).

### Types partagés
- `Ship` gagne `visitable: boolean`. `Api` gagne `updateData(): Promise<{ok:boolean; count:number}>`.

### Renderer (`app/src/renderer`)
- **`App`** : machine à états `checking → needsUpdate → updating → ready` (+ `error`).
  Écran d'accueil « needsUpdate » avec le bouton ; galerie montée seulement en `ready`.
- **`Toolbar`** : 3 onglets (À traiter/Extraits/Tout) + toggle **tri alphabétique**.
- **`Gallery`** : applique filtre d'onglet + recherche + tri ; badge **visitable** sur la carte.
- **Pré-sélection** : `App` initialise la `Selection` depuis la liste enrichie (§5) au passage
  en `ready`.
- **Barre d'action flottante** : `position: fixed` en bas (padding bas de la galerie pour ne
  rien masquer) — remplace le `sticky` du 2a.

## 7. Effets de bord & sécurité

- `gen-meta` **écrit `ships.meta.json`** (fichier suivi par git) — effet attendu et voulu de
  « mettre à jour les données ». À signaler dans l'UI (« catalogue mis à jour : N vaisseaux »).
- Accès `scfleet.db` **en lecture seule** uniquement (jamais d'écriture).
- Le renderer continue de ne toucher au système que via `window.api`.

## 8. Hors périmètre 2b (plans ultérieurs)

Extraction/optimisation réelles · QA · publication `gh` · stockage de la `wikiVersion` par
vaisseau à l'extraction (pour deltas fins) · installeur Windows signé · packaging embarquant
scripts+données.

## 9. Points ouverts (à trancher en revue)

1. **Variantes « Alliance/BTALA »** (MOLE/Golem/Prospector Alliance, etc.) : les afficher
   (défaut proposé) ou les masquer comme les éditions ?
2. **Écran d'accueil quand déjà à jour** (publiée == locale) : galerie directe, ou toujours
   un bouton « rafraîchir » ? (défaut proposé : galerie directe.)
3. **`gen-meta --json`** : ajouter une sortie structurée légère, ou se contenter de l'exit
   code + relecture de `ships.meta.json` ? (défaut proposé : exit code + relecture.)
