import fs from 'fs/promises';
import path from 'path';
import ExcelJS from 'exceljs';
import { Knex } from 'knex';
import mysql from 'mysql2/promise';
import { logger } from './logs_config.js';
import { applyExcelFormatting } from './excel_formatter.js';

// Utilitaire pour parser un CSV simple (séparateur ;)
async function parseCsvFile(filePath: string): Promise<any[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split(';');
  return lines.slice(1).map(line => {
    const values = line.split(';');
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = values[i] || '';
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

// Fonction principale d'export
export async function exportEuropeCleyropExcel({
  poolCodexExtract,
  repSource,
  repCible,
  dateFileStr
}: {
  poolCodexExtract: mysql.Pool,
  repSource: string,
  repCible: string,
  dateFileStr: string
}): Promise<string | null> {
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
    return null;
  }
  logger.info('Traitement du fichier CSV européen : ' + csvPath);

  // Lecture et parsing du CSV
  const rows = await parseCsvFile(csvPath);
  if (rows.length === 0) {
    logger.warn('Le fichier CSV est vide.');
    return null;
  }

  // Préparation des données pour Excel
  // Renommer SpecId en code_cis, ajouter code_atc en 2e position
  const dataWithAtc: any[] = [];
  for (const row of rows) {
    const code_cis = row['SpecId'] || '';
    const code_atc = code_cis ? await getCodeAtcForCis(poolCodexExtract, code_cis) : '';
    const excelRow = {
      code_cis,
      code_atc,
      Product_Number: row['Product_Number'] || '',
      UrlEpar: row['UrlEpar'] || ''
    };
    dataWithAtc.push(excelRow);
  }

  // Création du fichier Excel
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Europe_Cleyrop');
  worksheet.columns = [
    { header: 'code_cis', key: 'code_cis' },
    { header: 'code_atc', key: 'code_atc' },
    { header: 'Product_Number', key: 'Product_Number' },
    { header: 'UrlEpar', key: 'UrlEpar' }
  ];
  dataWithAtc.forEach(row => worksheet.addRow(row));

  applyExcelFormatting(worksheet);

  const excelFileName = `transfert_RCP_europe_cleyrop_${dateFileStr}.xlsx`;
  const excelFilePath = path.join(repCible, excelFileName);
  await workbook.xlsx.writeFile(excelFilePath);
  logger.info('Fichier Excel européen généré : ' + excelFilePath);
  return excelFilePath;
} 