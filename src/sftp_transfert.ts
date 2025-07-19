// @ts-expect-error: Pas de types pour ssh2-sftp-client dans node_modules
import SftpClient from 'ssh2-sftp-client';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { Knex } from 'knex';
import { logger } from './logs_config.js';

dotenv.config({ debug: false });

const SFTP_HOST = process.env.SFTP_HOST;
const SFTP_PORT = process.env.SFTP_PORT ? parseInt(process.env.SFTP_PORT) : 22;
const SFTP_USER = process.env.SFTP_USER;
const SFTP_PRIVATE_KEY_PATH = process.env.SFTP_PRIVATE_KEY_PATH;
const SFTP_REMOTE_BASE_DIR = process.env.SFTP_REMOTE_BASE_DIR;

if (!SFTP_HOST || !SFTP_USER || !SFTP_PRIVATE_KEY_PATH || !SFTP_REMOTE_BASE_DIR) {
  throw new Error('Paramètres SFTP manquants dans le .env');
}



export async function transferFichierSFTP(
  localPath: string,
  remoteSubDir: string, // ex: Extract_RCP_20250718
  remoteFileName: string,
  idBatch: string,
  codeCIS: string,
  codeATC: string,
  db: Knex
): Promise<void> {
  logger.info(`Début transfert SFTP: ${localPath} -> ${remoteSubDir}/${remoteFileName}`);
  
  const sftp = new SftpClient();
  const privateKey = fs.readFileSync(SFTP_PRIVATE_KEY_PATH as string);
  const remoteDir = path.posix.join(SFTP_REMOTE_BASE_DIR as string, remoteSubDir);
  const remotePath = path.posix.join(remoteDir, remoteFileName);
  let resultat = 'COPIE SFTP KO';
  let dateSftp = new Date().toISOString();
  
  try {
    logger.info(`Connexion SFTP à ${SFTP_HOST}:${SFTP_PORT} avec l'utilisateur ${SFTP_USER}`);
    await sftp.connect({
      host: SFTP_HOST as string,
      port: SFTP_PORT,
      username: SFTP_USER as string,
      privateKey
    });
    logger.info('Connexion SFTP réussie');
    
    // Créer le dossier distant si besoin
    try {
      logger.info(`Création du répertoire distant: ${remoteDir}`);
      await sftp.mkdir(remoteDir, true);
      logger.info('Répertoire distant créé avec succès');
    } catch (err) {
      logger.error({ err }, `Erreur lors de la création du répertoire distant: ${remoteDir}`);
    }
    // Vérifier l'existence du répertoire
    const dirExists = await sftp.exists(remoteDir);
    if (!dirExists) {
      logger.error(`Le répertoire distant ${remoteDir} n'existe pas après tentative de création. Arrêt du script.`);
      await sftp.end();
      throw new Error(`Répertoire distant non créé: ${remoteDir}`);
    }
    
    // Transférer le fichier
    logger.info(`Transfert du fichier: ${localPath} -> ${remotePath}`);
    await sftp.fastPut(localPath, remotePath);
    logger.info('Transfert SFTP terminé');
    
    // Vérifier la copie en comparant les tailles de fichiers
    try {
      // Récupérer la taille du fichier local
      const localStats = fs.statSync(localPath);
      const localSize = localStats.size;
      logger.info(`Taille fichier local: ${localSize} octets`);
      
      // Récupérer la taille du fichier distant
      const remoteStats = await sftp.stat(remotePath);
      const remoteSize = remoteStats.size;
      logger.info(`Taille fichier distant: ${remoteSize} octets`);
      
      // Comparer les tailles
      if (localSize === remoteSize) {
        resultat = 'COPIE SFTP OK';
        logger.info('✅ Tailles identiques - copie SFTP réussie');
      } else {
        resultat = 'COPIE SFTP KO';
        logger.error(`❌ Tailles différentes: local=${localSize}, distant=${remoteSize}`);
      }
    } catch (err) {
      resultat = 'COPIE SFTP KO';
      logger.error({ err }, 'Erreur lors de la vérification des tailles');
    }
  } catch (err) {
    resultat = 'COPIE SFTP KO';
    logger.error({ err }, `Erreur lors du transfert SFTP: ${localPath}`);
  } finally {
    await sftp.end();
    logger.info(`Fin transfert SFTP: ${resultat}`);
    
    // Mettre à jour la table SQLite
    await db('liste_fichiers_copies')
      .where({ id_batch: idBatch, code_cis: codeCIS, code_atc: codeATC })
      .update({
        date_copie_sftp: dateSftp,
        resultat_copie_sftp: resultat
      });
  }
} 