# Brief maquette — onglet « Vaisseaux 3D » (3 niveaux de détail)

Document de handoff pour l'intégration app (SC Fleet Manager). Décrit les 3 niveaux de détail
servis par l'API `asset-3d` et le comportement UX attendu pour la maquette.

## ⚠️ PRÉREQUIS : décodeur meshopt obligatoire

Les `.glb` sont compressés avec **`EXT_meshopt_compression`** (perf + poids). Sans le décodeur,
`useGLTF` échoue à charger. Configure le loader une fois avec le `MeshoptDecoder` de three :

```ts
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
// avec drei :
useGLTF(url, undefined, undefined, (loader) => loader.setMeshoptDecoder(MeshoptDecoder));
// ou preload :
useGLTF.preload(url, undefined, undefined, (loader) => loader.setMeshoptDecoder(MeshoptDecoder));
```

## Point d'entrée API

```
GET https://raw.githubusercontent.com/elios134/asset-3d/main/index.json
```

`index.json` (schemaVersion 2) → `{ levels[], ships[] }`.
- `levels[]` : ordre + libellés par défaut des niveaux (ids stables).
- `ships[].variants[]` : un objet par niveau disponible pour ce vaisseau.
- Jointure avec la table `ShipData` par `ship.name` (= `ShipData.name`).

## Les 2 niveaux (= 2 boutons)

| Bouton | `level` (id) | Ce qu'il montre | Poids typique | Usage |
|---|---|---|---|---|
| **Détaillé** | `exterior` | Extérieur + **portes** + hardpoints (armes, propulseurs) | 14–16 Mo | **Défaut**, chargé d'entrée. Vue du vaisseau |
| **Intérieur** | `interior` | Coque complète + **intérieur** (ponts, pièces) | 42–59 Mo | Explorer l'intérieur |

Les ids `exterior / interior` sont **stables** → mapper les boutons dessus.
Les libellés `label` sont des défauts ; l'app peut les localiser fr/en via l'id.

## Comportement UX attendu

1. **Chargement paresseux par niveau.** Au chargement de la fiche vaisseau, on charge **`exterior`
   par défaut** (le premier niveau). `interior` se charge **à la demande**, au clic du bouton
   (fichier lourd : 42–59 Mo). NB : le défaut `exterior` pèse déjà 14–16 Mo → prévoir un spinner
   dès l'ouverture de la fiche.
2. **Indicateur de chargement** pendant le téléchargement d'un niveau lourd (spinner + taille ex.
   « Chargement intérieur… 59 Mo »). Le `sizeBytes` de la variante permet d'afficher le poids à l'avance.
3. **Cache local par `sha256`.** Une fois un niveau téléchargé, le mettre en cache (clé = `sha256`).
   Re-clic = instantané. Si le `sha256` change (nouveau patch), invalider et re-télécharger.
4. **Boutons dynamiques.** N'afficher que les boutons des niveaux présents dans `variants` (un vaisseau
   peut n'avoir que `silhouette`, ou pas encore d'`interior`).
5. **Fallback** si un vaisseau n'a aucun modèle (`variants` vide / absent d'`index.json`) : afficher
   l'image `imageUrl` de `ShipData` + un message « Modèle 3D pas encore disponible ».
6. **Rendu** : `useGLTF` (drei) + `OrbitControls`, réutiliser le pattern 3D lazy-loadé existant
   (comme `Hold3D`). Échelle réelle recalable via `dims { l, b, h }`.

## Forme d'une variante (pour typer le composant)

```jsonc
{
  "level": "interior",
  "label": "Interieur",
  "modelUrl": "https://github.com/elios134/asset-3d/releases/download/sc-4.1/DRAK_Cutlass_Black.interior.glb",
  "tris": 642743,
  "sizeBytes": 44489812,
  "hasInterior": true,
  "sha256": "…"
}
```

## Données réelles du POC (2 vaisseaux en ligne, patch sc-4.1)

| Vaisseau (`name`) | Détaillé | Intérieur |
|---|---|---|
| Cutlass Black | 227k tris / 16 Mo | 643k tris / 42 Mo |
| Idris-P | 332k tris / 14 Mo | 1,06M tris / 59 Mo |

> Maquette conseillée : viewer 3D central + une barre de 2 boutons (Détaillé / Intérieur),
> bouton actif surligné, poids affiché sur le niveau Intérieur, spinner de chargement, et l'état
> « fallback image » pour un vaisseau sans modèle.
