# To-do — Application desktop de gestion de l'API

Objectif : transformer le pipeline `asset-3d` en logiciel desktop simple permettant de vérifier la version du jeu, d'identifier les fichiers à extraire, de lancer le pipeline en un clic et de publier les résultats sur GitHub.

## 0. Décisions MVP actées (2026-09-01)

> Cadrage validé en brainstorming. Design complet : `docs/superpowers/specs/2026-09-01-app-desktop-gestion-api-design.md`.

- **Techno** : Electron + React (moteur 100 % Node conservé, exécuté depuis le main process).
- **Périmètre** : extérieurs **et** intérieurs. Intérieurs conventionnels automatisés
  (`interior-anchors.json` / catégorie `convention`) ; intérieurs non conventionnels marqués
  `manuel requis` (listés, corrigés cas-par-cas, non lancés en auto).
- **Version locale** : lue dans `Data.p4k` (spike requis) ; repli = saisie manuelle.
- **Version publiée** : lue dans `index.json`.
- **Détection** : simple (présence dans `models/` + comparaison de version de patch).
- **Auth** : `gh` CLI déjà connecté (`elios134/asset-3d`) — aucun token stocké.
- **Ajouts validés** : galerie complète des 273 vaisseaux (recherche + filtre « À traiter / Tout »),
  choix `Extérieur` / `Intérieur` par vaisseau, **vignettes SC Wiki** (`api.star-citizen.wiki`,
  cache disque, repli non bloquant).
- **Barrière QA** : publication désactivée tant que la QA n'est pas conforme.

Statut : spec validée. Plan d'implémentation découpé en 2 sous-projets :
- **Plan 1 — Moteur pilotable (backend CLI)** : ✅ **TERMINÉ** (8 tâches TDD, 25/25 verts) — PR #1. `docs/superpowers/plans/2026-09-01-moteur-pilotable.md`.
- **Plan 2 — Coquille Electron + galerie** : à rédiger. Rappels : lancer `analyze.mjs` avec cwd=racine ; croiser `interior.anchored===false` et `cat!=="convention"` avant auto-traitement d'un intérieur ; runner NDJSON tolérant ; 2 contrats stdout (analyze = objet JSON unique, batch = NDJSON).

## 1. Définir le fonctionnement

- [ ] Définir la source de vérité de la version locale de Star Citizen :
  - version lue dans `Data.p4k` ;
  - fichier de version du launcher ;
  - saisie manuelle en solution de secours.
- [ ] Définir la source de la dernière version publiée : `index.json`, releases GitHub, ou les deux.
- [ ] Définir ce qu'est un « nouveau fichier à extraire » :
  - nouveau vaisseau ;
  - vaisseau modifié ;
  - intérieur manquant ;
  - modèle obsolète.
- [ ] Définir si la première version gère uniquement les extérieurs ou également les intérieurs.

## 2. Préparer le pipeline existant

- [ ] Remplacer les chemins codés en dur dans `scripts/batch-export.mjs` : StarBreaker et `Data.p4k`.
- [ ] Ajouter une configuration locale pour les chemins et les options du pipeline.
- [ ] Transformer `scripts/release-patch.mjs` en pipeline pilotable par l'application.
- [ ] Faire retourner aux scripts des résultats structurés en JSON : succès, échecs, fichiers créés, durée, taille et erreurs.
- [ ] Ajouter un mode `--dry-run` pour afficher les actions sans les exécuter.
- [ ] Ajouter une commande de comparaison entre la version locale du jeu, la version GitHub publiée et les fichiers présents dans `models/`.
- [ ] Générer un rapport des fichiers à extraire avant tout traitement.
- [ ] Distinguer clairement les étapes : extraction, optimisation, QA, génération de `index.json` et publication.

## 3. Choisir la technologie desktop

- [ ] Évaluer **Tauri + React** comme option recommandée pour une application Windows légère.
- [ ] Conserver les scripts Node.js existants comme moteur du pipeline.
- [ ] Exécuter les commandes depuis le backend desktop, jamais directement depuis l'interface.
- [ ] Prévoir une version Windows installable (`.msi` ou `.exe`).
- [ ] Évaluer Electron comme alternative si l'intégration Node/Tauri devient bloquante.

## 4. Concevoir l'interface utilisateur

### Écran principal

- [ ] Afficher la version locale détectée du jeu.
- [ ] Afficher la version actuellement publiée sur GitHub.
- [ ] Afficher un statut clair : `À jour`, `Nouvelle version disponible`, `Configuration incomplète` ou `Erreur de détection`.
- [ ] Afficher les prérequis détectés : Node.js, StarBreaker, `Data.p4k`, Git et authentification GitHub.
- [ ] Ajouter un bouton **Analyser les changements**.
- [ ] Afficher la liste des fichiers/vaisseaux à traiter.
- [ ] Afficher la raison de chaque élément : nouveau vaisseau, modèle absent, version modifiée, intérieur à ajouter ou modèle déjà à jour.
- [ ] Ajouter une sélection individuelle ou globale des éléments.
- [ ] Ajouter un bouton principal **Lancer l'extraction**.
- [ ] Afficher la progression par étape.
- [ ] Afficher les logs détaillés avec possibilité de copier l'erreur.
- [ ] Ajouter un bouton **Lancer la QA**.
- [ ] Afficher les erreurs et avertissements avant publication.
- [ ] Désactiver la publication si la QA échoue.

## 5. Publier sur GitHub

- [ ] Ajouter une étape **Publier sur GitHub**.
- [ ] Permettre de confirmer le dépôt, le tag de release, le titre et les notes de version.
- [ ] Créer automatiquement la release GitHub.
- [ ] Envoyer les fichiers `.glb` générés.
- [ ] Envoyer les éventuels fichiers `.lights.json`.
- [ ] Générer et publier `index.json`.
- [ ] Mettre à jour `ships.meta.json` si nécessaire.
- [ ] Créer automatiquement le commit.
- [ ] Pousser les modifications sur GitHub.
- [ ] Afficher les liens vers la release, `index.json` et les fichiers publiés.
- [ ] Ajouter une confirmation utilisateur avant la publication finale.

## 6. Authentification et sécurité

- [ ] Définir une méthode d'authentification GitHub : GitHub CLI déjà connecté ou token GitHub.
- [ ] Ne jamais stocker un token en clair dans le projet.
- [ ] Utiliser le coffre-fort système Windows si un token est nécessaire.
- [ ] Vérifier les permissions minimales : création de release, upload d'assets et push sur le dépôt.
- [ ] Afficher une erreur compréhensible si l'authentification expire.

## 7. Gestion des erreurs

- [ ] Gérer StarBreaker absent.
- [ ] Gérer `Data.p4k` introuvable ou incompatible.
- [ ] Gérer Node.js absent.
- [ ] Gérer GitHub inaccessible.
- [ ] Gérer l'authentification GitHub absente ou expirée.
- [ ] Gérer l'échec d'extraction d'un vaisseau.
- [ ] Gérer le dépassement du budget de triangles ou de taille.
- [ ] Gérer les fichiers `.glb` invalides.
- [ ] Gérer les échecs partiels du batch.
- [ ] Permettre l'annulation par l'utilisateur.
- [ ] Permettre la reprise d'un traitement interrompu.

## 8. Historique local

- [ ] Enregistrer chaque analyse.
- [ ] Enregistrer chaque extraction.
- [ ] Enregistrer chaque publication.
- [ ] Conserver la date, la version du jeu et le résultat.
- [ ] Permettre de consulter les erreurs d'une exécution précédente.
- [ ] Ajouter un bouton pour ouvrir le dossier de logs.

## 9. Tests et validation

- [ ] Tester la détection de versions avec plusieurs fichiers `Data.p4k`.
- [ ] Tester la comparaison entre version locale et version GitHub.
- [ ] Tester un nouveau vaisseau.
- [ ] Tester un vaisseau modifié.
- [ ] Tester un fichier déjà à jour.
- [ ] Tester une extraction échouée.
- [ ] Tester une QA échouée.
- [ ] Tester une publication GitHub réussie.
- [ ] Tester une perte de connexion pendant l'upload.
- [ ] Tester l'installation sur une machine Windows vierge.
- [ ] Tester la reprise après fermeture de l'application.

## MVP recommandé (périmètre figé — voir §0)

- [ ] Configurer les chemins StarBreaker et `Data.p4k` (`app-config.json` local, non commité).
- [ ] Détecter la version locale du jeu (`Data.p4k`, repli saisie manuelle).
- [ ] Lire la version publiée depuis `index.json`.
- [ ] Comparer les versions et calculer la raison par vaisseau (détection simple).
- [ ] **Galerie des 273 vaisseaux** : recherche + filtre « À traiter / Tout le catalogue ».
- [ ] **Vignettes SC Wiki** par vaisseau (cache disque, repli non bloquant).
- [ ] **Choix `Extérieur` / `Intérieur` par vaisseau** (puces cliquables sur les cartes).
- [ ] Ajouter le bouton **Analyser**.
- [ ] Ajouter le bouton **Extraire et optimiser** (streaming NDJSON de progression).
- [ ] Afficher les logs et la progression.
- [ ] Générer `index.json`.
- [ ] Ajouter le bouton **Publier sur GitHub**.
- [ ] Utiliser l'authentification GitHub CLI.
- [ ] Bloquer la publication si la QA échoue.

## Premier chantier technique

Rendre les scripts exécutables par l'application avec des paramètres configurables et des résultats JSON. Aujourd'hui, `release-patch.mjs` orchestre correctement les étapes locales, mais la publication reste manuelle et `batch-export.mjs` contient encore des chemins spécifiques à une machine.
