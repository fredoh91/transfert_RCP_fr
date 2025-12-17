# Contexte du Projet : Transfert de fichiers RCP

## But Général
L'application a pour but de récupérer des fichiers HTML (RCP - Résumé des Caractéristiques du Produit) stockés dans un répertoire réseau, en se basant sur des informations provenant d'une base de données.

## Fonctionnalités Clés

### Phase 1 : Copie Locale
1.  **Sélection des médicaments :** Identifier et sélectionner les médicaments d'intérêt à partir d'une base de données Sybase nommée "CODEX".
2.  **Copie des fichiers :** Copier les fichiers RCP correspondants depuis un répertoire source vers un répertoire local dédié.
3.  **Renommage :** Renommer les fichiers pendant le processus de copie.

### Phase 2 : Transfert Externe et Logging
1.  **Envoi SFTP :** Envoyer les fichiers renommés vers un serveur distant via SFTP.
2.  **Vérification :** Confirmer que le transfert SFTP a réussi.
3.  **Logging :** Enregistrer le statut du transfert dans une base de données MySQL dédiée à ce projet.

## Architecture et Technologies
-   **Langage :** TypeScript
-   **Environnement :** Node.js
-   **Base de données (logging) :** MySQL

## Informations Importantes
-   **Fréquence d'exécution :** L'application sera exécutée mensuellement.
-   **Langue d'interaction :** Toujours me répondre en français.
---

## Plan d'amélioration du scraping (Diagnostic du 22/10/2025)

### Diagnostic

Le code dans `export_europe_cleyrop.ts` utilise une boucle `for...of` qui traite les URLs séquentiellement. C'est une bonne pratique pour éviter de surcharger le serveur, mais des requêtes successives trop rapides peuvent quand même être bloquées. Le script `gestion_pdf_centralise.ts` intègre déjà une logique de re-tentative avec délai exponentiel, ce qui est excellent pour la robustesse. Les suggestions suivantes visent à ajouter des mécanismes préventifs pour limiter les erreurs initiales.

### Suggestions et Astuces

#### 1. Ajouter un "Délai de Courtoisie" entre les requêtes

*   **Idée :** Forcer une petite pause (ex: 200-700ms) entre chaque téléchargement, même réussi, pour réduire la pression sur le serveur.
*   **Implémentation :** Ajouter un `await sleep(500);` dans la boucle `for...of` de `export_europe_cleyrop.ts` après l'appel de téléchargement. L'idéal serait de ne pas systématiquement faire un sleep(500), mais de faire legerement varier aléatoirement cette valeur de +0% a +50% afin de simuler un téléchargement manuel.

#### 2. Limiter la Concurrence (Worker Pool)

*   **Idée :** Traiter un nombre fixe de téléchargements en parallèle (ex: 5) pour un meilleur équilibre entre vitesse et respect du serveur.
*   **Implémentation :** Utiliser une librairie comme `p-limit` pour gérer une file d'attente de promesses avec une limite de concurrence.

#### 3. Utiliser des Connexions HTTP persistantes (Keep-Alive)

*   **Idée :** Réutiliser les connexions TCP pour plusieurs requêtes vers le même hôte afin d'améliorer l'efficacité et de paraître moins agressif.
*   **Implémentation :** Configurer `axios` dans `gestion_pdf_centralise.ts` pour utiliser un `https.Agent` avec l'option `keepAlive: true`.

#### 4. Changer le User-Agent

*   **Idée :** Masquer l'identité du script en utilisant un en-tête `User-Agent` de navigateur web commun.
*   **Implémentation :** Ajouter une option `headers: { 'User-Agent': '...' }` dans la configuration de la requête `axios`.

## Fonctionnalité a ajouter : exports excel post-extraction des fichiers R, N et E

dans la fonction main(), apres le commentaire "    // Exports Excel", il faut que tu ajoutes la création de deux fichiers excel a la racine du répertoire d'export (ex. /Extract_RCP_20251026/)

Ces deux fichiers seront les suivants :

1/ transfert_RcpNotice_cleyrop_AAAAMMJJ_HHMMSS.xlsx : (le nom doit etre construit avec la date et l'heure)

il concerne l'idBatch en cours dans la table liste_fichiers_copies.

Les colonnes qu'il doit contenir de cette table sont :

- nom_fichier_cible
- code_cis
- code_atc
- lib_atc
- nom_specialite
- princeps_generique
- type_document (RCP, Notice ou RCP_Notice_EU)
    - RCP si nom_fichier_cible commence par R
    - Notice si nom_fichier_cible commence par N
    - RCP_Notice_EU si nom_fichier_cible commence par E
- repertoire d'export :
    - \FR\RCP\ si nom_fichier_cible commence par R
    - \FR\Notices\ si nom_fichier_cible commence par N
    - \EU\RCP_Notices\ si nom_fichier_cible commence par E


2/ transfert_RcpNotice_AAAAMMJJ_HHMMSS.xlsx : (le nom doit etre construit avec la date et l'heure)


il concerne l'idBatch en cours dans la table liste_fichiers_copies.

Le fichier Excel doit contenir toutes les colonnes de cette table avec en plus :

- type_document (RCP, Notice ou RCP_Notice_EU)
    - RCP si nom_fichier_cible commence par R
    - Notice si nom_fichier_cible commence par N
    - RCP_Notice_EU si nom_fichier_cible commence par E
- repertoire d'export :
    - \FR\RCP\ si nom_fichier_cible commence par R
    - \FR\Notices\ si nom_fichier_cible commence par N
    - \EU\RCP_Notices\ si nom_fichier_cible commence par E


pour réaliser cet export tu peux t'inspirer et modifier les trois fichiers qui sont dans le répertoire /exportExcel/
