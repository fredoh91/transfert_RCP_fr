import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import https from 'https';
import axios from 'axios';
import { logger } from '../logs_config.js';
import { Knex } from 'knex';
// import { transferFichierSFTP } from '../transfert/sftp_transfert.js';

import SftpClient from 'ssh2-sftp-client';

// Agent HTTPS pour la réutilisation des connexions (Keep-Alive)
const httpsAgent = new https.Agent({ keepAlive: true });

// --- Stratégie de pause pour erreurs 429 ---
let consecutive429Errors = 0;
let isPauseActive = false; // Verrou pour éviter les pauses multiples
const errorThreshold = parseInt(process.env.DL_EMA_NB_ERROR_CONSECUTIVELY || '15', 10);
const pauseDuration = parseInt(process.env.DL_EMA_DELAY_RECONNECT_IF_DL_ERROR || '300', 10) * 1000; // en millisecondes

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
    princeps_generique: string,
  }
): Promise<string | null> { 
  const { url, codeCIS, codeATC, lib_atc, nom_specialite, repCible, db, idBatch, repCiblePrincipal, princeps_generique} = params;
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
      princeps_generique: princeps_generique,
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
        princeps_generique: princeps_generique,
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
      
      // En cas de succès, on réinitialise le compteur d'erreurs 429
      consecutive429Errors = 0;

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
        // Sécurité : Timeout pour éviter le blocage infini si le flux se fige
        const timeoutSecu = setTimeout(() => {
          writer.destroy(); // Force la fermeture du fichier local
          if (response.data && typeof response.data.destroy === 'function') {
            response.data.destroy(); // Force la fermeture du flux réseau
          }
          reject(new Error('TIMEOUT_STREAM: Le téléchargement a pris trop de temps (> 60s) ou le flux est bloqué.'));
        }, 60000); // 60 secondes max

        writer.on('finish', async () => {
          clearTimeout(timeoutSecu);
          logger.info(`PDF téléchargé et renommé : ${cheminCible}`);
          await db('liste_fichiers_copies').where({ id: logId }).update({ resultat_copie_rep_tempo: 'COPIE OK' });
          resolve();
        });
        writer.on('error', (err: Error) => {
          clearTimeout(timeoutSecu);
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
        
        // Gestion spécifique des erreurs 429
        if (error.response?.status === 429) {
          consecutive429Errors++;
          logger.warn(`Erreur 429 détectée. Compteur d'erreurs consécutives : ${consecutive429Errors}/${errorThreshold}`);

          // Si le seuil est atteint et que personne n'a déjà déclenché la pause...
          if (consecutive429Errors >= errorThreshold && !isPauseActive) {
            isPauseActive = true; // On active le verrou
            try {
              logger.warn(`Seuil de ${errorThreshold} erreurs 429 atteint. Mise en pause globale du script pour ${pauseDuration / 1000} secondes.`);
              await sleep(pauseDuration);
            } finally {
              consecutive429Errors = 0; // Réinitialisation
              isPauseActive = false; // On retire TOUJOURS le verrou
              logger.info("Reprise du script après la pause.");
            }
          } 
          // Si une pause est déjà en cours, on attend qu'elle se termine.
          else if (isPauseActive) {
            logger.warn("Une pause est déjà en cours. Mise en attente de ce processus...");
            const waitStart = Date.now();
            while (isPauseActive) {
              await sleep(1000); // Attendre passivement
              // Sécurité : si au bout de (pause + 1 min) c'est toujours bloqué, on force la sortie
              if (Date.now() - waitStart > pauseDuration + 60000) {
                logger.error("Sécurité : Attente de pause trop longue, force la reprise.");
                break;
              }
            }
            logger.info("Fin de la pause détectée. Reprise de l'opération.");
          }
        } else {
          // Une erreur différente réinitialise le compteur
          consecutive429Errors = 0;
        }

      } else {
        logger.error(`Erreur inattendue lors du téléchargement de ${url}:`, error);
        // Une erreur non-Axios réinitialise aussi le compteur
        consecutive429Errors = 0;
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