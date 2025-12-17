import fs from 'fs/promises';
import path from 'path';
import ExcelJS from 'exceljs';
import { Knex } from 'knex';
import mysql from 'mysql2/promise';
import { logger } from '../logs_config.js';
import { telechargerEtRenommerPdf } from './gestion_pdf_centralise.js'; // Nouvelle importation
import { applyExcelFormatting } from '../exportExcel/excel_formatter.js';
import pLimit from 'p-limit';
import SftpClient from 'ssh2-sftp-client';

/**
 * Ajout de la fonction sleep pour le délai de courtoisie
 * 
 */
async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Utilitaire pour parser un CSV simple (séparateur ;)
 * 
 * @param filePath 
 * @returns 
 */
async function parseCsvFile(filePath: string): Promise<any[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return []; // Si pas de données ou que l'en-tête, retourner un tableau vide
  const headers = lines[0].split(';').map(h => h.trim());
  return lines.slice(1).map(line => { // .slice(1) pour ignorer la ligne d'en-tête
    const values = line.split(';');
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (values[i] || '').trim();
    });
    return obj;
  });
}


/**
 * Récupère le code ATC pour un code_cis donné
 * 
 * @param pool mysql.Pool connection pool 
 * @param code_cis 
 * @returns Promise<string> code ATC ('' si introuvable)
 */
async function getCodeAtcForCis(pool: mysql.Pool, code_cis: string): Promise<string> {
  let connection: mysql.PoolConnection | null = null;
  try {
    connection = await pool.getConnection();
    const [rows] = await connection.execute(
      `select vu.code_cis as CodeCIS, vu.dbo_classe_atc_lib_abr as CodeATC_5 from vuutil vu where vu.code_cis = ? order by vu.dbo_classe_atc_lib_abr`,
      [code_cis]
    );
    if (Array.isArray(rows) && rows.length > 0) {
      // On prend la première valeur trouvée
      const code_atc = (rows[0] as any).CodeATC_5 || '';
      return code_atc;
    }
    return '';
  } catch (err) {
    logger.error({ err }, `Erreur lors de la récupération du code ATC pour code_cis=${code_cis}`);
    return '';
  } finally {
    if (connection) connection.release();
  }
}


// Récupère le code ATC pour un code_cis donné

/**
 * 
 * @param pool mysql.Pool connection pool 
 * @param code_cis 
 * @returns Promise<{code_atc: string, lib_atc: string, nom_specialite: string, code_vuprinceps: string | null}>
 */
async function getAtcSpecialiteForCis(pool: mysql.Pool, code_cis: string): Promise<{code_atc: string, lib_atc: string, nom_specialite: string, code_vuprinceps: string | null}> {
  let connection: mysql.PoolConnection | null = null;
  try {
    connection = await pool.getConnection();
    const [rows] = await connection.execute(
      `select vu.code_cis as CodeCIS, 
              vu.dbo_classe_atc_lib_abr as CodeATC_5,
              vu.dbo_classe_atc_lib_court as LibATC,
              vu.nom_vu as NomSpecialite,
              vu.code_vuprinceps
              from vuutil vu 
              where vu.code_cis = ? 
              order by vu.dbo_classe_atc_lib_abr`,
      [code_cis]
    );
    if (Array.isArray(rows) && rows.length > 0) {
      // On prend la première valeur trouvée
      const code_atc = (rows[0] as any).CodeATC_5 || '';
      const lib_atc = (rows[0] as any).LibATC || '';
      const nom_specialite = (rows[0] as any).NomSpecialite || '';
      // const code_vuprinceps = (rows[0] as any).code_vuprinceps || null;
      const code_vuprinceps = (rows[0] as any).code_vuprinceps === null ? 'princeps_ou_pas_de_generique' : (rows[0] as any).code_vuprinceps;
      return { code_atc, lib_atc, nom_specialite, code_vuprinceps };
    }
    return { code_atc: 'N/A', lib_atc: 'N/A', nom_specialite: 'N/A', code_vuprinceps: null };
  } catch (err) {
    logger.error({ err }, `Erreur lors de la récupération du code ATC pour code_cis=${code_cis}`);
    return { code_atc: 'N/A', lib_atc: 'N/A', nom_specialite: 'N/A', code_vuprinceps: null };
  } finally {
    if (connection) connection.release();
  }
}

/**
 * Fonction principale d'export
 * 
 * @param param0 
 * @returns 
 */
export async function getDonneesEuropeCleyrop({
  poolCodexExtract,
  repSource,
  maxFilesToProcess,
  repCibleEURCPNotices,
  db,
  idBatch,
  repCiblePrincipal // Ajout du repCiblePrincipal pour telechargerEtRenommerPdf
}: {
  poolCodexExtract: mysql.Pool,
  repSource: string,
  maxFilesToProcess?: number,
  repCibleEURCPNotices: string,
  db: Knex,
  idBatch: string,
  repCiblePrincipal: string // Nouveau paramètre obligatoire
}): Promise<{ data: any[]; fileCount: number }> {
  // Trouver le fichier CSV du mois courant uniquement
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const expectedCsvFile = `RCP_centralises_${year}_${month}.csv`;
  const csvPath = path.join(repSource, expectedCsvFile);
  try {
    await fs.access(csvPath);
  } catch {
    logger.info(`Aucun fichier CSV RCP centralisé pour le mois en cours (${expectedCsvFile}) dans ${repSource}`);
    return { data: [], fileCount: 0 };
  }
  logger.info('Traitement du fichier CSV européen : ' + csvPath);

  // Lecture et parsing du CSV
  let rows = await parseCsvFile(csvPath);
  if (rows.length === 0) {
    logger.warn('Le fichier CSV est vide.');
    return { data: [], fileCount: 0 };
  }

  // Application de la limite de fichiers si elle est définie
  if (maxFilesToProcess) {
    logger.info(`Application de la limite de ${maxFilesToProcess} fichiers pour le traitement Europe.`);
    rows = rows.slice(0, maxFilesToProcess);
  }

  // Préparation des données
  const dataWithAtc: any[] = [];
  const limit = pLimit(parseInt(process.env.CENTRALISE_CONCURRENCY_LIMIT || '5', 10));
  const downloadPromises = rows.map(row => limit(async () => {
    const code_cis = row['SpecId'] || '';
    const { code_atc, lib_atc, nom_specialite, code_vuprinceps } = await getAtcSpecialiteForCis(poolCodexExtract, code_cis)
    // const princepsGeneriqueValue = code_vuprinceps === null ? 'princeps' : code_vuprinceps;
    const princepsGeneriqueValue = code_vuprinceps === null ? 'princeps_ou_pas_de_generique' : code_vuprinceps;
    let nom_fichier_cible = ''; // Initialisation

    // Télécharger et renommer le PDF si une URL est présente
    if (row['UrlEpar']) {
      const cheminCible = await telechargerEtRenommerPdf({
        url: row['UrlEpar'],
        codeCIS: code_cis,
        codeATC: code_atc,
        lib_atc: lib_atc,
        nom_specialite: nom_specialite,
        repCible: repCibleEURCPNotices,
        db,
        idBatch,
        repCiblePrincipal: repCiblePrincipal, // Utilisation du nouveau paramètre
        princeps_generique: princepsGeneriqueValue,

      });

      if (cheminCible) {
        nom_fichier_cible = path.basename(cheminCible);
      }

      // Ajout d'un délai de courtoisie pour ne pas surcharger le serveur
      const minDelay = parseInt(process.env.CENTRALISE_MIN_DELAY || '200', 10);
      const maxDelay = parseInt(process.env.CENTRALISE_MAX_DELAY || '700', 10);
      await sleep(Math.random() * (maxDelay - minDelay) + minDelay);
    }
    
    const dataRow = {
      nom_fichier_cible,
      code_cis,
      code_atc,
      lib_atc,
      nom_specialite,
      princeps_generique: princepsGeneriqueValue,
      Product_Number: row['Product_Number'] || '',
      UrlEpar: row['UrlEpar'] || '',
      type_document: 'RCP_Notice_EU', // Ajout du type de document pour l'export unifié
      id_batch: idBatch // Ajout de l'id_batch pour l'export unifié
    };

    return dataRow; // Retourner la ligne traitée
  }));

  const processedRows = await Promise.allSettled(downloadPromises);

  // Filtrer les résultats réussis et les ajouter à dataWithAtc
  processedRows.forEach(result => {
    if (result.status === 'fulfilled') {
      dataWithAtc.push(result.value);
    } else {
      logger.error('Erreur lors du traitement d\'une ligne du CSV européen:', result.reason);
    }
  });

  return { data: dataWithAtc, fileCount: dataWithAtc.length };
} 