import ExcelJS from 'exceljs';
import path from 'path';
import { Knex } from 'knex';
import { applyExcelFormatting } from './excel_formatter.js';

/**
 * Exporte les lignes de la table liste_fichiers_copies pour un id_batch donné dans un fichier Excel.
 * @param db Instance Knex connectée à la base
 * @param idBatch L'identifiant du batch à exporter
 * @param repCible Le répertoire cible où écrire le fichier
 * @param dateFileStr Suffixe date/heure pour le nom du fichier (AAAAMMJJ_HHMMSS)
 * @returns Le chemin du fichier Excel généré
 */
export async function exportListeFichiersCopiesExcel(db: Knex, idBatch: string, repCible: string, dateFileStr: string): Promise<string | null> {
  const rows = await db('liste_fichiers_copies')
    .where({ id_batch: idBatch })
    .whereNot('type_document', 'RCP_Notice_EU');
  if (rows.length === 0) return null;

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Copies');
  worksheet.columns = Object.keys(rows[0]).map(key => ({ header: key, key }));
  rows.forEach(row => worksheet.addRow(row));

  applyExcelFormatting(worksheet);

  const excelFileName = `transfert_RCP_fr_${dateFileStr}.xlsx`;
  const excelFilePath = path.join(repCible, excelFileName);
  await workbook.xlsx.writeFile(excelFilePath);
  return excelFilePath;
} 