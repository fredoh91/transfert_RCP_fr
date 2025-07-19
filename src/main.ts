import dotenv from 'dotenv';
import { createPoolCodexExtract, closePoolCodexExtract, getListeRCP, getListeNotice } from './db/codex_extract.js';
import { logger } from './logs_config.js';
import { ListeRCPRow } from './types/liste_RCP_row';
import {copierFichierRCP,verifierCopieFichier} from './gestion_fichiers.js';
import { logCopieFichier } from './copie_fichiers_db.js';
import knex from 'knex';
// @ts-ignore
import knexConfig from '../knexfile.cjs';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { exportListeFichiersCopiesExcel } from './export_excel.js';
import { transferFichierSFTP } from './sftp_transfert.js';
import { exportListeFichiersCopiesCleyropExcel } from './export_excel_cleyrop.js';
const db = knex(knexConfig.development);

dotenv.config({ debug: false });

async function main() {
  logger.info('Debut traitement');
  const poolCodexExtract = await createPoolCodexExtract();
  const repSource = process.env.REP_RCP_SOURCE;
  const baseRepCible = process.env.REP_RCP_CIBLE;
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const dateDirStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const dateFileStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const repCible = baseRepCible ? `${baseRepCible}/Extract_RCP_${dateDirStr}` : undefined;
  const repCibleRCP = repCible ? path.join(repCible, 'RCP') : undefined;
  const repCibleNotices = repCible ? path.join(repCible, 'Notices') : undefined;
  if (repCible) {
    await fs.mkdir(repCible, { recursive: true });
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

    // --- TRAITEMENT RCP ---
    const listeRcp: ListeRCPRow[] = await getListeRCP(poolCodexExtract);
    let iCptRCP: number = 0;
    for (const rcp of listeRcp) {
      iCptRCP++;
      const {statut, nouveauNom} = await copierFichierRCP(rcp.hname, rcp.code_cis, rcp.dbo_classe_atc_lib_abr, repCibleRCP!);
      const copieOK = await verifierCopieFichier(rcp.hname, rcp.code_cis, rcp.dbo_classe_atc_lib_abr, repCibleRCP!);
      await logCopieFichier({
        rep_fichier_source: repSource!, 
        nom_fichier_source: rcp.hname, 
        rep_fichier_cible: repCibleRCP!, 
        nom_fichier_cible: nouveauNom,
        code_cis: rcp.code_cis,
        code_atc: rcp.dbo_classe_atc_lib_abr,
        date_copie_rep_tempo: new Date().toISOString(),
        resultat_copie_rep_tempo: copieOK,
        date_copie_sftp: null,
        resultat_copie_sftp: null,
        id_batch: idBatch,
        type_document: 'RCP'
      });
      // Transfert SFTP après la copie locale
      const localPath = path.join(repCibleRCP!, nouveauNom);
      const remoteSubDir = path.posix.join(path.basename(repCible!), 'RCP');
      await transferFichierSFTP(
        localPath,
        remoteSubDir,
        nouveauNom,
        idBatch,
        rcp.code_cis,
        rcp.dbo_classe_atc_lib_abr,
        db
      );
      if (iCptRCP >= 10) {
        console.log('Mode debug : arrêt après 10 fichiers RCP');
        logger.info('Mode debug : arrêt après 10 fichiers RCP');
        break;
      }
    }

    // --- TRAITEMENT NOTICES ---
    const listeNotices: ListeRCPRow[] = await getListeNotice(poolCodexExtract);
    let iCptNotice: number = 0;
    for (const notice of listeNotices) {
      iCptNotice++;
      const {statut, nouveauNom} = await copierFichierRCP(notice.hname, notice.code_cis, notice.dbo_classe_atc_lib_abr, repCibleNotices!);
      const copieOK = await verifierCopieFichier(notice.hname, notice.code_cis, notice.dbo_classe_atc_lib_abr, repCibleNotices!);
      await logCopieFichier({
        rep_fichier_source: repSource!, 
        nom_fichier_source: notice.hname, 
        rep_fichier_cible: repCibleNotices!, 
        nom_fichier_cible: nouveauNom,
        code_cis: notice.code_cis,
        code_atc: notice.dbo_classe_atc_lib_abr,
        date_copie_rep_tempo: new Date().toISOString(),
        resultat_copie_rep_tempo: copieOK,
        date_copie_sftp: null,
        resultat_copie_sftp: null,
        id_batch: idBatch,
        type_document: 'Notice'
      });
      // Transfert SFTP après la copie locale
      const localPath = path.join(repCibleNotices!, nouveauNom);
      const remoteSubDir = path.posix.join(path.basename(repCible!), 'Notices');
      await transferFichierSFTP(
        localPath,
        remoteSubDir,
        nouveauNom,
        idBatch,
        notice.code_cis,
        notice.dbo_classe_atc_lib_abr,
        db
      );
      if (iCptNotice >= 10) {
        console.log('Mode debug : arrêt après 10 fichiers Notices');
        logger.info('Mode debug : arrêt après 10 fichiers Notices');
        break;
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
    await closePoolCodexExtract();
    logger.info('Fin traitement');
    if (repCible && idBatch) {
      // Export Excel complet (local uniquement)
      const excelFilePath = await exportListeFichiersCopiesExcel(db, idBatch, repCible, dateFileStr);
      if (excelFilePath) {
        logger.info(`Export Excel généré : ${excelFilePath}`);
      } else {
        logger.info('Aucune ligne à exporter pour ce batch.');
      }
      // Export Excel cleyrop (colonnes réduites)
      const cleyropExcelFilePath = await exportListeFichiersCopiesCleyropExcel(db, idBatch, repCible, dateFileStr);
      let cleyropExported = false;
      // Boucle de retry SFTP sur les KO
      const retryCount = parseInt(process.env.SFTP_RETRY_COUNT || '3', 10);
      let essais = 0;
      let encoreDesKO = true;
      while (essais < retryCount && encoreDesKO) {
        const lignesKO = await db('liste_fichiers_copies')
          .where({ id_batch: idBatch, resultat_copie_sftp: 'COPIE SFTP KO' });
        if (lignesKO.length === 0) {
          encoreDesKO = false;
          break;
        }
        for (const ligne of lignesKO) {
          const localPath = path.join(repCible, ligne.nom_fichier_cible);
          if (!fsSync.existsSync(localPath)) {
            await db('liste_fichiers_copies')
              .where({ id: ligne.id })
              .update({ resultat_copie_sftp: 'FICHIER LOCAL INEXISTANT' });
            logger.warn(`Fichier local inexistant pour ${ligne.nom_fichier_cible}`);
            continue;
          }
          await transferFichierSFTP(
            localPath,
            path.basename(repCible),
            ligne.nom_fichier_cible,
            idBatch,
            ligne.code_cis,
            ligne.code_atc,
            db
          );
        }
        essais++;
      }
      // Export SFTP du fichier cleyrop uniquement s'il n'y a plus de KO
      const lignesKOrestantes = await db('liste_fichiers_copies')
        .where({ id_batch: idBatch, resultat_copie_sftp: 'COPIE SFTP KO' });
      if (cleyropExcelFilePath && lignesKOrestantes.length === 0) {
        const remoteSubDir = path.basename(repCible);
        const cleyropExcelFileName = path.basename(cleyropExcelFilePath);
        try {
          await transferFichierSFTP(
            cleyropExcelFilePath,
            remoteSubDir,
            cleyropExcelFileName,
            idBatch,
            '', // codeCIS vide pour l'Excel
            '', // codeATC vide pour l'Excel
            db
          );
          logger.info(`Export Excel cleyrop transféré sur le SFTP : ${remoteSubDir}/${cleyropExcelFileName}`);
        } catch (err) {
          logger.error({ err }, 'Erreur lors du transfert SFTP du fichier Excel cleyrop');
        }
      } else if (cleyropExcelFilePath) {
        logger.warn('Des fichiers sont encore en échec SFTP, export cleyrop non transféré.');
      }
    }
    await db.destroy(); // <-- doit rester en dernier
  }
}

main();