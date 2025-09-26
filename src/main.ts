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
  typeTransfertSftp: boolean,
  maxFilesToProcess?: number
}) {
  const { poolCodexExtract, repCible, repCibleFR, repCibleRCP, repCibleNotices, repSource, idBatch, db, dateFileStr, typeTransfertSftp } = params;

  const traitementRcp = process.env.TRAITEMENT_RCP === 'True';
  const traitementNotice = process.env.TRAITEMENT_NOTICE === 'True';

  // --- TRAITEMENT RCP ---
  if (traitementRcp) {
    logger.info('Début du sous-traitement RCP.');
    const listeRcp: ListeRCPRow[] = await getListeRCP(poolCodexExtract);
    let iCptRCP: number = 0;
    for (const rcp of listeRcp) {
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
          });
          continue; // Passer au fichier suivant
        }

        const {statut, nouveauNom} = await copierFichierRCP(rcp.hname, rcp.code_cis, rcp.dbo_classe_atc_lib_abr, repCibleRCP!);
        
        let copieOK: string;
        if (statut === "FICHIER_SOURCE_INTROUVABLE") {
          copieOK = "FICHIER_SOURCE_INTROUVABLE";
          logger.warn(`⚠️ RCP ${rcp.hname} introuvable, passage au fichier suivant`);
        } else {
          copieOK = await verifierCopieFichier(rcp.hname, rcp.code_cis, rcp.dbo_classe_atc_lib_abr, repCibleRCP!);
          
          if (typeTransfertSftp && copieOK === 'COPIE OK') {
            const localPath = path.join(repCibleRCP!, nouveauNom);
            const remoteSubDir = path.posix.join(path.basename(path.dirname(repCibleRCP!)), 'RCP');
            await transferFichierSFTP(localPath, remoteSubDir, nouveauNom, idBatch, rcp.code_cis, rcp.dbo_classe_atc_lib_abr, db);
          }
        }
        
        await logCopieFichier({
          rep_fichier_source: repSource!, 
          nom_fichier_source: rcp.hname, 
          rep_fichier_cible: repCibleRCP!, 
          nom_fichier_cible: nouveauNom,
          code_cis: rcp.code_cis,
          code_atc: rcp.dbo_classe_atc_lib_abr,
          date_copie_rep_tempo: new Date().toISOString(),
          resultat_copie_rep_tempo: copieOK,
          date_copie_sftp: typeTransfertSftp && copieOK === 'COPIE OK' ? new Date().toISOString() : null,
          resultat_copie_sftp: typeTransfertSftp && copieOK === 'COPIE OK' ? 'COPIE OK' : null,
          id_batch: idBatch,
          type_document: 'RCP',
          lib_atc: rcp.dbo_classe_atc_lib_court,
          nom_specialite: rcp.nom_vu, 
        });
      } catch (error) {
        logger.error(`Erreur lors du traitement du RCP ${rcp.hname}:`, error);
        continue;
      }
      if (params.maxFilesToProcess && iCptRCP >= params.maxFilesToProcess) {
        logger.info(`Limite de test atteinte (${params.maxFilesToProcess}) : arrêt du traitement des fichiers RCP.`);
        break;
      }
    }
  } else {
    logger.info('Sous-traitement RCP désactivé par la variable TRAITEMENT_RCP.');
  }

  // --- TRAITEMENT NOTICES ---
  if (traitementNotice) {
    logger.info('Début du sous-traitement Notices.');
    const listeNotices: ListeRCPRow[] = await getListeNotice(poolCodexExtract);
    let iCptNotice: number = 0;
    for (const notice of listeNotices) {
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
          });
          continue; // Passer au fichier suivant
        }

        const {statut, nouveauNom} = await copierFichierRCP(notice.hname, notice.code_cis, notice.dbo_classe_atc_lib_abr, repCibleNotices!);
        
        let copieOK: string;
        if (statut === "FICHIER_SOURCE_INTROUVABLE") {
          copieOK = "FICHIER_SOURCE_INTROUVABLE";
          logger.warn(`⚠️ Notice ${notice.hname} introuvable, passage au fichier suivant`);
        } else {
          copieOK = await verifierCopieFichier(notice.hname, notice.code_cis, notice.dbo_classe_atc_lib_abr, repCibleNotices!);
        }
        
        if (typeTransfertSftp && copieOK === 'COPIE OK') {
          const localPath = path.join(repCibleNotices!, nouveauNom);
          const remoteSubDir = path.posix.join(path.basename(path.dirname(repCibleNotices!)), 'Notices');
          await transferFichierSFTP(localPath, remoteSubDir, nouveauNom, idBatch, notice.code_cis, notice.dbo_classe_atc_lib_abr, db);
        }
        
        await logCopieFichier({
          rep_fichier_source: repSource!, 
          nom_fichier_source: notice.hname, 
          rep_fichier_cible: repCibleNotices!, 
          nom_fichier_cible: nouveauNom,
          code_cis: notice.code_cis,
          code_atc: notice.dbo_classe_atc_lib_abr,
          date_copie_rep_tempo: new Date().toISOString(),
          resultat_copie_rep_tempo: copieOK,
          date_copie_sftp: typeTransfertSftp && copieOK === 'COPIE OK' ? new Date().toISOString() : null,
          resultat_copie_sftp: typeTransfertSftp && copieOK === 'COPIE OK' ? 'COPIE OK' : null,
          id_batch: idBatch,
          type_document: 'Notice',
          lib_atc: notice.dbo_classe_atc_lib_court,
          nom_specialite: notice.nom_vu,
        });
      } catch (error) {
        logger.error(`Erreur lors du traitement de la notice ${notice.hname}:`, error);
        continue;
      }
      if (params.maxFilesToProcess && iCptNotice >= params.maxFilesToProcess) {
        logger.info(`Limite de test atteinte (${params.maxFilesToProcess}) : arrêt du traitement des fichiers Notices.`);
        break;
      }
    }
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

    if (typeTransfertSftp) {
      // Boucle de retry SFTP sur les KO des fichiers FR
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
        const remoteSubDir = path.basename(path.dirname(cleyropExcelFilePath)); // 'FR'
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
  typeTransfertSftp: boolean,
  idBatch: string,
  db: knex.Knex, 
  repCibleEURCPNotices?: string, // Nouveau paramètre
  maxFilesToProcess?: number
}) { 
  const { repCible, dateFileStr, typeTransfertSftp, idBatch, db, repCibleEURCPNotices, maxFilesToProcess } = params;

  const traitementRcpCentralise = process.env.TRAITEMENT_RCP_CENTRALISE === 'True';
  const repSourceEurope = process.env.REP_RCP_CENTRALISE_SOURCE;

  if (!traitementRcpCentralise) {
    logger.info('Traitement des documents centralisés (Europe) désactivé par la variable TRAITEMENT_RCP_CENTRALISE.');
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
      if (typeTransfertSftp) {
        const remoteSubDir = path.basename(path.dirname(europeExcelFilePath));
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

  const typeTransfertSftp = process.env.TYPE_TRANSFERT_SFTP === 'True';
  if (typeTransfertSftp) {
    logger.info('Le transfert SFTP est activé.');
  } else {
    logger.info('Le transfert SFTP est désactivé.');
  }

  const maxFilesToProcess = process.env.MAX_FILES_TO_PROCESS ? parseInt(process.env.MAX_FILES_TO_PROCESS, 10) : undefined;
  if (maxFilesToProcess) {
    logger.warn(`--- MODE TEST ACTIF --- Limite de traitement fixée à ${maxFilesToProcess} fichiers par type.`);
  }
  
  const traitementRcpCentralise = process.env.TRAITEMENT_RCP_CENTRALISE === 'True';
  const traitementRcpDecentralise = process.env.TRAITEMENT_RCP_DECENTRALISE === 'True';

  if (!traitementRcpCentralise && !traitementRcpDecentralise) {
    logger.warn('Aucun traitement RCP ni Notice ni RCP Centralisé ni RCP Décentralisé n\'est activé. Arrêt du script.');
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
    if (traitementRcpDecentralise) {
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
        typeTransfertSftp,
        maxFilesToProcess
      });
    } else {
      logger.info('Traitement des documents décentralisés (RCP & Notices) désactivé par la variable TRAITEMENT_RCP_DECENTRALISE.');
    }

    // === Export Europe Cleyrop ===
    await processerDocumentsCentralises({
      repCible: repCibleEU,
      dateFileStr,
      typeTransfertSftp,
      idBatch,
      db,
      repCibleEURCPNotices, // Passage du nouveau paramètre
      maxFilesToProcess
    });

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