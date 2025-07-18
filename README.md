# Documentation projet `transfert_RCP_fr`

## Sommaire

1. [Générer une clé SSH pour le SFTP](#générer-une-clé-ssh-pour-le-sftp)
2. [Initialiser la base SQLite (migrations)](#initialiser-la-base-sqlite-migrations)

---

# 1. Générer une clé SSH pour le SFTP

Ce guide explique comment générer une **paire de clés SSH dédiée** à ce projet, pour sécuriser les transferts SFTP automatisés.

## 1.1 Ouvrir un terminal

- Utilisez **Git Bash** (fourni avec Git pour Windows), **PowerShell**, ou le terminal de votre choix.

## 1.2 Générer la paire de clés SSH RSA

Exécutez la commande suivante :

```sh
ssh-keygen -t rsa -b 4096 -C "transfert_rcp_fr"
```

- `-t rsa` : type de clé RSA (classique, compatible partout).
- `-b 4096` : longueur de la clé (4096 bits, recommandé).
- `-C "transfert_rcp_fr"` : commentaire pour identifier la clé.

**Quand il demande le chemin du fichier** :
- Par défaut, il propose `D:/Users/<votre_user>/.ssh/id_rsa`
- **Entrez un nom spécifique** pour ce projet, par exemple :
  ```
  D:/Users/<votre_user>/.ssh/id_rsa_transfert_rcp_fr
  ```

**Quand il demande une passphrase** :
- Pour un script automatisé, vous pouvez laisser vide (appuyez sur Entrée).
- Pour plus de sécurité, vous pouvez en mettre une (il faudra la saisir à chaque usage).

## 1.3 Résultat

- **Clé privée** :  
  `D:/Users/<votre_user>/.ssh/id_rsa_transfert_rcp_fr`
- **Clé publique** :  
  `D:/Users/<votre_user>/.ssh/id_rsa_transfert_rcp_fr.pub`

## 1.4 Ajouter la clé publique sur le serveur SFTP

- Ouvrez le fichier `.pub` avec un éditeur de texte.
- Copiez son contenu dans le fichier `~/.ssh/authorized_keys` de l’utilisateur cible sur le serveur SFTP.

## 1.5 Utiliser la clé dans le script Node.js

Dans la configuration de `ssh2-sftp-client` :

```js
const sftpConfig = {
  host: 'adresse.du.serveur',
  port: 22,
  username: 'utilisateur',
  privateKey: require('fs').readFileSync('D:/Users/<votre_user>/.ssh/id_rsa_transfert_rcp_fr')
};
```

> **Remarque** : Ne partagez jamais la clé privée. Seule la clé publique doit être copiée sur le serveur distant.

---

# 2. Initialiser la base SQLite (migrations)

Le projet utilise **Knex** pour gérer la base SQLite et les migrations.

## 2.1 Prérequis
- Node.js et npm installés
- Toutes les dépendances du projet installées (`npm install`)

## 2.2 Lancer les migrations

Dans un terminal à la racine du projet, exécutez :

```sh
npx knex --knexfile knexfile.cjs migrate:latest
```

- Cette commande va créer la base SQLite (dans `logs/copie_fichiers.db`) et toutes les tables nécessaires.
- Les fichiers de migration se trouvent dans `src/db/migrations/`.

## 2.3 Pour réinitialiser la base (optionnel)

```sh
npx knex --knexfile knexfile.cjs migrate:rollback --all
npx knex --knexfile knexfile.cjs migrate:latest
```

Cela supprime toutes les tables puis les recrée. 