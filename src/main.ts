import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Détermine le chemin du répertoire du projet pour trouver le .env de manière fiable
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..'); // Remonte d'un niveau depuis /dist
dotenv.config({ path: path.join(projectRoot, '.env'), debug: false });

import { createPoolCodexExtract, closePoolCodexExtract } from './db/codex_extract.js';
import { logger } from './logs_config.js';
import knex from 'knex';
// @ts-ignore
import knexConfig from '../knexfile.cjs';
import fs from 'fs/promises';
import fsSync from 'fs';
import SftpClient from 'ssh2-sftp-client';

import { processerDocumentsDecentralises } from './recupFichiers/decentralise.js';
import { processerDocumentsCentralises } from './recupFichiers/centralise.js';
import { transferSFTPDecentralises, transferSFTPCentralise, transferExcelCleyrop } from './transfert/sftp.js';
import { exportCleyropPostExtraction, exportFullPostExtraction } from './exportExcel/export_post_extraction.js';

const db = knex(knexConfig.development);

// --- Gestion de l'argument --batch ---
const batchArgIndex = process.argv.indexOf('--batch');
const providedBatchId = batchArgIndex > -1 ? process.argv[batchArgIndex + 1] : null;


/**
 * Traite les documents décentralisés (RCP et Notices).
 * Récupère la liste des documents, les copie localement, les transfère par SFTP et loggue les opérations.
 */
// Les traitements lourds sont extraits dans des modules `src/recupFichiers/*` et `src/transfert/*`
async function main() {
  logger.info('Vérification de la base de données SQLite et application des migrations...');
  try {
    await db.migrate.latest();
    logger.info('La base de données est à jour.');
  } catch (error) {
    logger.error({ err: error }, "Échec de l'application des migrations de la base de données.");
    process.exit(1);
  }
  
  logger.info('Debut traitement');

  const transfertSftpDecentralise = process.env.TRANSFERT_SFTP_DECENTRALISE === 'True';
  const transfertSftpCentralise = process.env.TRANSFERT_SFTP_CENTRALISE === 'True';

  if (transfertSftpDecentralise) {
    logger.info('Le transfert SFTP décentralisé est activé.');
  } else {
    logger.info('Le transfert SFTP décentralisé est désactivé.');
  }

  if (transfertSftpCentralise) {
    logger.info('Le transfert SFTP centralisé est activé.');
  } else {
    logger.info('Le transfert SFTP centralisé est désactivé.');
  }

  const maxFilesToProcess = process.env.MAX_FILES_TO_PROCESS ? parseInt(process.env.MAX_FILES_TO_PROCESS, 10) : undefined;
  if (maxFilesToProcess) {
    logger.warn(`--- MODE TEST ACTIF --- Limite de traitement fixée à ${maxFilesToProcess} fichiers par type.`);
  }
  
  const traitementRcpCentralise = process.env.TRAITEMENT_RCP_CENTRALISE === 'True';
  const traitementRcpDecentralise = process.env.TRAITEMENT_RCP_DECENTRALISE === 'True';

  if (!traitementRcpCentralise && !traitementRcpDecentralise && !transfertSftpCentralise && !transfertSftpDecentralise) {
    logger.warn('Aucun traitement ni transfert n\'est activé. Arrêt du script.');
    process.exit(0);
  }

  const poolCodexExtract = await createPoolCodexExtract();
  const repSource = process.env.REP_RCP_SOURCE;
  const baseRepCible = process.env.REP_RCP_CIBLE;
  
  let idBatch: string;
  let dateDirStr: string;
  let dateFileStr: string;
  let idBatchRowId: number | undefined;

  if (providedBatchId) {
    logger.warn(`--- MODE REPRISE ACTIF --- Utilisation du batch existant : ${providedBatchId}`);
    idBatch = providedBatchId;
    
    // Valider que le batch existe en base
    const batchRow = await db('liste_id_batch').where({ id_batch: idBatch }).first();
    if (!batchRow) {
      logger.error(`Le batch ID ${idBatch} n'a pas été trouvé dans la base de données. Arrêt.`);
      process.exit(1);
    }
    idBatchRowId = batchRow.id;

    // Déduire les chemins à partir de l'ID du batch
    dateDirStr = idBatch.split('_')[0];
    dateFileStr = idBatch;

  } else {
    logger.info('--- MODE NORMAL --- Création d\'un nouveau batch.');
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    dateDirStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    dateFileStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    idBatch = dateFileStr;

    // Création de l'entrée en base uniquement en mode normal
    const ids = await db('liste_id_batch')
      .insert({
        id_batch: idBatch,
        debut_batch: new Date().toISOString()
      })
      .returning('id');
    idBatchRowId = typeof ids[0] === 'object' ? ids[0].id : ids[0];
  }


  const repCible = baseRepCible ? path.join(baseRepCible, `Extract_RCP_${dateDirStr}`) : undefined;

  // Création des sous-répertoires FR et EU
  const repCibleFR = repCible ? path.join(repCible, 'FR') : undefined;
  const repCibleEU = repCible ? path.join(repCible, 'EU') : undefined;
  const repCibleEURCPNotices = repCibleEU ? path.join(repCibleEU, 'RCP_Notices') : undefined;
  const repCibleRCP = repCibleFR ? path.join(repCibleFR, 'RCP') : undefined;
  const repCibleNotices = repCibleFR ? path.join(repCibleFR, 'Notices') : undefined;

  if (repCible && !providedBatchId) { // On ne recrée les répertoires qu'en mode normal
    await fs.mkdir(repCible, { recursive: true });
    if (repCibleFR) await fs.mkdir(repCibleFR, { recursive: true });
    if (repCibleEURCPNotices) await fs.mkdir(repCibleEURCPNotices, { recursive: true });
    if (repCibleEU) await fs.mkdir(repCibleEU, { recursive: true });
    if (repCibleRCP) await fs.mkdir(repCibleRCP, { recursive: true });
    if (repCibleNotices) await fs.mkdir(repCibleNotices, { recursive: true });
  }

  let sftp: SftpClient | undefined = undefined;

  try {
    // Le logging du début de batch est déjà fait ou récupéré
          
    // Récupération des fichiers Fr et EU en parallèle
    let decentralisePromise: Promise<any[]> = Promise.resolve([]);
    let centralisePromise: Promise<any[]> = Promise.resolve([]);

    // Extraction des fichiers Fr
    if (traitementRcpDecentralise) {
      decentralisePromise = processerDocumentsDecentralises({
        poolCodexExtract,
        repCible,
        repCibleFR,
        repCibleRCP,
        repCibleNotices,
        repSource,
        idBatch,
        db,
        dateFileStr,
        traitementRcpDecentralise,
        maxFilesToProcess,
      });
    } else {
      logger.info('Traitement décentralisé désactivé.');
    }

    // Extraction des fichiers Eu
    if (traitementRcpCentralise) {
      centralisePromise = processerDocumentsCentralises({
        poolCodexExtract,
        repCible: repCibleEU,
        dateFileStr,
        traitementRcpCentralise,
        idBatch,
        db,
        repCibleEURCPNotices,
        maxFilesToProcess,
      });
    } else {
      logger.info('Traitement centralisé désactivé.');
    }

    const results = await Promise.allSettled([
      decentralisePromise,
      centralisePromise
    ]);

    // Mettre à jour les statistiques uniquement si des traitements ont eu lieu
    if (traitementRcpDecentralise || traitementRcpCentralise) {
      let allProcessedData: any[] = [];
      let totalFilesProcessed = 0;

      if (results[0].status === 'fulfilled') {
        allProcessedData = allProcessedData.concat(results[0].value);
        totalFilesProcessed += results[0].value.length;
      } else {
        logger.error('Erreur lors du traitement décentralisé:', results[0].reason);
      }

      if (results[1].status === 'fulfilled') {
        allProcessedData = allProcessedData.concat(results[1].value);
        totalFilesProcessed += results[1].value.length;
      } else {
        logger.error('Erreur lors du traitement centralisé:', results[1].reason);
      }

      const nomFichierCibles = allProcessedData.map((item: any) => item.nom_fichier_cible);
      const countR = nomFichierCibles.filter((name: string) => name.startsWith('R')).length;
      const countN = nomFichierCibles.filter((name: string) => name.startsWith('N')).length;
      const countE = nomFichierCibles.filter((name: string) => name.startsWith('E')).length;

      if (idBatchRowId !== undefined) {
        await db('liste_id_batch')
          .where({ id: idBatchRowId })
          .update({ 
            nb_fichiers_traites: totalFilesProcessed,
            nb_fichiers_r: countR,
            nb_fichiers_n: countN,
            nb_fichiers_e: countE
          });
      }
      console.log(`Total des fichiers traités : ${totalFilesProcessed}`);
    }

    // Exports Excel
    // On les exécute uniquement si les traitements locaux étaient actifs
    let cleyropExcelPath: string | null = null;
    if (repCible && (traitementRcpDecentralise || traitementRcpCentralise)) {
      logger.info('Lancement des exports Excel post-extraction...');
      cleyropExcelPath = await exportCleyropPostExtraction(db, idBatch, repCible, dateFileStr);
      await exportFullPostExtraction(db, idBatch, repCible, dateFileStr);
      logger.info('Exports Excel post-extraction terminés.');
    } else if (repCible) {
      // En mode reprise, on essaie de retrouver le chemin du fichier Cleyrop
      const cleyropFileName = `transfert_RcpNotice_cleyrop_${dateFileStr}.xlsx`;
      const potentialPath = path.join(repCible, cleyropFileName);
      if(fsSync.existsSync(potentialPath)) {
        cleyropExcelPath = potentialPath;
        logger.info(`Fichier Cleyrop existant trouvé en mode reprise : ${cleyropExcelPath}`);
      }
    }

    // --- Lancement des transferts SFTP si activés ---
    if (transfertSftpDecentralise || transfertSftpCentralise) {
      // Initialiser et connecter le client SFTP
      
      sftp = new SftpClient();
      const SFTP_HOST = process.env.SFTP_HOST;
      const SFTP_PORT = process.env.SFTP_PORT ? parseInt(process.env.SFTP_PORT) : 22;
      const SFTP_USER = process.env.SFTP_USER;
      const SFTP_PRIVATE_KEY_PATH = process.env.SFTP_PRIVATE_KEY_PATH;

      if (!SFTP_HOST || !SFTP_USER || !SFTP_PRIVATE_KEY_PATH) {
        logger.error('Paramètres SFTP manquants dans le .env. Impossible de se connecter au SFTP.');
        throw new Error('Paramètres SFTP manquants dans le .env');
      }
      const privateKey = fsSync.readFileSync(SFTP_PRIVATE_KEY_PATH as string);
      logger.info(`Tentative de connexion SFTP à ${SFTP_HOST}:${SFTP_PORT} avec l'utilisateur ${SFTP_USER}`);
      await sftp.connect({
        host: SFTP_HOST as string,
        port: SFTP_PORT,
        username: SFTP_USER as string,
        privateKey
      });
      logger.info('Connexion SFTP réussie');

      // Augmenter la limite de listeners pour éviter les warnings en cas de forte concurrence
      const maxConcurrency = Math.max(
        parseInt(process.env.DECENTRALISE_CONCURRENCY_LIMIT || '5', 10),
        parseInt(process.env.CENTRALISE_CONCURRENCY_LIMIT || '5', 10),
        parseInt(process.env.DECENTRALISE_SFTP_CONCURRENCY_LIMIT || '5', 10),
        parseInt(process.env.CENTRALISE_SFTP_CONCURRENCY_LIMIT || '5', 10)
      );
      // @ts-ignore - La propriété 'client' existe sur l'instance mais n'est pas dans les types
      sftp.client.setMaxListeners(maxConcurrency + 5); // Ajout d'un tampon de sécurité

      // Transfert du fichier Excel Cleyrop s'il a été généré
      if (cleyropExcelPath && repCible) {
        await transferExcelCleyrop(sftp, cleyropExcelPath, repCible);
      }

      // Lancer les transferts SFTP dédiés (pilotés par la base de données)
      if (transfertSftpDecentralise) {
        await transferSFTPDecentralises({ sftp, idBatch, db, repCible, repCibleFR });
      }
      if (transfertSftpCentralise) {
        await transferSFTPCentralise({ sftp, idBatch, db, repCible, repCibleEU });
      }
    }



  } catch (error) {
    logger.error({ err: error }, 'Erreur lors du traitement');
    process.exit(1);
  } finally {
    if (idBatchRowId !== undefined) {
      const finBatch = new Date();
      // Récupérer debut_batch pour calculer la durée
      const row = await db('liste_id_batch').where({ id: idBatchRowId }).first();
      let tempTraitement = null;
      if (row && row.debut_batch) {
        const debutBatch = new Date(row.debut_batch);
        tempTraitement = Math.round((finBatch.getTime() - debutBatch.getTime()) / 1000); // en secondes
      }
      await db('liste_id_batch')
        .where({ id: idBatchRowId })
        .update({ fin_batch: finBatch.toISOString(), temp_traitement: tempTraitement });
    }
    // Enregistrement de la date de fin et du nombre de tables extraites
    logger.info('Fin traitement');
    await closePoolCodexExtract(); // Fermeture du pool Codex
    await db.destroy(); // <-- doit rester en dernier
  }
}

main();