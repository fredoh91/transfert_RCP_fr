import dotenv from 'dotenv';
import { createPoolCodexExtract, closePoolCodexExtract, getListeRCP } from './db/codex_extract.js';
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
  if (repCible) {
    await fs.mkdir(repCible, { recursive: true });
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
        // Pour SQLite, ids est un array d'objets ou de nombres selon la config
        idBatchRowId = typeof ids[0] === 'object' ? ids[0].id : ids[0];
      });

    // requete pour aller chercher la liste des RCP
    const listeRcp: ListeRCPRow[] = await getListeRCP(poolCodexExtract);

    let iCpt: number = 0;
    for (const rcp of listeRcp) {
      iCpt++;
      // console.log (iCpt);
      // console.log (rcp.hname, '_' , rcp.code_cis, '_' , rcp.dbo_classe_atc_lib_abr)

      const {statut, nouveauNom} = await copierFichierRCP(rcp.hname, rcp.code_cis, rcp.dbo_classe_atc_lib_abr, repCible!);
      const copieOK = await verifierCopieFichier(rcp.hname, rcp.code_cis, rcp.dbo_classe_atc_lib_abr, repCible!);

      await logCopieFichier({
        rep_fichier_source: repSource!, 
        nom_fichier_source: rcp.hname, 
        rep_fichier_cible: repCible!, 
        nom_fichier_cible: nouveauNom,
        code_cis: rcp.code_cis,
        code_atc: rcp.dbo_classe_atc_lib_abr,
        date_copie_rep_tempo: new Date().toISOString(),
        resultat_copie_rep_tempo: copieOK,   // 'FICHIER_COPIE' ou 'FICHIER_DEJA_PRESENT'
        date_copie_sftp: null,
        resultat_copie_sftp: null,   // 'FICHIER_COPIE' ou 'FICHIER_DEJA_PRESENT'
        id_batch: idBatch
      });

      // Transfert SFTP après la copie locale
      const localPath = path.join(repCible!, nouveauNom);
      const remoteSubDir = path.basename(repCible!); // ex: Extract_RCP_20250718
      await transferFichierSFTP(
        localPath,
        remoteSubDir,
        nouveauNom,
        idBatch,
        rcp.code_cis,
        rcp.dbo_classe_atc_lib_abr,
        db
      );

      if (iCpt >= 10) {
        console.log('Mode debug : arrêt après 10 fichiers');
        logger.info('Mode debug : arrêt après 10 fichiers');
        return;
      }

    }



  } catch (error) {
    logger.error({ err: error }, 'Erreur lors du traitement');
    process.exit(1);
  } finally {
    if (idBatchRowId !== undefined) {
      await db('liste_id_batch')
        .where({ id: idBatchRowId })
        .update({ fin_batch: new Date().toISOString() });
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