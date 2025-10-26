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

## Modification de la gestion de la récupération des fichiers et transfert par SFTP

   1. Remplacer `TYPE_TRANSFERT_SFTP` par deux nouvelles variables : TRANSFERT_SFTP_DECENTRALISE et TRANSFERT_SFTP_CENTRALISE.
   2. Modifier la condition de démarrage pour que le script s'exécute si l'un des quatre indicateurs (TRAITEMENT... ou
      TRANSFERT_SFTP...) est activé.
   3. Adapter la fonction `processerDocumentsDecentralises` :
       * Si TRAITEMENT_RCP_DECENTRALISE est True : copie locale puis transfert SFTP (si activé).
       * Si seul TRANSFERT_SFTP_DECENTRALISE est True : le script recherchera les fichiers décentralisés du dernier traitement
          et lancera uniquement leur transfert SFTP.
   4. Adapter la fonction `processerDocumentsCentralises` :
       * Si TRAITEMENT_RCP_CENTRALISE est True : téléchargement des PDF, génération de l'Excel, puis transfert SFTP de l'Excel
          ET de tous les PDF (si activé).
       * Si seul TRANSFERT_SFTP_CENTRALISE est True : le script recherchera les fichiers centralisés (Excel et PDF) du dernier
          traitement et lancera uniquement leur transfert SFTP.