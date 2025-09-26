import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import knex from 'knex';
import axios from 'axios';
import fsSync from 'fs';
import fs from 'fs/promises';

// @ts-ignore
import knexConfig from '../knexfile.cjs';
import { logger } from './logs_config.js';

// --- Configuration de l'environnement ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

const db = knex(knexConfig.development);

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Tente de re-télécharger un PDF en échec.
 * @param ligneKO L'enregistrement de la base de données pour le fichier en échec.
 */
async function retenterTelechargement(ligneKO: any): Promise<void> {
  const maxRetries = parseInt(process.env.DL_EMA_RETRY_COUNT || '3', 10);
  const url = ligneKO.nom_fichier_source;
  const cheminCible = path.join(ligneKO.rep_fichier_cible, ligneKO.nom_fichier_cible);

  logger.info(`--- Début rattrapage pour ${ligneKO.nom_fichier_cible} ---`);

  // Vérifier si le fichier a été téléchargé entre-temps
  try {
    await fs.access(cheminCible);
    logger.info(`✅ Fichier déjà présent (rattrapage) : ${cheminCible}`);
    await db('liste_fichiers_copies').where({ id: ligneKO.id }).update({ resultat_copie_rep_tempo: 'COPIE OK' });
    return;
  } catch (err) {
    // Fichier non trouvé, on continue pour le télécharger
  }


  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        const delay = 1000 * Math.pow(2, attempt - 1); // Délai exponentiel
        logger.warn(`Nouvelle tentative de téléchargement dans ${delay / 1000}s... (Tentative ${attempt}/${maxRetries})`);
        await sleep(delay);
      }

      logger.info(`Téléchargement de ${url} (Tentative ${attempt})`);
      const response = await axios({
        method: 'get',
        url: url,
        responseType: 'stream',
        timeout: 30000
      });

      const contentType = response.headers['content-type'];
      if (!contentType || !contentType.includes('application/pdf')) {
        const errorMsg = `RATTRAPAGE_KO: URL SANS PDF (Content-Type: ${contentType})`;
        await db('liste_fichiers_copies').where({ id: ligneKO.id }).update({ resultat_copie_rep_tempo: errorMsg });
        logger.warn(`L'URL ${url} n'a pas retourné un PDF. ${errorMsg}`);
        return;
      }

      const writer = fsSync.createWriteStream(cheminCible);
      response.data.pipe(writer);

      await new Promise<void>((resolve, reject) => {
        writer.on('finish', async () => {
          await db('liste_fichiers_copies').where({ id: ligneKO.id }).update({ resultat_copie_rep_tempo: 'COPIE OK' });
          logger.info(`✅ Rattrapage réussi pour ${ligneKO.nom_fichier_cible}`);
          resolve();
        });
        writer.on('error', reject);
      });
      return; // Succès, on sort de la fonction

    } catch (error) {
      let errorMsg = 'ERREUR_INCONNUE';
      if (axios.isAxiosError(error)) {
        errorMsg = `Code: ${error.code}, Status: ${error.response?.status}`;
        logger.error(`Erreur Axios lors du rattrapage pour ${url}: ${error.message} (${errorMsg})`);
      } else {
        logger.error(`Erreur inattendue lors du rattrapage pour ${url}:`, error);
      }

      const finalErrorMsg = `RATTRAPAGE_KO: ${errorMsg}`;
      await db('liste_fichiers_copies').where({ id: ligneKO.id }).update({ resultat_copie_rep_tempo: finalErrorMsg });

      if (attempt === maxRetries) {
        logger.error(`❌ Échec final du rattrapage pour ${ligneKO.nom_fichier_cible} après ${maxRetries} tentatives.`);
      }
    }
  }
}

/**
 * Point d'entrée du script de rattrapage.
 */
async function lancerRattrapageEU() {
  const relanceActive = process.env.RELANCE_RATTRPAGE_EU === 'True';
  const tempoRelance = (parseInt(process.env.TEMPO_AVANT_RELANCE_RATTRPAGE_EU || '30', 10)) * 1000; // en ms

  let continuerLeCycle = true;

  while (continuerLeCycle) {
    logger.info('--- Lancement du script de rattrapage pour les RCP/Notices EU ---');
    let erreursRestantes = 0;

    try {
      // 1. Récupérer le dernier id_batch
      const dernierBatch = await db('liste_id_batch').orderBy('debut_batch', 'desc').first();
      if (!dernierBatch) {
        logger.warn('Aucun batch trouvé dans la base de données. Arrêt du script.');
        continuerLeCycle = false;
        continue;
      }
      const idBatch = dernierBatch.id_batch;
      logger.info(`Traitement du dernier batch trouvé : ${idBatch}`);

      // 2. Récupérer les fichiers en erreur pour ce batch
      const fichiersEnErreur = await db('liste_fichiers_copies')
        .where('id_batch', idBatch)
        .andWhere('type_document', 'RCP_Notice_EU')
        .andWhereNot('resultat_copie_rep_tempo', 'COPIE OK')
        .andWhereNot('resultat_copie_rep_tempo', 'COPIE OK - fichier deja present');

      erreursRestantes = fichiersEnErreur.length;

      if (erreursRestantes === 0) {
        logger.info('Aucun fichier en erreur à rattraper pour ce batch. Terminé.');
        continuerLeCycle = false;
        continue;
      }

      logger.info(`${erreursRestantes} fichier(s) à rattraper.`);

      // 3. Boucler et retenter le téléchargement
      for (const fichier of fichiersEnErreur) {
        await retenterTelechargement(fichier);
      }

      logger.info('--- Cycle de rattrapage terminé ---');

    } catch (error) {
      logger.error({ err: error }, 'Une erreur critique est survenue durant le script de rattrapage.');
      continuerLeCycle = false; // Arrêter en cas d'erreur critique
    }

    // Décider de la relance
    if (relanceActive && erreursRestantes > 0) {
      logger.info(`Relance automatique activée. Prochain cycle dans ${tempoRelance / 1000} secondes...`);
      await sleep(tempoRelance);
    } else {
      continuerLeCycle = false;
    }
  }
  logger.info('--- Arrêt définitif du script de rattrapage ---');
  await db.destroy();
}

lancerRattrapageEU();