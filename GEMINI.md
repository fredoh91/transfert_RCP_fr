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