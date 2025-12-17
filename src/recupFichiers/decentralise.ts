import path from 'path';
import pLimit from 'p-limit';
import fsSync from 'fs';
import mysql from 'mysql2/promise';
import { ListeRCPRow } from '../types/liste_RCP_row';
import { getListeRCP, getListeNotice } from '../db/codex_extract.js';
import { logger } from '../logs_config.js';
import { copierFichierRCP, verifierCopieFichier } from './gestion_fichiers.js';
import { logCopieFichier } from '../db/copie_fichiers_db.js';
import knex from 'knex';

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Traitement principal pour le téléchargement et la gestion des RCP/Notices décentralisés.
 * @param params 
 * @returns 
 */
export async function processerDocumentsDecentralises(params: {
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

  maxFilesToProcess?: number
}): Promise<any[]> {
  const { poolCodexExtract, repCible, repCibleFR, repCibleRCP, repCibleNotices, repSource, idBatch, db, dateFileStr, traitementRcpDecentralise, maxFilesToProcess } = params;
  let fileCount = 0;

  const traitementRcp = traitementRcpDecentralise && process.env.TRAITEMENT_RCP === 'True';
  const traitementNotice = traitementRcpDecentralise && process.env.TRAITEMENT_NOTICE === 'True';

  if (traitementRcp) {
    logger.info('Début du sous-traitement RCP.');
    let listeRcp: ListeRCPRow[] = await getListeRCP(poolCodexExtract);
    if (maxFilesToProcess) {
      logger.info(`Application de la limite de ${maxFilesToProcess} fichiers pour les RCP.`);
      listeRcp = listeRcp.slice(0, maxFilesToProcess);
    }
    fileCount += listeRcp.length;
    let iCptRCP: number = 0;

    const limit = pLimit(parseInt(process.env.DECENTRALISE_CONCURRENCY_LIMIT || '5', 10));
    const rcpPromises = listeRcp.map(rcp => limit(async () => {
      iCptRCP++;
      try {
        const sanitizedCodeATC = (rcp.dbo_classe_atc_lib_abr || '').replace(/[\\/]/g, '');
        const codeATCComplet = sanitizedCodeATC.length < 7 ? sanitizedCodeATC.padEnd(7, "_") : sanitizedCodeATC;
        const extension = path.extname(rcp.hname);
        const nouveauNomCalcule = `R_${rcp.code_cis}_${codeATCComplet}${extension}`;
        const cheminCible = path.join(repCibleRCP!, nouveauNomCalcule);

        if (fsSync.existsSync(cheminCible)) {
          logger.info(`Fichier RCP déjà présent: ${cheminCible}`);
          const princepsGeneriqueValue = rcp.code_vuprinceps === null ? 'princeps_ou_pas_de_generique' : rcp.code_vuprinceps;
                    await logCopieFichier({
                      rep_fichier_source: repSource!,
                      nom_fichier_source: rcp.hname,
                      rep_fichier_cible: repCibleRCP!,
                      nom_fichier_cible: nouveauNomCalcule,
                      code_cis: rcp.code_cis,
                      code_atc: rcp.dbo_classe_atc_lib_abr,
                      date_copie_rep_tempo: new Date().toISOString(),
                      resultat_copie_rep_tempo: 'COPIE OK - fichier deja present',
                      id_batch: idBatch,
                      type_document: 'RCP',
                      lib_atc: rcp.dbo_classe_atc_lib_court,
                      nom_specialite: rcp.nom_vu,
                      princeps_generique: princepsGeneriqueValue,
                    });          return;
        }

        const {statut, nouveauNom} = await copierFichierRCP(rcp.hname, rcp.code_cis, rcp.dbo_classe_atc_lib_abr, repCibleRCP!);
        const minDelay = parseInt(process.env.DECENTRALISE_MIN_DELAY || '200', 10);
        const maxDelay = parseInt(process.env.DECENTRALISE_MAX_DELAY || '700', 10);
        await sleep(Math.random() * (maxDelay - minDelay) + minDelay);
        let copieOK: string;
        if (statut === "FICHIER_SOURCE_INTROUVABLE") {
          copieOK = "FICHIER_SOURCE_INTROUVABLE";
          logger.warn(`⚠️ RCP ${rcp.hname} introuvable, passage au fichier suivant`);
        } else {
          copieOK = await verifierCopieFichier(rcp.hname, rcp.code_cis, rcp.dbo_classe_atc_lib_abr, repCibleRCP!);
        }
                const princepsGeneriqueValue = rcp.code_vuprinceps === null ? 'princeps_ou_pas_de_generique' : rcp.code_vuprinceps;
                await logCopieFichier({
                  rep_fichier_source: repSource!,
                  nom_fichier_source: rcp.hname,
                  rep_fichier_cible: repCibleRCP!,
                  nom_fichier_cible: nouveauNom,
                  code_cis: rcp.code_cis,
                  code_atc: rcp.dbo_classe_atc_lib_abr,
                  date_copie_rep_tempo: new Date().toISOString(),
                  resultat_copie_rep_tempo: copieOK,
                  id_batch: idBatch,
                  type_document: 'RCP',
                  lib_atc: rcp.dbo_classe_atc_lib_court,
                  nom_specialite: rcp.nom_vu,
                  princeps_generique: princepsGeneriqueValue,
                });      }
      catch (error) {
        logger.error(`Erreur lors du traitement du RCP ${rcp.hname}:`, error);
      }
      if (maxFilesToProcess && iCptRCP >= maxFilesToProcess) {
        logger.info(`Limite de test atteinte (${maxFilesToProcess}) : arrêt du traitement des fichiers RCP.`);
      }
    }));
    await Promise.allSettled(rcpPromises);
  } else {
    logger.info('Sous-traitement RCP désactivé par la variable TRAITEMENT_RCP.');
  }

  if (traitementNotice) {
    logger.info('Début du sous-traitement Notices.');
    let listeNotices: ListeRCPRow[] = await getListeNotice(poolCodexExtract);
    if (maxFilesToProcess) {
      logger.info(`Application de la limite de ${maxFilesToProcess} fichiers pour les Notices.`);
      listeNotices = listeNotices.slice(0, maxFilesToProcess);
    }
    fileCount += listeNotices.length;
    let iCptNotice: number = 0;

    const limit = pLimit(parseInt(process.env.DECENTRALISE_CONCURRENCY_LIMIT || '5', 10));
    const noticePromises = listeNotices.map(notice => limit(async () => {
      iCptNotice++;
      try {
        const sanitizedCodeATC = (notice.dbo_classe_atc_lib_abr || '').replace(/[\\/]/g, '');
        const codeATCComplet = sanitizedCodeATC.length < 7 ? sanitizedCodeATC.padEnd(7, "_") : sanitizedCodeATC;
        const extension = path.extname(notice.hname);
        const nouveauNomCalcule = `N_${notice.code_cis}_${codeATCComplet}${extension}`;
        const cheminCible = path.join(repCibleNotices!, nouveauNomCalcule);

        if (fsSync.existsSync(cheminCible)) {
          logger.info(`Fichier Notice déjà présent: ${cheminCible}`);
          const princepsGeneriqueValue = notice.code_vuprinceps === null ? 'princeps_ou_pas_de_generique' : notice.code_vuprinceps;
                    await logCopieFichier({
                      rep_fichier_source: repSource!,
                      nom_fichier_source: notice.hname,
                      rep_fichier_cible: repCibleNotices!,
                      nom_fichier_cible: nouveauNomCalcule,
                      code_cis: notice.code_cis,
                      code_atc: notice.dbo_classe_atc_lib_abr,
                      date_copie_rep_tempo: new Date().toISOString(),
                      resultat_copie_rep_tempo: 'COPIE OK - fichier deja present',
                      id_batch: idBatch,
                      type_document: 'Notice',
                      lib_atc: notice.dbo_classe_atc_lib_court,
                      nom_specialite: notice.nom_vu,
                      princeps_generique: princepsGeneriqueValue,
                    });          return;
        }

        const {statut, nouveauNom} = await copierFichierRCP(notice.hname, notice.code_cis, notice.dbo_classe_atc_lib_abr, repCibleNotices!);
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
        const princepsGeneriqueValue = notice.code_vuprinceps === null ? 'princeps_ou_pas_de_generique' : notice.code_vuprinceps;
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
      }
    }));
    await Promise.allSettled(noticePromises);
  } else {
    logger.info('Sous-traitement Notices désactivé par la variable TRAITEMENT_NOTICE.');
  }

  const allProcessedDecentralisedData = await db('liste_fichiers_copies')
    .where({ id_batch: idBatch })
    .where(builder => builder.where('type_document', 'RCP').orWhere('type_document', 'Notice'))
    .select('*');

  return allProcessedDecentralisedData;
}
