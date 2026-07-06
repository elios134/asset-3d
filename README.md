# asset-3d

Mini-API statique de modèles 3D **« lite »** des vaisseaux Star Citizen, pour l'application
[SC Fleet Manager](https://github.com/elios134). Chaque vaisseau est un `.glb` basse-poly
(couleurs à plat, extérieur seul) destiné à **identifier, survoler et comparer les tailles** —
pas à faire du rendu photoréaliste.

## Comment ça marche

- Les **binaires `.glb`** sont hébergés en **GitHub Releases** (un tag par patch SC, ex. `sc-4.1`).
  Ils ne sont **pas** versionnés dans le dépôt git.
- Le fichier **[`index.json`](index.json)** est le catalogue (le « contrat » que l'app lit) :
  la liste des vaisseaux disponibles avec leur `modelUrl`, dimensions, nombre de triangles et `sha256`.
- L'app récupère `index.json`, puis télécharge et met en cache les `.glb` à la demande.

### Schéma de `index.json`

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-07-06T12:00:00Z",
  "patchVersion": "sc-4.1",
  "ships": [
    {
      "key": "DRAK_Cutlass_Black",      // className CIG = nom du fichier .glb
      "name": "Cutlass Black",          // = ShipData.name (clef de jointure cote app)
      "manufacturer": "Drake Interplanetary",
      "classification": "medium_freight",
      "modelUrl": "https://github.com/elios134/asset-3d/releases/download/sc-4.1/DRAK_Cutlass_Black.glb",
      "dims": { "l": 38, "b": 26.8, "h": 10.5 },
      "tris": 18420,
      "sizeBytes": 1533221,
      "materials": "flat",              // flat | baked
      "sha256": "…",                    // sert aussi de clef de cache cote app
      "patchVersion": "sc-4.1"
    }
  ]
}
```

## Alimenter l'API (mainteneur)

Pré-requis : Node.js, [GitHub CLI](https://cli.github.com/) (`gh`), StarBreaker, et le `Data.p4k`
du jeu installé localement.

```powershell
# 0) une fois : indiquer le Data.p4k
$env:SC_DATA_P4K = "D:\Program Files\RSI Launcher\StarCitizen\LIVE\Data.p4k"

# 1) exporter un vaisseau 'lite' avec StarBreaker (exterieur seul, couleurs a plat, LOD bas)
.\starbreaker.exe entity export "Cutlass_Black" `
  "…\asset-3D\models\DRAK_Cutlass_Black.glb" `
  --materials colors --no-interior --no-attachments --lod 2 --mip 4

# 2) renseigner le vaisseau dans ships.meta.json (name, manufacturer, dims depuis ShipData)

# 3) generer le catalogue (calcule tris + taille + sha256)
node scripts/build-index.mjs

# 4) publier : index.json sur main + le .glb en Release
git add index.json ships.meta.json && git commit -m "Ajout Cutlass Black" && git push
gh release upload sc-4.1 models/DRAK_Cutlass_Black.glb --clobber
```

Le script `build-index.mjs` **ne modifie jamais** `index.json` à la main : il le régénère
entièrement et valide le budget (`config.json` → `budget.maxTris`, `budget.maxSizeBytes`).
Ajouter `--strict` fait échouer le build si un vaisseau dépasse le budget.

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
