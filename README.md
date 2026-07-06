# asset-3d

Mini-API statique de modèles 3D **« lite »** des vaisseaux Star Citizen, pour l'application
[SC Fleet Manager](https://github.com/elios134). Chaque vaisseau est un `.glb` basse-poly
(couleurs à plat) destiné à **identifier, survoler, comparer les tailles et explorer l'intérieur** —
pas à faire du rendu photoréaliste.

**État** : **229 vaisseaux** extérieurs publiés (optimisés, ~3 Mo/vaisseau), plus un intérieur
corrigé et validé (Cutlass Black). Éditions spéciales/peintures (wikelo, pyam, best-in-show, exec)
exclues. Voir **[docs/RUNBOOK.md](docs/RUNBOOK.md)** pour tout régénérer/publier.

## Comment ça marche

- Les **binaires `.glb`** sont hébergés en **GitHub Releases** (un tag par patch SC, ex. `sc-4.1`).
  Ils ne sont **pas** versionnés dans le dépôt git.
- Le fichier **[`index.json`](index.json)** est le catalogue (le « contrat » que l'app lit).
- Chaque vaisseau expose plusieurs **variantes** (niveaux de détail), une par bouton côté app :
  `exterior` (Détaillé, avec portes/hardpoints, chargé par défaut) et `interior` (Intérieur,
  coque complète). Fichier = `models/<key>.<level>.glb`.
- L'app récupère `index.json`, puis télécharge et met en cache le `.glb` d'une variante **à la demande**
  (quand l'utilisateur clique son bouton). App desktop → gros fichiers tolérés (cache local).

### Schéma de `index.json` (schemaVersion 2)

```jsonc
{
  "schemaVersion": 2,
  "generatedAt": "2026-07-06T12:00:00Z",
  "patchVersion": "sc-4.1",
  "levels": [                              // ordre + libelles par defaut (l'app peut localiser via l'id)
    { "id": "exterior", "label": "Detaille" },
    { "id": "interior", "label": "Interieur" }
  ],
  "ships": [
    {
      "key": "DRAK_Cutlass_Black",         // className CIG = prefixe du nom de fichier
      "name": "Cutlass Black",             // = ShipData.name (clef de jointure cote app)
      "manufacturer": "Drake Interplanetary",
      "classification": "medium_freight",
      "dims": { "l": 38, "b": 26.8, "h": 10.5 },
      "materials": "flat",                 // flat | baked
      "patchVersion": "sc-4.1",
      "variants": [
        {
          "level": "exterior",             // = un id de `levels`
          "label": "Detaille",
          "modelUrl": "https://github.com/elios134/asset-3d/releases/download/sc-4.1/DRAK_Cutlass_Black.exterior.glb",
          "tris": 227016,
          "sizeBytes": 17241828,
          "hasInterior": false,
          "sha256": "…"                    // sert aussi de clef de cache cote app
        }
        // + interior…
      ]
    }
  ]
}
```

Un vaisseau peut n'avoir qu'une partie des variantes : l'app n'affiche des boutons que pour
celles présentes dans `variants`.

## Alimenter l'API (mainteneur)

Le pipeline complet (pré-requis, séquence par patch, ajout d'un intérieur, critères de validation)
est décrit dans **[docs/RUNBOOK.md](docs/RUNBOOK.md)**. En bref :

```powershell
$env:SC_DATA_P4K = "D:\Program Files\RSI Launcher\StarCitizen\LIVE\Data.p4k"
# 1) mettre a jour patchVersion dans config.json, puis :
node scripts/release-patch.mjs   # gen-meta -> batch-export --all -> build-index (toute la flotte)
# 2) publier (commandes affichees par le script) : gh release upload + git commit/push
```

Scripts (`scripts/`) : `gen-meta` (ShipData → méta), `batch-export` (export+optimisation en masse),
`optimize` (`--compress-only` pour les intérieurs), `qa` (contrôle géométrique sur exports bruts),
`reposition-interior` (fix placement intérieur), `build-index` (catalogue), `release-patch` (orchestrateur).

Les intérieurs se font **au cas par cas** (la convention d'ancrage varie selon le vaisseau) — voir le RUNBOOK.
`build-index.mjs` régénère toujours `index.json` entièrement et valide le budget (`config.json`).

## Périmètre

Ce dépôt **catalogue et sert** des `.glb` déjà finis. Il ne contient **ni** l'extraction
StarBreaker **ni** le traitement Blender — c'est un pipeline séparé, exécuté en local par le
mainteneur. Frontière : le pipeline produit les `.glb` → ce dépôt valide + catalogue → l'app consomme.

## Mentions légales / Fan content

Ce projet est du **contenu de fan non officiel** et **non commercial**, **non affilié à
Cloud Imperium Games (CIG)**. Star Citizen®, les noms de vaisseaux, marques et univers
appartiennent à CIG / Roberts Space Industries.

Les modèles fournis ici sont des **approximations basse-résolution transformatives** (« lite »),
générées à des fins d'identification et de comparaison au sein d'un outil communautaire gratuit.
Ce ne sont **pas** des redistributions des assets originaux du jeu.

Ce projet suit les [Fan Content Guidelines de CIG](https://support.robertsspaceindustries.com/hc/en-us/articles/360002490014-Fan-Kit-Content-Usage-Guidelines).
**Politique de retrait :** tout contenu sera retiré sur simple demande de CIG. Contact : voir le profil du mainteneur.
