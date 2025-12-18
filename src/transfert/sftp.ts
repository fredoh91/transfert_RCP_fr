import path from 'path';
import pLimit from 'p-limit';
import fsSync from 'fs';
import { logger } from '../logs_config.js';
import knex from 'knex';
import { transferFichierSFTP } from './sftp_transfert.js';
import SftpClient from 'ssh2-sftp-client';

/**
 * 
 * @param params 
 * @returns 
 */
export async function transferSFTPDecentralises(params: {
  sftp: SftpClient,
  idBatch: string,
  db: knex.Knex,
  repCible?: string,
  repCibleFR?: string,
}) {
  const { sftp, idBatch, db, repCible, repCibleFR } = params;

  logger.info('Début du transfert SFTP pour les documents décentralisés (FR)...');

  const fichiersATransferer = await db('liste_fichiers_copies')
    .where({ id_batch: idBatch })
    .where(function() {
      this.where('resultat_copie_sftp', '!=', 'COPIE OK').orWhereNull('resultat_copie_sftp');
    })
    .andWhere(function() {
      this.where('type_document', 'RCP').orWhere('type_document', 'Notice');
    });

  if (fichiersATransferer.length === 0) {
    logger.info('Aucun fichier FR à transférer par SFTP.');
    return;
  }

  logger.info(`Nombre de fichiers FR à transférer : ${fichiersATransferer.length}`);

  const limit = pLimit(parseInt(process.env.DECENTRALISE_SFTP_CONCURRENCY_LIMIT || '5', 10));
  const sftpPromises = fichiersATransferer.map(fichier => limit(async () => {
    const subDir = fichier.type_document === 'RCP' ? 'RCP' : 'Notices';
    const localPath = path.join(repCibleFR!, subDir, fichier.nom_fichier_cible);
    const remoteSubDir = path.posix.join(path.basename(repCible!), 'FR', subDir);

    if (!fsSync.existsSync(localPath)) {
      await db('liste_fichiers_copies').where({ id: fichier.id }).update({ resultat_copie_sftp: 'FICHIER LOCAL INEXISTANT' });
      logger.warn(`Fichier local inexistant pour ${fichier.nom_fichier_cible}`);
      return;
    }
    await transferFichierSFTP(sftp, localPath, remoteSubDir, fichier.nom_fichier_cible, idBatch, fichier.code_cis, fichier.code_atc, db);
  }));
  await Promise.allSettled(sftpPromises);
  logger.info('Fin du transfert SFTP pour les documents décentralisés (FR).');
}

/**
 * 
 * @param params 
 * @returns 
 */
export async function transferSFTPCentralise(params: {
  sftp: SftpClient,
  idBatch: string,
  db: knex.Knex,
  repCible?: string,
  repCibleEU?: string,
}) {
  const { sftp, idBatch, db, repCible, repCibleEU } = params;

  logger.info('Début du transfert SFTP pour les documents centralisés (EU)...');

  const fichiersATransferer = await db('liste_fichiers_copies')
    .where({ id_batch: idBatch })
    .where(function() {
      this.where('resultat_copie_sftp', '!=', 'COPIE OK').orWhereNull('resultat_copie_sftp');
    })
    .andWhere(function() {
      this.where('type_document', 'RCP_Notice_EU').orWhere('type_document', 'EXCEL_CENTRALISE');
    });

  if (fichiersATransferer.length === 0) {
    logger.info('Aucun fichier EU à transférer par SFTP.');
    return;
  }

  logger.info(`Nombre de fichiers EU à transférer : ${fichiersATransferer.length}`);

  const limit = pLimit(parseInt(process.env.CENTRALISE_SFTP_CONCURRENCY_LIMIT || '5', 10));
  const sftpPromises = fichiersATransferer.map(fichier => limit(async () => {
    let localPath = '';
    let remoteSubDir = '';

    if (fichier.type_document === 'RCP_Notice_EU') {
      localPath = path.join(repCibleEU!, 'RCP_Notices', fichier.nom_fichier_cible);
      remoteSubDir = path.posix.join(path.basename(repCible!), 'EU', 'RCP_Notices');
    } else if (fichier.type_document === 'EXCEL_CENTRALISE') {
      localPath = path.join(repCibleEU!, fichier.nom_fichier_cible);
      remoteSubDir = path.posix.join(path.basename(repCible!), 'EU');
    }

    if (!fsSync.existsSync(localPath)) {
      await db('liste_fichiers_copies').where({ id: fichier.id }).update({ resultat_copie_sftp: 'FICHIER LOCAL INEXISTANT' });
      logger.warn(`Fichier local inexistant pour ${fichier.nom_fichier_cible}`);
      return;
    }
    await transferFichierSFTP(sftp, localPath, remoteSubDir, fichier.nom_fichier_cible, idBatch, fichier.code_cis, fichier.code_atc, db);
  }));
  await Promise.allSettled(sftpPromises);
  logger.info('Fin du transfert SFTP pour les documents centralisés (EU).');
}

/**
 * Transfère le fichier Excel Cleyrop via SFTP.
 * Ne logue pas en base de données.
 * @param sftp - Le client SFTP connecté.
 * @param localFilePath - Le chemin complet du fichier Excel local à transférer.
 * @param repCible - Le répertoire de base de l'extraction (ex: .../Extract_RCP_20251026).
 */
export async function transferExcelCleyrop(
  sftp: SftpClient,
  localFilePath: string,
  repCible: string,
) {
  if (!process.env.SFTP_REMOTE_BASE_DIR) {
    logger.error('[SFTP Cleyrop] Variable SFTP_REMOTE_BASE_DIR manquante. Transfert annulé.');
    return;
  }
  if (!fsSync.existsSync(localFilePath)) {
    logger.error(`[SFTP Cleyrop] Fichier local non trouvé, impossible de le transférer : ${localFilePath}`);
    return;
  }

  const remoteFileName = path.basename(localFilePath);
  // Le répertoire distant est la base SFTP + le nom du répertoire d'extraction du jour.
  const remoteDir = path.posix.join(process.env.SFTP_REMOTE_BASE_DIR, path.basename(repCible));
  const remoteFilePath = path.posix.join(remoteDir, remoteFileName);

  logger.info(`[SFTP Cleyrop] Début du transfert du fichier Excel Cleyrop vers ${remoteFilePath}`);

  try {
    await sftp.mkdir(remoteDir, true);
    await sftp.fastPut(localFilePath, remoteFilePath);
    
    // Vérification simple par la taille
    const remoteStats = await sftp.stat(remoteFilePath);
    const localStats = fsSync.statSync(localFilePath);

    if (localStats.size === remoteStats.size) {
      logger.info(`[SFTP Cleyrop] ✅ Transfert du fichier Excel Cleyrop réussi.`);
    } else {
      logger.error(`[SFTP Cleyrop] ❌ Tailles différentes pour ${remoteFilePath}: local=${localStats.size}, distant=${remoteStats.size}`);
    }
  } catch (err) {
    logger.error({ err }, `[SFTP Cleyrop] ❌ Erreur lors du transfert du fichier Excel.`);
  }
}