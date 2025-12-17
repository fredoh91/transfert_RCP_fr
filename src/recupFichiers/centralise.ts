import { logger } from '../logs_config.js';
import knex from 'knex';
import mysql from 'mysql2/promise';
import { getDonneesEuropeCleyrop } from './export_europe_cleyrop.js';


/**
 * Traitement principal pour le téléchargement et la gestion des RCP/Notices centralisés (Europe).
 * @param params 
 * @returns 
 */
export async function processerDocumentsCentralises(params: {
  poolCodexExtract: mysql.Pool,
  repCible?: string,
  dateFileStr: string,
  traitementRcpCentralise: boolean,

  idBatch: string,
  db: knex.Knex, 
  repCibleEURCPNotices?: string,
  maxFilesToProcess?: number
}): Promise<any[]> {
  const { poolCodexExtract, repCible, dateFileStr, traitementRcpCentralise, idBatch, db, repCibleEURCPNotices, maxFilesToProcess } = params;

  const repSourceEurope = process.env.REP_RCP_CENTRALISE_SOURCE;

  if (!traitementRcpCentralise) {
    logger.info('Traitement des documents centralisés (Europe) désactivé.');
    return [];
  }
  if (!repSourceEurope) {
    logger.warn('Variable REP_RCP_CENTRALISE_SOURCE non définie, traitement des documents centralisés (Europe) non effectué.');
    return [];
  }

  if (!repCible) {
    logger.warn('Répertoire cible principal non défini, traitement des documents centralisés (Europe) non effectué.');
    return [];
  }

  if (!repCibleEURCPNotices) {
    logger.warn('Répertoire cible pour les PDF centralisés non défini, traitement des documents centralisés (Europe) non effectué.');
    return [];
  }

  logger.info('Lancement du traitement des documents centralisés (Europe)...');
  try {
    const { data: processedData, fileCount: processedFileCount } = await getDonneesEuropeCleyrop({
      poolCodexExtract,
      repSource: repSourceEurope,
      repCibleEURCPNotices,
      db,
      idBatch,
      maxFilesToProcess,
      repCiblePrincipal: repCible!
    });
    return processedData;
  } catch (err) {
    logger.error({ err }, 'Erreur lors de la génération de l\'export Europe Cleyrop');
    return [];
  }
}
