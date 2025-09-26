import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import axios from 'axios';
import { logger } from './logs_config.js';
import { Knex } from 'knex';

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Télécharge un fichier PDF depuis une URL, le renomme et le copie dans le répertoire cible.
 * Gère le logging en base de données et les re-tentatives.
 * @param params Objet contenant les paramètres nécessaires.
 * @param params.url L'URL du fichier PDF à télécharger.
 * @param params.codeCIS Le code CIS pour le renommage.
 * @param params.codeATC Le code ATC pour le renommage.
 * @param url L'URL du fichier PDF à télécharger.
 * @param codeCIS Le code CIS pour le renommage.
 * @param codeATC Le code ATC pour le renommage.
 * @param repCible Le répertoire où copier le fichier renommé.
 * @returns Le chemin complet du fichier PDF renommé et copié, ou null en cas d'erreur.
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
    idBatch: string
  }
): Promise<string | null> { 
  const { url, codeCIS, codeATC, lib_atc, nom_specialite, repCible, db, idBatch } = params;
  const maxRetries = parseInt(process.env.DL_EMA_RETRY_COUNT || '3', 10);

  if (!url || !codeCIS || !repCible) {
    logger.error('Paramètres manquants pour telechargerEtRenommerPdf.');
    return null;
  }

  // Nettoyer le code ATC pour enlever les caractères invalides pour un nom de fichier
  const sanitizedCodeATC = (codeATC || '').replace(/[\\/]/g, '');

  // Compléter le code ATC à droite par des underscores si moins de 7 caractères
  const codeATCComplet = sanitizedCodeATC.length < 7 ? sanitizedCodeATC.padEnd(7, "_") : sanitizedCodeATC;

  // Construire le nouveau nom de fichier
  const nouveauNom = `E_${codeCIS}_${codeATCComplet}.pdf`;
  const cheminCible = path.join(repCible, nouveauNom);

  // Vérifier si le fichier existe déjà AVANT de faire quoi que ce soit
  try {
    await fs.access(cheminCible);
    logger.info(`Fichier déjà présent (traitement principal) : ${cheminCible}`);
    // Créer l'entrée de log avec le statut spécifique
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
      resultat_copie_rep_tempo: 'COPIE OK - fichier deja present',
    });
    return cheminCible;
  } catch (err) {
    // Fichier non trouvé, on continue pour le télécharger
  }

  // 1. Créer l'entrée dans la base de données
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
    return null; // On ne peut pas continuer sans log
  }

  // 2. Tenter le téléchargement avec re-tentatives
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        const delay = 1000 * Math.pow(2, attempt - 1); // Délai exponentiel
        logger.warn(`Nouvelle tentative de téléchargement dans ${delay / 1000}s... (Tentative ${attempt}/${maxRetries})`);
        await sleep(delay);
      }

      logger.info(`Téléchargement de ${url} vers ${cheminCible} (Tentative ${attempt})`);
      const response = await axios({
        method: 'get',
        url: url,
        responseType: 'stream',
        timeout: 30000 // 30 secondes de timeout
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
          resolve();
        });
        writer.on('error', (err: Error) => {
          logger.error(`Erreur lors de l'écriture du fichier PDF ${cheminCible}:`, err);
          reject(err);
        });
      });
      return cheminCible; // Succès, on sort de la boucle

    } catch (error) {
      let errorMsg = 'ERREUR_INCONNUE';
      if (axios.isAxiosError(error)) {
        errorMsg = `Code: ${error.code}, Status: ${error.response?.status}`;
        logger.error(`Erreur Axios lors du téléchargement de ${url}: ${error.message} (${errorMsg})`);
      } else {
        logger.error(`Erreur inattendue lors du téléchargement de ${url}:`, error);
      }

      // Mettre à jour le log avec l'erreur
      await db('liste_fichiers_copies').where({ id: logId }).update({ resultat_copie_rep_tempo: errorMsg });

      if (attempt === maxRetries) {
        logger.error(`Échec final du téléchargement de ${url} après ${maxRetries} tentatives.`);
        return null;
      }
    }
  }
  return null; // Ne devrait pas être atteint
}