import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Détermine le chemin du répertoire du projet pour trouver le .env de manière fiable
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..'); // Remonte d'un niveau depuis /dist
dotenv.config({ path: path.join(projectRoot, '.env'), debug: false });

import { createPoolCodexExtract, closePoolCodexExtract, getListeRCP, getListeNotice } from './db/codex_extract.js';
import { logger } from './logs_config.js';
import mysql from 'mysql2/promise';
import { ListeRCPRow } from './types/liste_RCP_row';
import { telechargerEtRenommerPdf } from './gestion_pdf_centralise.js'; // Importation nécessaire pour le nouveau fichier
import {copierFichierRCP,verifierCopieFichier} from './gestion_fichiers.js';
import { logCopieFichier } from './copie_fichiers_db.js';
import knex from 'knex';
// @ts-ignore
import knexConfig from '../knexfile.cjs';
import fs from 'fs/promises';
import fsSync from 'fs';
import { exportListeFichiersCopiesExcel } from './export_excel.js';
import { transferFichierSFTP } from './sftp_transfert.js';
import { exportListeFichiersCopiesCleyropExcel } from './export_excel_cleyrop.js';
import { exportEuropeCleyropExcel } from './export_europe_cleyrop.js';
import pLimit from 'p-limit';
async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const db = knex(knexConfig.development);

/**
 * Traite les documents décentralisés (RCP et Notices).
 * Récupère la liste des documents, les copie localement, les transfère par SFTP et loggue les opérations.
 */
async function processerDocumentsDecentralises(params: {
  poolCodexExtract: mysql.Pool,
  repCible?: string,
  repCibleFR?: string,
  repCibleRCP?: string,
  repCibleNotices?: string,
  repSource?: string,
  idBatch: string,
  db: knex.Knex,
  dateFileStr: string,
  traitementRcpDecentralise: boolean,
  transfertSftp: boolean,
  maxFilesToProcess?: number
}) {
  const { poolCodexExtract, repCible, repCibleFR, repCibleRCP, repCibleNotices, repSource, idBatch, db, dateFileStr, traitementRcpDecentralise, transfertSftp, maxFilesToProcess } = params;

  const traitementRcp = traitementRcpDecentralise && process.env.TRAITEMENT_RCP === 'True';
  const traitementNotice = traitementRcpDecentralise && process.env.TRAITEMENT_NOTICE === 'True';

  if (!traitementRcp && !traitementNotice && transfertSftp) {
    // Rattrapage SFTP pour les documents décentralisés

    const dernierBatch = await db('liste_id_batch').orderBy('debut_batch', 'desc').first();
    if (!dernierBatch) {
      logger.warn('Aucun batch précédent trouvé. Impossible de lancer le transfert SFTP seul.');
      return;
    }
    const idBatchPrecedent = dernierBatch.id_batch;
    logger.info(`Utilisation du dernier batch trouvé : ${idBatchPrecedent}`);

    const fichiersATransferer = await db('liste_fichiers_copies')
      .where({ id_batch: idBatchPrecedent })
      .where(function() {
        this.where('resultat_copie_sftp', '!=', 'COPIE OK').orWhereNull('resultat_copie_sftp');
      })
      .andWhere(function() {
        this.where('type_document', 'RCP').orWhere('type_document', 'Notice');
      });

    logger.info(`Nombre de fichiers à transférer : ${fichiersATransferer.length}`);

    for (const fichier of fichiersATransferer) {
      const subDir = fichier.type_document === 'RCP' ? 'RCP' : 'Notices';
      const localPath = path.join(repCibleFR!, subDir, fichier.nom_fichier_cible);
      const remoteSubDir = path.posix.join(path.basename(repCible!), 'FR', subDir);
      await transferFichierSFTP(localPath, remoteSubDir, fichier.nom_fichier_cible, idBatch, fichier.code_cis, fichier.code_atc, db);
    }
    return;
  }

  // --- TRAITEMENT RCP ---
  if (traitementRcp) {
    logger.info('Début du sous-traitement RCP.');
    const listeRcp: ListeRCPRow[] = await getListeRCP(poolCodexExtract);
    let iCptRCP: number = 0;

    const limit = pLimit(parseInt(process.env.DECENTRALISE_CONCURRENCY_LIMIT || '5', 10));
    const rcpPromises = listeRcp.map(rcp => limit(async () => {
      iCptRCP++;
      try {
        // Déterminer le nom de fichier cible en amont
        const sanitizedCodeATC = (rcp.dbo_classe_atc_lib_abr || '').replace(/[\\/]/g, '');
        const codeATCComplet = sanitizedCodeATC.length < 7 ? sanitizedCodeATC.padEnd(7, "_") : sanitizedCodeATC;
        const extension = path.extname(rcp.hname);
        const nouveauNomCalcule = `R_${rcp.code_cis}_${codeATCComplet}${extension}`;
        const cheminCible = path.join(repCibleRCP!, nouveauNomCalcule);

        // Vérifier si le fichier existe déjà
        if (fsSync.existsSync(cheminCible)) {
          logger.info(`Fichier RCP déjà présent: ${cheminCible}`);
          const princepsGeneriqueValue = rcp.code_vuprinceps === null ? 'princeps' : rcp.code_vuprinceps;
          await logCopieFichier({
            rep_fichier_source: repSource!, 
            nom_fichier_source: rcp.hname, 
            rep_fichier_cible: repCibleRCP!, 
            nom_fichier_cible: nouveauNomCalcule,
            code_cis: rcp.code_cis,
            code_atc: rcp.dbo_classe_atc_lib_abr,
            date_copie_rep_tempo: new Date().toISOString(),
            resultat_copie_rep_tempo: 'COPIE OK - fichier deja present',
            date_copie_sftp: null,
            resultat_copie_sftp: null,
            id_batch: idBatch,
            type_document: 'RCP',
            lib_atc: rcp.dbo_classe_atc_lib_court,
            nom_specialite: rcp.nom_vu,
            princeps_generique: princepsGeneriqueValue,
          });
          return; // Passer au fichier suivant
        }

        const {statut, nouveauNom} = await copierFichierRCP(rcp.hname, rcp.code_cis, rcp.dbo_classe_atc_lib_abr, repCibleRCP!);
        
        // Délai de courtoisie aléatoire
        const minDelay = parseInt(process.env.DECENTRALISE_MIN_DELAY || '200', 10);
        const maxDelay = parseInt(process.env.DECENTRALISE_MAX_DELAY || '700', 10);
        await sleep(Math.random() * (maxDelay - minDelay) + minDelay);
        
        let copieOK: string;
        if (statut === "FICHIER_SOURCE_INTROUVABLE") {
          copieOK = "FICHIER_SOURCE_INTROUVABLE";
          logger.warn(`⚠️ RCP ${rcp.hname} introuvable, passage au fichier suivant`);
        } else {
          copieOK = await verifierCopieFichier(rcp.hname, rcp.code_cis, rcp.dbo_classe_atc_lib_abr, repCibleRCP!);
          
          if (transfertSftp && copieOK === 'COPIE OK') {
            const localPath = path.join(repCibleRCP!, nouveauNom);
            const remoteSubDir = path.posix.join(path.basename(repCible!), 'FR', 'RCP');
            await transferFichierSFTP(localPath, remoteSubDir, nouveauNom, idBatch, rcp.code_cis, rcp.dbo_classe_atc_lib_abr, db);
          }
        }
        const princepsGeneriqueValue = rcp.code_vuprinceps === null ? 'princeps' : rcp.code_vuprinceps;
        await logCopieFichier({
          rep_fichier_source: repSource!, 
          nom_fichier_source: rcp.hname, 
          rep_fichier_cible: repCibleRCP!, 
          nom_fichier_cible: nouveauNom,
          code_cis: rcp.code_cis,
          code_atc: rcp.dbo_classe_atc_lib_abr,
          date_copie_rep_tempo: new Date().toISOString(),
          resultat_copie_rep_tempo: copieOK,
          date_copie_sftp: transfertSftp && copieOK === 'COPIE OK' ? new Date().toISOString() : null,
          resultat_copie_sftp: transfertSftp && copieOK === 'COPIE OK' ? 'COPIE OK' : null,
          id_batch: idBatch,
          type_document: 'RCP',
          lib_atc: rcp.dbo_classe_atc_lib_court,
          nom_specialite: rcp.nom_vu,
          princeps_generique: princepsGeneriqueValue,
        });
      }
      catch (error) {
        logger.error(`Erreur lors du traitement du RCP ${rcp.hname}:`, error);
      }
      if (maxFilesToProcess && iCptRCP >= maxFilesToProcess) {
        logger.info(`Limite de test atteinte (${maxFilesToProcess}) : arrêt du traitement des fichiers RCP.`);
        // Pas de break ici car on est dans un map, la limite sera gérée par le filtre en amont si nécessaire
      }
    }));
    await Promise.allSettled(rcpPromises);
  } else {
    logger.info('Sous-traitement RCP désactivé par la variable TRAITEMENT_RCP.');
  }

  // --- TRAITEMENT NOTICES ---
  if (traitementNotice) {
    logger.info('Début du sous-traitement Notices.');
    const listeNotices: ListeRCPRow[] = await getListeNotice(poolCodexExtract);
    let iCptNotice: number = 0;

    const limit = pLimit(parseInt(process.env.DECENTRALISE_CONCURRENCY_LIMIT || '5', 10));
    const noticePromises = listeNotices.map(notice => limit(async () => {
      iCptNotice++;
      try {
        // Déterminer le nom de fichier cible en amont
        const sanitizedCodeATC = (notice.dbo_classe_atc_lib_abr || '').replace(/[\\/]/g, '');
        const codeATCComplet = sanitizedCodeATC.length < 7 ? sanitizedCodeATC.padEnd(7, "_") : sanitizedCodeATC;
        const extension = path.extname(notice.hname);
        const nouveauNomCalcule = `N_${notice.code_cis}_${codeATCComplet}${extension}`;
        const cheminCible = path.join(repCibleNotices!, nouveauNomCalcule);

        // Vérifier si le fichier existe déjà
        if (fsSync.existsSync(cheminCible)) {
          logger.info(`Fichier Notice déjà présent: ${cheminCible}`);
          const princepsGeneriqueValue = notice.code_vuprinceps === null ? 'princeps' : notice.code_vuprinceps;
          await logCopieFichier({
            rep_fichier_source: repSource!, 
            nom_fichier_source: notice.hname, 
            rep_fichier_cible: repCibleNotices!, 
            nom_fichier_cible: nouveauNomCalcule,
            code_cis: notice.code_cis,
            code_atc: notice.dbo_classe_atc_lib_abr,
            date_copie_rep_tempo: new Date().toISOString(),
            resultat_copie_rep_tempo: 'COPIE OK - fichier deja present',
            date_copie_sftp: null,
            resultat_copie_sftp: null,
            id_batch: idBatch,
            type_document: 'Notice',
            lib_atc: notice.dbo_classe_atc_lib_court,
            nom_specialite: notice.nom_vu,
            princeps_generique: princepsGeneriqueValue,
          });
          return; // Passer au fichier suivant
        }

        const {statut, nouveauNom} = await copierFichierRCP(notice.hname, notice.code_cis, notice.dbo_classe_atc_lib_abr, repCibleNotices!);
        
        // Délai de courtoisie aléatoire
        const minDelay = parseInt(process.env.DECENTRALISE_MIN_DELAY || '200', 10);
        const maxDelay = parseInt(process.env.DECENTRALISE_MAX_DELAY || '700', 10);
        await sleep(Math.random() * (maxDelay - minDelay) + minDelay);
        
        let copieOK: string;
        if (statut === "FICHIER_SOURCE_INTROUVABLE") {
          copieOK = "FICHIER_SOURCE_INTROUVABLE";
          logger.warn(`⚠️ Notice ${notice.hname} introuvable, passage au fichier suivant`);
        } else {
          copieOK = await verifierCopieFichier(notice.hname, notice.code_cis, notice.dbo_classe_atc_lib_abr, repCibleNotices!);
        }
        
        if (transfertSftp && copieOK === 'COPIE OK') {
          const localPath = path.join(repCibleNotices!, nouveauNom);
          const remoteSubDir = path.posix.join(path.basename(repCible!), 'FR', 'Notices');
          await transferFichierSFTP(localPath, remoteSubDir, nouveauNom, idBatch, notice.code_cis, notice.dbo_classe_atc_lib_abr, db);
        }
        const princepsGeneriqueValue = notice.code_vuprinceps === null ? 'princeps' : notice.code_vuprinceps;
        await logCopieFichier({
          rep_fichier_source: repSource!, 
          nom_fichier_source: notice.hname, 
          rep_fichier_cible: repCibleNotices!, 
          nom_fichier_cible: nouveauNom,
          code_cis: notice.code_cis,
          code_atc: notice.dbo_classe_atc_lib_abr,
          date_copie_rep_tempo: new Date().toISOString(),
          resultat_copie_rep_tempo: copieOK,
          date_copie_sftp: transfertSftp && copieOK === 'COPIE OK' ? new Date().toISOString() : null,
          resultat_copie_sftp: transfertSftp && copieOK === 'COPIE OK' ? 'COPIE OK' : null,
          id_batch: idBatch,
          type_document: 'Notice',
          lib_atc: notice.dbo_classe_atc_lib_court,
          nom_specialite: notice.nom_vu,
          princeps_generique: princepsGeneriqueValue,
        });
      } catch (error) {
        logger.error(`Erreur lors du traitement de la notice ${notice.hname}:`, error);
      }
      if (maxFilesToProcess && iCptNotice >= maxFilesToProcess) {
        logger.info(`Limite de test atteinte (${maxFilesToProcess}) : arrêt du traitement des fichiers Notices.`);
        // Pas de break ici car on est dans un map, la limite sera gérée par le filtre en amont si nécessaire
      }
    }));
    await Promise.allSettled(noticePromises);
  } else {
    logger.info('Sous-traitement Notices désactivé par la variable TRAITEMENT_NOTICE.');
  }

  // --- EXPORTS ET RETRY SFTP POUR LE TRAITEMENT DÉCENTRALISÉ ---
  if (traitementRcp || traitementNotice) {
    logger.info('Fin du traitement décentralisé, génération des exports Excel FR...');
    
    // Export Excel complet (local uniquement dans le dossier FR)
    const excelFilePath = await exportListeFichiersCopiesExcel(db, idBatch, repCibleFR!, dateFileStr);
    if (excelFilePath) {
      logger.info(`Export Excel FR complet généré : ${excelFilePath}`);
    } else {
      logger.info('Aucune ligne à exporter pour le batch FR.');
    }

    // Export Excel cleyrop (colonnes réduites dans le dossier FR)
          const cleyropExcelFilePath = await exportListeFichiersCopiesCleyropExcel(db, idBatch, repCibleFR!, dateFileStr);
    
          if (transfertSftp) {      // Boucle de retry SFTP sur les KO des fichiers FR
      const retryCount = parseInt(process.env.SFTP_RETRY_COUNT || '3', 10);
      for (let i = 0; i < retryCount; i++) {
        const lignesKO = await db('liste_fichiers_copies')
          .where({ id_batch: idBatch, resultat_copie_sftp: 'COPIE SFTP KO' })
          .andWhere(builder => builder.where('type_document', 'RCP').orWhere('type_document', 'Notice'));

        if (lignesKO.length === 0) {
          logger.info('Aucun échec SFTP à retenter pour les fichiers FR.');
          break;
        }
        logger.warn(`Tentative de rattrapage SFTP n°${i + 1} pour ${lignesKO.length} fichier(s) FR...`);

        for (const ligne of lignesKO) {
          const subDir = ligne.type_document === 'RCP' ? 'RCP' : 'Notices';
          const localPath = path.join(repCibleFR!, subDir, ligne.nom_fichier_cible);
          const remoteSubDir = path.posix.join('FR', subDir);

          if (!fsSync.existsSync(localPath)) {
            await db('liste_fichiers_copies').where({ id: ligne.id }).update({ resultat_copie_sftp: 'FICHIER LOCAL INEXISTANT' });
            logger.warn(`Fichier local inexistant pour ${ligne.nom_fichier_cible}`);
            continue;
          }
          await transferFichierSFTP(localPath, remoteSubDir, ligne.nom_fichier_cible, idBatch, ligne.code_cis, ligne.code_atc, db);
        }
      }

      // Export SFTP du fichier cleyrop uniquement s'il n'y a plus de KO
      const lignesKOrestantes = await db('liste_fichiers_copies')
        .where({ id_batch: idBatch, resultat_copie_sftp: 'COPIE SFTP KO' })
        .andWhere(builder => builder.where('type_document', 'RCP').orWhere('type_document', 'Notice'));

      if (cleyropExcelFilePath && lignesKOrestantes.length === 0) {
        const remoteSubDir = path.posix.join(path.basename(repCible!), 'FR');
        const cleyropExcelFileName = path.basename(cleyropExcelFilePath);
        await transferFichierSFTP(cleyropExcelFilePath, remoteSubDir, cleyropExcelFileName, idBatch, '', '', db);
        logger.info(`Export Excel Cleyrop FR transféré sur le SFTP : ${remoteSubDir}/${cleyropExcelFileName}`);
      } else if (cleyropExcelFilePath) {
        logger.warn('Des fichiers FR sont encore en échec SFTP, l\'export Cleyrop FR n\'est pas transféré.');
      }
    } else if (cleyropExcelFilePath) {
      logger.warn("Transfert SFTP désactivé, l'export Cleyrop FR n'est pas envoyé.");
    }
  }
}

/**
 * Traite les documents centralisés (Europe Cleyrop).
 * Génère un fichier Excel à partir d'un CSV et le transfère par SFTP.
 */
async function processerDocumentsCentralises(params: {
  repCible?: string,
  dateFileStr: string,
  traitementRcpCentralise: boolean,
  transfertSftp: boolean,
  idBatch: string,
  db: knex.Knex, 
  repCibleEURCPNotices?: string, // Nouveau paramètre
  maxFilesToProcess?: number
}) { 
  const { repCible, dateFileStr, traitementRcpCentralise, transfertSftp, idBatch, db, repCibleEURCPNotices, maxFilesToProcess } = params;

  const repSourceEurope = process.env.REP_RCP_CENTRALISE_SOURCE;

  if (!traitementRcpCentralise && transfertSftp) {
    // Rattrapage SFTP pour les documents centralisés
    const dernierBatch = await db('liste_id_batch').orderBy('debut_batch', 'desc').first();
    if (!dernierBatch) {
      logger.warn('Aucun batch précédent trouvé. Impossible de lancer le transfert SFTP seul.');
      return;
    }
    const idBatchPrecedent = dernierBatch.id_batch;
    logger.info(`Utilisation du dernier batch trouvé : ${idBatchPrecedent}`);

    const fichiersATransferer = await db('liste_fichiers_copies')
      .where({ id_batch: idBatchPrecedent })
      .where(function() {
        this.where('resultat_copie_sftp', '!=', 'COPIE OK').orWhereNull('resultat_copie_sftp');
      })
      .andWhere(function() {
        this.where('type_document', 'RCP_CENTRALISE').orWhere('type_document', 'EXCEL_CENTRALISE');
      });

    logger.info(`Nombre de fichiers à transférer : ${fichiersATransferer.length}`);

    for (const fichier of fichiersATransferer) {
      const subDir = fichier.type_document === 'RCP_CENTRALISE' ? 'RCP_Notices' : '';
      const localPath = path.join(repCible!, subDir, fichier.nom_fichier_cible);

      if (!fsSync.existsSync(localPath)) {
        logger.warn(`Le fichier local ${localPath} n'existe pas. Mise à jour du statut en "FICHIER LOCAL INEXISTANT".`);
        await db('liste_fichiers_copies').where({ id: fichier.id }).update({ resultat_copie_sftp: 'FICHIER LOCAL INEXISTANT' });
        continue;
      }

      const remoteSubDir = path.posix.join('EU', subDir);
      await transferFichierSFTP(localPath, remoteSubDir, fichier.nom_fichier_cible, idBatch, fichier.code_cis, fichier.code_atc, db);
    }
    return;
  }

  if (!traitementRcpCentralise) {
    logger.info('Traitement des documents centralisés (Europe) désactivé.');
    return;
  }
  if (!repSourceEurope) {
    logger.warn('Variable REP_RCP_CENTRALISE_SOURCE non définie, traitement des documents centralisés (Europe) non effectué.');
    return;
  }

  if (!repCible) {
    logger.warn('Répertoire cible principal non défini, traitement des documents centralisés (Europe) non effectué.');
    return;
  }

  if (!repCibleEURCPNotices) {
    logger.warn('Répertoire cible pour les PDF centralisés non défini, traitement des documents centralisés (Europe) non effectué.');
    return;
  }

  logger.info('Lancement du traitement des documents centralisés (Europe)...');
  let poolEurope: mysql.Pool | null = null;
  try {
    poolEurope = await createPoolCodexExtract();
    const europeExcelFilePath = await exportEuropeCleyropExcel({
      poolCodexExtract: poolEurope,
      repSource: repSourceEurope,
      repCible: repCible,
      dateFileStr, 
      repCibleEURCPNotices,
      db,
      idBatch,
      maxFilesToProcess
    });

    if (europeExcelFilePath) {
      logger.info(`Export Europe Cleyrop généré : ${europeExcelFilePath}`);
      if (transfertSftp) {
        const remoteSubDir = path.posix.join(path.basename(repCible!), 'EU');
        const europeExcelFileName = path.basename(europeExcelFilePath);
        try {
          await transferFichierSFTP(europeExcelFilePath, remoteSubDir, europeExcelFileName, idBatch, '', '', db);          
        } catch (err) {
          logger.error({ err }, 'Erreur lors du transfert SFTP du fichier Europe Cleyrop');
        }
      } else {
        logger.warn("Transfert SFTP désactivé, l'export Europe Cleyrop n'est pas envoyé.");
      }
    } else {
      logger.warn('Aucun fichier Europe Cleyrop généré.');
    }
  } catch (err) {
    logger.error({ err }, 'Erreur lors de la génération de l\'export Europe Cleyrop');
  } finally {
    if (poolEurope) {
      await closePoolCodexExtract();
    }
  }
}

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
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const dateDirStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const dateFileStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const repCible = baseRepCible ? `${baseRepCible}/Extract_RCP_${dateDirStr}` : undefined;

  // Création des sous-répertoires FR et EU
  const repCibleFR = repCible ? path.join(repCible, 'FR') : undefined;
  const repCibleEU = repCible ? path.join(repCible, 'EU') : undefined;
  const repCibleEURCPNotices = repCibleEU ? path.join(repCibleEU, 'RCP_Notices') : undefined; // Nouveau répertoire
  const repCibleRCP = repCibleFR ? path.join(repCibleFR, 'RCP') : undefined;
  const repCibleNotices = repCibleFR ? path.join(repCibleFR, 'Notices') : undefined;

  if (repCible) {
    await fs.mkdir(repCible, { recursive: true });
    if (repCibleFR) await fs.mkdir(repCibleFR, { recursive: true });
    if (repCibleEURCPNotices) await fs.mkdir(repCibleEURCPNotices, { recursive: true }); // Création du nouveau répertoire
    if (repCibleEU) await fs.mkdir(repCibleEU, { recursive: true });
    if (repCibleRCP) await fs.mkdir(repCibleRCP, { recursive: true });
    if (repCibleNotices) await fs.mkdir(repCibleNotices, { recursive: true });
  }

  const idBatch = 
    now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) + '_' +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds());

  let idBatchRowId: number | undefined = undefined;

  try {
    const debutBatch = new Date();
    await db('liste_id_batch')
      .insert({
        id_batch: idBatch,
        debut_batch: new Date().toISOString()
      })
      .returning('id')
      .then((ids) => {
        idBatchRowId = typeof ids[0] === 'object' ? ids[0].id : ids[0];
      });

    // --- TRAITEMENT DES DOCUMENTS DÉCENTRALISÉS (RCP & NOTICES) ---
    if (traitementRcpDecentralise || transfertSftpDecentralise) {
      await processerDocumentsDecentralises({
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
        transfertSftp: transfertSftpDecentralise,
        maxFilesToProcess
      });
    } else {
      logger.info('Traitement et transfert des documents décentralisés désactivés.');
    }

    // === Export Europe Cleyrop ===
    if (traitementRcpCentralise || transfertSftpCentralise) {
      await processerDocumentsCentralises({
        repCible: repCibleEU,
        dateFileStr,
        traitementRcpCentralise,
        transfertSftp: transfertSftpCentralise,
        idBatch,
        db,
        repCibleEURCPNotices, // Passage du nouveau paramètre
        maxFilesToProcess
      });
    } else {
      logger.info('Traitement et transfert des documents centralisés désactivés.');
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
    await db.destroy(); // <-- doit rester en dernier
  }
}

main();