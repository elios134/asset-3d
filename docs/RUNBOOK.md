# RUNBOOK — asset-3d

Mode d'emploi du pipeline : publier la flotte, sortir un nouveau patch, ajouter/corriger un intérieur.

## Pré-requis (une fois)

- **Node.js** + `npm install` (dépendances de dev : `@gltf-transform/*`, `meshoptimizer`).
- **StarBreaker** (`../starbreaker/starbreaker.exe`) et le **`Data.p4k`** du jeu installé.
  `export SC_DATA_P4K="D:/Program Files/RSI Launcher/StarCitizen/LIVE/Data.p4k"`
- **GitHub CLI** (`gh`) connecté au compte propriétaire du dépôt.
- L'app **SC Fleet Manager** avec sa base `scfleet.db` (source des métadonnées vaisseaux).

## Les scripts (dans `scripts/`)

| Script | Rôle |
|---|---|
| `gen-meta.mjs` | Lit `ShipData` (SQLite) → génère `ships.meta.json` (name/manufacturer/dims/classNameCig) pour toute la flotte. |
| `batch-export.mjs` | Export StarBreaker + optimisation (fusion meshes + meshopt) en masse. `--all` = flotte entière ; `--no-optimize` = brut (pour QA) ; sinon liste de `classNameCig`. Exclut les éditions wikelo/pyam/bis/exec. |
| `optimize.mjs` | Passe gltf-transform. Défaut = extérieurs (join + meshopt, −90% draw calls). `--compress-only` = intérieurs (weld + meshopt seuls, **préserve noms de mesh + hardpoints + placement**). |
| `qa.mjs` | Contrôle géométrique **sur exports BRUTS** (dims vs réel, meshes aberrants, containment). ⚠️ ne pas lancer sur des .glb déjà compressés meshopt (min/max faussés par la quantification). |
| `reposition-interior.mjs` | Corrige le placement des modules intérieurs (bug StarBreaker) via `interior-anchors.json`. S'auto-vérifie (critères app). |
| `build-index.mjs` | Génère `index.json` (le contrat) à partir des `.glb` présents dans `models/`. |
| `release-patch.mjs` | Orchestre gen-meta → batch-export --all → build-index pour un nouveau patch. |

## A. Publier / re-publier toute la flotte extérieure (nouveau patch SC)

1. **Mettre à jour `patchVersion`** dans `config.json` (ex. `"sc-4.2"`).
2. `node scripts/release-patch.mjs` — régénère méta + exporte/optimise les ~229 vaisseaux + catalogue.
   (≈ 25-40 min, ~720 Mo. Les échecs éventuels sont loggués, le script ne plante pas.)
3. **QA optionnelle sur brut** : pour contrôler avant compression, faire plutôt
   `node scripts/batch-export.mjs --all --no-optimize` puis `node scripts/qa.mjs`, puis
   `node scripts/optimize.mjs` (tous les extérieurs), puis `node scripts/build-index.mjs`.
4. **Publier** (commandes affichées par release-patch) :
   ```
   gh release create <patch> --title "SC <patch>" --notes "Flotte <patch>"   # si nouveau tag
   gh release upload <patch> models/*.exterior.glb --clobber
   git add index.json ships.meta.json && git commit -m "Flotte <patch>" && git push
   ```

## B. Ajouter / corriger un INTÉRIEUR (cas par cas)

Les intérieurs ne s'industrialisent PAS en bloc : la convention d'ancrage varie selon le vaisseau.

1. **Vérifier la convention** : `starbreaker entity export "<key>" h.json --dump-hierarchy --lod 3` puis
   chercher `hardpoint_int_*` et `interior_base_int_*_main`.
   - Présents (ex. Cutlass, Constellation) → méthode d'ancrage applicable.
   - Modules sans `hardpoint_int_*` (ex. Freelancer, Idris) → pas d'ancrage automatique ; nécessite
     des repères de pont par module fournis par le harnais app.
2. **Exporter** l'intérieur : `entity export "<key>" models/<key>.interior.glb --materials colors --lod <N> --mip 4`
   (LOD selon la taille ; capitaux = LOD3).
3. **Remplir `interior-anchors.json`** pour ce vaisseau : par module `interior_base_int_<X>_main` →
   `shell` (mot-clef du NOM de mesh de la coque), `hardpoint` (ancrage X/Z), `floorTo` (optionnel :
   hardpoint dont le y = le pont, pour aligner le PLANCHER en Y au lieu du centre).
4. **Reposition** : `node scripts/reposition-interior.mjs models/<key>.interior.glb` → écrit `.fixed.glb`
   et affiche PASS/FAIL. Promouvoir le `.fixed.glb` si CONFORME.
5. **Faire valider par le harnais app** (envoyer le sha) : centre coque vs hardpoint + plancher + containment.
6. **Compresser** : `node scripts/optimize.mjs --compress-only models/<key>.interior.glb` (44→~11 Mo,
   noms/placement préservés).
7. **Publier** : `gh release upload <patch> models/<key>.interior.glb --clobber` + `build-index` + commit.

## Critères de validation d'un intérieur (harnais app)

1. **X/Z** : centre de bbox de la coque du module = `hardpoint_int_X` (±0.5 m).
2. **Y** : plancher (min y) du module ≈ pont de la section (cargogrid.y) ±0.3 m.
3. **Containment** : aucune coque de module ne dépasse sous le ventre de la coque extérieure.

## Notes

- `models/*.glb` ne sont **pas** versionnés (gitignore) — ils vivent en GitHub Releases.
- `index.json` + `ships.meta.json` + `config.json` + `interior-anchors.json` sont committés.
- Côté app : le loader **doit** activer le décodeur meshopt (`MeshoptDecoder()`), sinon les `.glb` ne se chargent pas.
- Bug de placement intérieur upstream : StarBreaker issue #33 (non corrigé en 0.3.1/0.3.2).
