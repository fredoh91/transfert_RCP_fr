import path from 'path';
import pLimit from 'p-limit';
import fsSync from 'fs';
import { logger } from '../logs_config.js';
import knex from 'knex';
import { transferFichierSFTP } from './sftp_transfert.js';

export async function transferSFTPDecentralises(params: {
  sftp: any,
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

export async function transferSFTPCentralise(params: {
  sftp: any,
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
