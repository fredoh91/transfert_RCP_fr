import SftpClient from 'ssh2-sftp-client';
import fs from 'fs';
import path from 'path';
import { Knex } from 'knex';
import { logger } from '../logs_config.js';

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function transferFichierSFTP(
  sftp: SftpClient | undefined,
  localPath: string,
  remoteSubDir: string,
  remoteFileName: string,
  idBatch: string,
  codeCIS: string,
  codeATC: string,
  db: Knex
): Promise<void> {
  logger.info(`Début transfert SFTP: ${localPath} -> ${remoteSubDir}/${remoteFileName}`);

  // Si aucun client SFTP fourni, on crée une connexion locale (lazy connect)
  let localSftp: SftpClient | undefined = sftp;
  let createdLocal = false;
  if (!localSftp) {
    const SFTP_HOST = process.env.SFTP_HOST;
    const SFTP_PORT = process.env.SFTP_PORT ? parseInt(process.env.SFTP_PORT) : 22;
    const SFTP_USER = process.env.SFTP_USER;
    const SFTP_PRIVATE_KEY_PATH = process.env.SFTP_PRIVATE_KEY_PATH;

    if (!SFTP_HOST || !SFTP_USER || !SFTP_PRIVATE_KEY_PATH) {
      logger.error('Paramètres SFTP manquants dans le .env. Impossible de se connecter au SFTP.');
      throw new Error('Paramètres SFTP manquants dans le .env');
    }

    localSftp = new SftpClient();
    const privateKey = fs.readFileSync(SFTP_PRIVATE_KEY_PATH as string);
    logger.info(`Connexion SFTP (lazy) à ${SFTP_HOST}:${SFTP_PORT} avec ${SFTP_USER}`);
    await localSftp.connect({ host: SFTP_HOST as string, port: SFTP_PORT, username: SFTP_USER as string, privateKey });
    // augmenter les listeners si possible
    try {
      // @ts-ignore
      localSftp.client.setMaxListeners(50);
    } catch (e) {
      // ignore
    }
    createdLocal = true;
  }

  const SFTP_REMOTE_BASE_DIR = process.env.SFTP_REMOTE_BASE_DIR;
  if (!SFTP_REMOTE_BASE_DIR) {
    logger.error('Variable SFTP_REMOTE_BASE_DIR manquante dans le .env. Transfert annulé.');
    throw new Error('Variable SFTP_REMOTE_BASE_DIR manquante');
  }

  const remoteDir = path.posix.join(SFTP_REMOTE_BASE_DIR, remoteSubDir);
  const remotePath = path.posix.join(remoteDir, remoteFileName);
  let resultat = 'COPIE SFTP KO';
  const dateSftp = new Date().toISOString();

  try {
    // Vérifier si le fichier existe déjà et a la même taille
    try {
      const remoteStats = await localSftp!.stat(remotePath);
      const localStats = fs.statSync(localPath);
      if (remoteStats.size === localStats.size) {
        logger.info(`Fichier déjà présent sur le serveur avec la même taille. Omission: ${remotePath}`);
        resultat = 'COPIE OK - DEJA PRESENT';
        return; // Le bloc finally s'exécutera
      }
    } catch (err: any) {
      // Si l'erreur est "No such file", on ignore et on continue pour uploader.
      // Sinon, c'est une autre erreur (ex: permission) qu'on ne gère pas ici, donc on la relance.
      if (err.code !== 'ENOENT' && err.message !== 'No such file') {
        throw err;
      }
    }

    // Si on arrive ici, le fichier n'existe pas ou a une taille différente. On procède à l'envoi.
    await localSftp!.mkdir(remoteDir, true);

    const minDelay = parseInt(process.env.SFTP_MIN_DELAY || '100', 10);
    const maxDelay = parseInt(process.env.SFTP_MAX_DELAY || '300', 10);
    await sleep(Math.random() * (maxDelay - minDelay) + minDelay);

    await localSftp!.fastPut(localPath, remotePath);

    const localStats = fs.statSync(localPath);
    const remoteStats = await localSftp!.stat(remotePath);

    if (localStats.size === remoteStats.size) {
      resultat = 'COPIE SFTP OK';
      logger.info(`✅ Copie SFTP réussie: ${remotePath} (Taille: ${localStats.size})`);
    } else {
      resultat = 'COPIE SFTP KO';
      logger.error(`❌ Tailles différentes pour ${remotePath}: local=${localStats.size}, distant=${remoteStats.size}`);
    }
  } catch (err) {
    resultat = 'COPIE SFTP KO';
    logger.error({ err }, `Erreur lors du transfert SFTP de ${localPath} vers ${remotePath}`);
    // On propage l'erreur pour que le système de retry puisse la catcher
    throw err;
  } finally {
    logger.info(`Fin transfert SFTP: ${resultat}`);
    // La mise à jour de la base de données se fait ici pour tous les cas (succès, échec, déjà présent)
    // Le where est sur id_batch et nom_fichier_cible, ce qui devrait être unique par batch
    await db('liste_fichiers_copies')
      .where({ id_batch: idBatch, nom_fichier_cible: remoteFileName })
      .update({
        date_copie_sftp: dateSftp,
        resultat_copie_sftp: resultat
      });

    // Si on a créé la connexion localement, on la ferme
    if (createdLocal && localSftp) {
      try {
        await localSftp.end();
        logger.info('Déconnexion SFTP (lazy) réussie');
      } catch (e) {
        logger.warn({ e }, 'Erreur lors de la fermeture SFTP lazy');
      }
    }
  }
}