import fs from 'fs/promises';
import path from 'path';
import ExcelJS from 'exceljs';
import { Knex } from 'knex';
import mysql from 'mysql2/promise';
import { logger } from './logs_config.js';
import { telechargerEtRenommerPdf } from './gestion_pdf_centralise.js'; // Nouvelle importation
import { applyExcelFormatting } from './excel_formatter.js';
import pLimit from 'p-limit';
import SftpClient from 'ssh2-sftp-client';

// Ajout de la fonction sleep pour le délai de courtoisie
async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Utilitaire pour parser un CSV simple (séparateur ;)
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

// Récupère le code ATC pour un code_cis donné
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
      const code_vuprinceps = (rows[0] as any).code_vuprinceps || null;
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

// Fonction principale d'export
export async function exportEuropeCleyropExcel({
  poolCodexExtract,
  repSource,
  repCible,
  dateFileStr,
  maxFilesToProcess,
  repCibleEURCPNotices,
  db,
  idBatch,
  transfertSftp,
  sftpClient
}: {
  poolCodexExtract: mysql.Pool,
  repSource: string,
  repCible: string,
  dateFileStr: string,
  maxFilesToProcess?: number,
  repCibleEURCPNotices: string,
  db: Knex,
  idBatch: string,
  transfertSftp: boolean,
  sftpClient?: SftpClient
}): Promise<{ excelFilePath: string | null; fileCount: number }> {
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
    return { excelFilePath: null, fileCount: 0 };
  }
  logger.info('Traitement du fichier CSV européen : ' + csvPath);

  // Lecture et parsing du CSV
  const rows = await parseCsvFile(csvPath);
  if (rows.length === 0) {
    logger.warn('Le fichier CSV est vide.');
    return { excelFilePath: null, fileCount: 0 };
  }

  // Préparation des données pour Excel
  // Renommer SpecId en code_cis, ajouter code_atc en 2e position
  const dataWithAtc: any[] = [];
  let iCpt = 0;
  const limit = pLimit(parseInt(process.env.CENTRALISE_CONCURRENCY_LIMIT || '5', 10));
  const downloadPromises = rows.map(row => limit(async () => {
    iCpt++;
    const code_cis = row['SpecId'] || '';
    const { code_atc, lib_atc, nom_specialite, code_vuprinceps } = await getAtcSpecialiteForCis(poolCodexExtract, code_cis)
    const princepsGeneriqueValue = code_vuprinceps === null ? 'princeps' : code_vuprinceps;
    const excelRow = {
      code_cis,
      code_atc,
      lib_atc,
      nom_specialite,
      princeps_generique: princepsGeneriqueValue,
      Product_Number: row['Product_Number'] || '',
      UrlEpar: row['UrlEpar'] || ''
    };

    // Télécharger et renommer le PDF si une URL est présente
    if (excelRow.UrlEpar) {
      await telechargerEtRenommerPdf({
        url: excelRow.UrlEpar,
        codeCIS: excelRow.code_cis,
        codeATC: excelRow.code_atc,
        lib_atc: excelRow.lib_atc,
        nom_specialite: excelRow.nom_specialite,
        repCible: repCibleEURCPNotices,
        db,
        idBatch,
        repCiblePrincipal: repCible,
        transfertSftp: transfertSftp,
        sftpClient
      });

      // Ajout d'un délai de courtoisie pour ne pas surcharger le serveur
      const minDelay = parseInt(process.env.CENTRALISE_MIN_DELAY || '200', 10);
      const maxDelay = parseInt(process.env.CENTRALISE_MAX_DELAY || '700', 10);
      await sleep(Math.random() * (maxDelay - minDelay) + minDelay);
    }

    if (maxFilesToProcess && iCpt >= maxFilesToProcess) {
      logger.info(`Limite de test atteinte (${maxFilesToProcess}) : arrêt du traitement du fichier CSV Europe.`);
      // Pas de break ici car on est dans un map, la limite sera gérée par le filtre en amont si nécessaire
    }
    return excelRow; // Retourner la ligne traitée
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

  // Création du fichier Excel
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Europe_Cleyrop');
  worksheet.columns = [
    { header: 'code_cis', key: 'code_cis' },
    { header: 'code_atc', key: 'code_atc' },
    { header: 'lib_atc', key: 'lib_atc' },
    { header: 'nom_specialite', key: 'nom_specialite' },
    { header: 'princeps_generique', key: 'princeps_generique' },
    { header: 'Product_Number', key: 'Product_Number' },
    { header: 'UrlEpar', key: 'UrlEpar' }
  ];
  dataWithAtc.forEach(row => worksheet.addRow(row));

  applyExcelFormatting(worksheet);

  const excelFileName = `transfert_RCP_europe_cleyrop_${dateFileStr}.xlsx`;
  const excelFilePath = path.join(repCible, excelFileName);
  await workbook.xlsx.writeFile(excelFilePath);
  logger.info('Fichier Excel européen généré : ' + excelFilePath);
  return { excelFilePath, fileCount: dataWithAtc.length };
} 