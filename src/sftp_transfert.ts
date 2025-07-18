// @ts-expect-error: Pas de types pour ssh2-sftp-client dans node_modules
import SftpClient from 'ssh2-sftp-client';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { Knex } from 'knex';

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
  const sftp = new SftpClient();
  const privateKey = fs.readFileSync(SFTP_PRIVATE_KEY_PATH as string);
  const remoteDir = path.posix.join(SFTP_REMOTE_BASE_DIR as string, remoteSubDir);
  const remotePath = path.posix.join(remoteDir, remoteFileName);
  let resultat = 'COPIE SFTP KO';
  let dateSftp = new Date().toISOString();
  try {
    await sftp.connect({
      host: SFTP_HOST as string,
      port: SFTP_PORT,
      username: SFTP_USER as string,
      privateKey
    });
    // Créer le dossier distant si besoin
    try {
      await sftp.mkdir(remoteDir, true); // true = recursive
    } catch (err) {
      // ignore si déjà existant
    }
    // Transférer le fichier
    await sftp.fastPut(localPath, remotePath);
    // Vérifier la présence du fichier
    const exists = await sftp.exists(remotePath);
    if (exists) {
      resultat = 'COPIE SFTP OK';
    }
  } catch (err) {
    resultat = 'COPIE SFTP KO';
  } finally {
    await sftp.end();
    // Mettre à jour la table SQLite
    await db('liste_fichiers_copies')
      .where({ id_batch: idBatch, code_cis: codeCIS, code_atc: codeATC })
      .update({
        date_copie_sftp: dateSftp,
        resultat_copie_sftp: resultat
      });
  }
} 