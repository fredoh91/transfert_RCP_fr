# Documentation projet `transfert_RCP_fr`

## Sommaire

1. [Générer une clé SSH pour le SFTP](#générer-une-clé-ssh-pour-le-sftp)
2. [Initialiser la base SQLite (migrations)](#initialiser-la-base-sqlite-migrations)
3. [Lancement des scripts et configuration](#lancement-des-scripts-et-configuration)

---

# 1. Générer une clé SSH pour le SFTP

Ce guide explique comment générer une **paire de clés SSH dédiée** à ce projet, pour sécuriser les transferts SFTP automatisés.

## 1.1 Ouvrir un terminal

- Utilisez **Git Bash** (fourni avec Git pour Windows), **PowerShell**, ou le terminal de votre choix.

## 1.2 Générer la paire de clés SSH RSA

Exécutez la commande suivante :

```sh
ssh-keygen -t rsa -b 4096 -C "transfert_rcp_notice_fr"
ssh-keygen -t rsa -b 4096 -C "transfert_rcp_notice_fr" -f $HOME\.ssh\id_rsa_transfert_rcp_fr
```

- `-t rsa` : type de clé RSA (classique, compatible partout).
- `-b 4096` : longueur de la clé (4096 bits, recommandé).
- `-C "transfert_rcp_fr"` : commentaire pour identifier la clé.

Création du couple clef publique/privée pour le transfert SFTP via la machine "Chipeur"

```sh
ssh-keygen -t rsa -b 4096 -C "transfert_Cleyrop_Chipeur" -f $HOME\.ssh\transfert_Cleyrop_Chipeur
```

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

# 3. Lancement des scripts et configuration

## 3.1 Script principal

**Commande :**

```sh
npm run start
```

**Description :** Lance le traitement principal qui gère :

- La copie des documents décentralisés (RCP/Notices FR).
- Le traitement des documents centralisés (Europe), incluant la génération d'un fichier Excel et le téléchargement des PDF associés.
- Le transfert SFTP des fichiers générés.

**Variables d'environnement principales :**

| Variable | Description | Exemple |
|---|---|---|
| `TRAITEMENT_RCP_DECENTRALISE` | (True/False) **Interrupteur principal** pour le traitement décentralisé (FR). | `True` |
| `TRAITEMENT_RCP_CENTRALISE` | (True/False) **Interrupteur principal** pour le traitement centralisé (EU). | `True` |
| `TYPE_TRANSFERT_SFTP` | (True/False) Active ou désactive tous les transferts SFTP. | `True` |
| `REP_RCP_SOURCE` | Chemin source pour les fichiers RCP/Notices FR. | `\\par-lx-1143\DATA_MOCATOR\iMocaJouve\Mocahtml\` |
| `REP_RCP_CIBLE` | Répertoire de base où les exports seront créés. | `E:\RCP\` |
| `REP_RCP_CENTRALISE_SOURCE` | Chemin source pour le fichier CSV des RCP centralisés (EU). | `G:\DM-SURVEIL\MEDICAMENTS\BASES\BASES_DIVERSES\HCG\Echanges_DSI\` |
| `SFTP_HOST` | Adresse du serveur SFTP. | `sftp.ansm-secnum.cleyrop.net` |
| `SFTP_PORT` | Port du serveur SFTP. | `2222` |
| `SFTP_USER` | Nom d'utilisateur pour la connexion SFTP. | `transfert_rcp_fr` |
| `SFTP_PRIVATE_KEY_PATH` | Chemin absolu vers la clé SSH privée. | `D:\Users\Frannou\.ssh\id_rsa_transfert_rcp_fr` |
| `SFTP_REMOTE_BASE_DIR` | Répertoire de base sur le serveur SFTP. | `/transfert_rcp_fr` |
| `DL_EMA_RETRY_COUNT` | Nombre de tentatives de téléchargement pour un PDF européen en cas d'échec. | `3` |
| `SFTP_RETRY_COUNT` | Nombre de tentatives pour les transferts SFTP en échec (concerne les fichiers FR). | `3` |
| `MAX_FILES_TO_PROCESS` | (Optionnel) Limite le nombre de fichiers traités par catégorie pour les tests. | `5` |

## 3.2 Script de rattrapage (Europe)
**Commande :**
```sh
npm run rattrapage_rcp_eu
```

**Description :** Script dédié à la récupération des fichiers PDF européens qui ont échoué lors du dernier lancement du script principal. Il se base sur les logs de la base de données SQLite pour identifier les fichiers à traiter.

**Variables d'environnement principales :**

| Variable | Description | Exemple |
|---|---|---|
| `RELANCE_RATTRPAGE_EU` | (True/False) Si `True`, le script se relancera en boucle tant qu'il restera des fichiers en échec. | `True` |
| `TEMPO_AVANT_RELANCE_RATTRPAGE_EU` | Temps d'attente en secondes entre deux cycles de relance automatique. | `30` |
| `DL_EMA_RETRY_COUNT` | Nombre de tentatives pour chaque fichier lors d'un cycle de rattrapage. | `3` |


## 3.3 Lancement du script pour extraction des fichiers Eu et Fr sans upload SFTP

les paramètres dans le fichiers .env doivent etre les suivants :

# --- ÉTAPE 1 : TRAITEMENT LOCAL UNIQUEMENT ---
TRAITEMENT_RCP_DECENTRALISE=True
TRAITEMENT_RCP=True
TRAITEMENT_NOTICE=True
TRAITEMENT_RCP_CENTRALISE=True
TRANSFERT_SFTP_DECENTRALISE=False
TRANSFERT_SFTP_CENTRALISE=False

puis :

```sh
npm run start
```

## 3.4 Lancement du script d'upload SFTP de fichiers précédemment extraits

les paramètres dans le fichiers .env doivent etre les suivants :

# --- ÉTAPE 2 : TRANSFERT SFTP UNIQUEMENT ---
TRAITEMENT_RCP_DECENTRALISE=False
TRAITEMENT_RCP=False
TRAITEMENT_NOTICE=False
TRAITEMENT_RCP_CENTRALISE=False
TRANSFERT_SFTP_DECENTRALISE=True
TRANSFERT_SFTP_CENTRALISE=True

recupérer dans la table liste_id_batch, un id_batch (ex. 20251219_071507) correspondant a une extraction complete réussie (RCPs, notices et fichier Excel Cleyrop)

puis :

```sh
node dist/main.js --batch 20251219_071507
```
