import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import https from 'https';
import axios from 'axios';
import { logger } from './logs_config.js';
import { Knex } from 'knex';
import { transferFichierSFTP } from './sftp_transfert.js';

import SftpClient from 'ssh2-sftp-client';

// Agent HTTPS pour la réutilisation des connexions (Keep-Alive)
const httpsAgent = new https.Agent({ keepAlive: true });

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Télécharge un fichier PDF depuis une URL, le renomme et le copie dans le répertoire cible.
 * Gère le logging en base de données et les re-tentatives.
 * @param params Objet contenant les paramètres nécessaires.
 */
export async function telechargerEtRenommerPdf(
  params: {
    url: string,
    codeCIS: string,
    codeATC: string,
    lib_atc: string,
    nom_specialite: string,
    repCible: string,
    db: Knex,
    idBatch: string,
    repCiblePrincipal: string,
    transfertSftp: boolean,
    sftpClient?: SftpClient, // Ajout du client SFTP optionnel
  }
): Promise<string | null> { 
  const { url, codeCIS, codeATC, lib_atc, nom_specialite, repCible, db, idBatch, sftpClient } = params;
  const maxRetries = parseInt(process.env.DL_EMA_RETRY_COUNT || '5', 10);

  if (!url || !codeCIS || !repCible) {
    logger.error('Paramètres manquants pour telechargerEtRenommerPdf.');
    return null;
  }

  const sanitizedCodeATC = (codeATC || '').replace(/[\\/]/g, '');
  const codeATCComplet = sanitizedCodeATC.length < 7 ? sanitizedCodeATC.padEnd(7, "_") : sanitizedCodeATC;
  const nouveauNom = `E_${codeCIS}_${codeATCComplet}.pdf`;
  const cheminCible = path.join(repCible, nouveauNom);

  try {
    await fs.access(cheminCible);
    logger.info(`Fichier déjà présent (traitement principal) : ${cheminCible}`);
    
    let resultatCopieTempo = 'COPIE OK - fichier deja present';
    let dateCopieSftp = null;
    let resultatCopieSftp = null;

    if (params.transfertSftp && sftpClient) {
      const remoteSubDir = path.posix.join(path.basename(path.dirname(params.repCiblePrincipal)), 'EU', 'RCP_Notices');
      try {
        await transferFichierSFTP(sftpClient, cheminCible, remoteSubDir, nouveauNom, idBatch, codeCIS, codeATC, db);
        // Le statut SFTP est mis à jour dans transferFichierSFTP, on le récupère
        const logEntry = await db('liste_fichiers_copies').where({ id_batch: idBatch, nom_fichier_cible: nouveauNom }).first();
        resultatCopieSftp = logEntry?.resultat_copie_sftp || 'COPIE SFTP KO';
        dateCopieSftp = logEntry?.date_copie_sftp || new Date().toISOString();
      } catch (sftpError) {
        logger.error({ sftpError }, `Erreur lors du transfert SFTP du fichier déjà présent ${cheminCible}`);
        resultatCopieSftp = 'COPIE SFTP KO';
        dateCopieSftp = new Date().toISOString();
      }
    } else if (params.transfertSftp) {
        logger.warn('Transfert SFTP demandé mais aucun client SFTP n\'a été fourni.');
        resultatCopieSftp = 'CLIENT SFTP MANQUANT';
    }

    const urlObject = new URL(url);
    const sourceFileName = path.basename(urlObject.pathname);
    const sourceDir = path.dirname(urlObject.pathname);
    const sourceRepo = `${urlObject.origin}${sourceDir}/`;
    await db('liste_fichiers_copies').insert({
      id_batch: idBatch,
      type_document: 'RCP_Notice_EU',
      rep_fichier_source: sourceRepo,
      nom_fichier_source: sourceFileName,
      rep_fichier_cible: repCible,
      nom_fichier_cible: nouveauNom,
      code_cis: codeCIS,
      code_atc: codeATC,
      lib_atc: lib_atc,
      nom_specialite: nom_specialite,
      date_copie_rep_tempo: new Date().toISOString(),
      resultat_copie_rep_tempo: resultatCopieTempo,
      date_copie_sftp: dateCopieSftp,
      resultat_copie_sftp: resultatCopieSftp,
    });
    return cheminCible;
  } catch (err) {
    // Fichier non trouvé, on continue
  }

  let logId: number | undefined;
  try {
    const urlObject = new URL(url);
    const sourceFileName = path.basename(urlObject.pathname);
    const sourceDir = path.dirname(urlObject.pathname);
    const sourceRepo = `${urlObject.origin}${sourceDir}/`;
    const ids = await db('liste_fichiers_copies')
      .insert({
        id_batch: idBatch,
        type_document: 'RCP_Notice_EU',
        rep_fichier_source: sourceRepo,
        nom_fichier_source: sourceFileName,
        rep_fichier_cible: repCible,
        nom_fichier_cible: nouveauNom,
        code_cis: codeCIS,
        code_atc: codeATC,
        lib_atc: lib_atc,
        nom_specialite: nom_specialite,
        date_copie_rep_tempo: new Date().toISOString(),
        resultat_copie_rep_tempo: 'EN_ATTENTE',
      })
      .returning('id');
    logId = ids[0].id;
  } catch (dbError) {
    logger.error({ err: dbError }, `Erreur lors de la création de l'entrée de log pour ${url}`);
    return null;
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        const delay = 1000 * Math.pow(2, attempt - 1);
        logger.warn(`Nouvelle tentative de téléchargement dans ${delay / 1000}s... (Tentative ${attempt}/${maxRetries})`);
        await sleep(delay);
      }

      logger.info(`Téléchargement de ${url} vers ${cheminCible} (Tentative ${attempt})`);
      const response = await axios({
        method: 'get',
        url: url,
        responseType: 'stream',
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
        },
        httpsAgent: httpsAgent
      });

      const contentType = response.headers['content-type'];
      if (!contentType || !contentType.includes('application/pdf')) {
        const errorMsg = `URL SANS PDF (Content-Type: ${contentType})`;
        logger.warn(`L'URL ${url} n'a pas retourné un PDF. ${errorMsg}`);
        await db('liste_fichiers_copies').where({ id: logId }).update({ resultat_copie_rep_tempo: errorMsg });
        return null;
      }

      const writer = fsSync.createWriteStream(cheminCible);
      response.data.pipe(writer);

      await new Promise<void>((resolve, reject) => {
        writer.on('finish', async () => {
          logger.info(`PDF téléchargé et renommé : ${cheminCible}`);
          await db('liste_fichiers_copies').where({ id: logId }).update({ resultat_copie_rep_tempo: 'COPIE OK' });

          if (params.transfertSftp && sftpClient) {
            const remoteSubDir = path.posix.join(path.basename(path.dirname(params.repCiblePrincipal)), 'EU', 'RCP_Notices');
            try {
              await transferFichierSFTP(sftpClient, cheminCible, remoteSubDir, nouveauNom, idBatch, codeCIS, codeATC, db);
            } catch (sftpError) {
              logger.error({ sftpError }, `Erreur lors du transfert SFTP du fichier téléchargé ${cheminCible}`);
              // Le statut est déjà mis à jour dans transferFichierSFTP en cas d'erreur
            }
          } else if (params.transfertSftp) {
            logger.warn('Transfert SFTP demandé mais aucun client SFTP n\'a été fourni.');
            await db('liste_fichiers_copies').where({ id: logId }).update({
                date_copie_sftp: new Date().toISOString(),
                resultat_copie_sftp: 'CLIENT SFTP MANQUANT'
            });
          }
          resolve();
        });
        writer.on('error', (err: Error) => {
          logger.error(`Erreur lors de l'écriture du fichier PDF ${cheminCible}:`, err);
          reject(err);
        });
      });
      return cheminCible;

    } catch (error) {
      let errorMsg = 'ERREUR_INCONNUE';
      if (axios.isAxiosError(error)) {
        errorMsg = `Code: ${error.code}, Status: ${error.response?.status}`;
        logger.error(`Erreur Axios lors du téléchargement de ${url}: ${error.message} (${errorMsg})`);
      } else {
        logger.error(`Erreur inattendue lors du téléchargement de ${url}:`, error);
      }

      await db('liste_fichiers_copies').where({ id: logId }).update({ resultat_copie_rep_tempo: errorMsg });

      if (attempt === maxRetries) {
        logger.error(`Échec final du téléchargement de ${url} après ${maxRetries} tentatives.`);
        return null;
      }
    }
  }
  return null;
}