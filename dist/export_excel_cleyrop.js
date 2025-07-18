import ExcelJS from 'exceljs';
import path from 'path';
const CLEYROP_COLUMNS = [
    'id',
    'nom_fichier_cible',
    'code_cis',
    'code_atc',
    'date_copie_sftp',
    'resultat_copie_sftp',
    'id_batch',
];
/**
 * Exporte les lignes de la table liste_fichiers_copies pour un id_batch donné dans un fichier Excel Cleyrop (colonnes réduites).
 * @param db Instance Knex connectée à la base
 * @param idBatch L'identifiant du batch à exporter
 * @param repCible Le répertoire cible où écrire le fichier
 * @param dateFileStr Suffixe date/heure pour le nom du fichier (AAAAMMJJ_HHMMSS)
 * @returns Le chemin du fichier Excel généré
 */
export async function exportListeFichiersCopiesCleyropExcel(db, idBatch, repCible, dateFileStr) {
    const rows = await db('liste_fichiers_copies').where({ id_batch: idBatch });
    if (rows.length === 0)
        return null;
    // Ne garder que les colonnes demandées
    const filteredRows = rows.map(row => {
        const filtered = {};
        for (const col of CLEYROP_COLUMNS) {
            filtered[col] = row[col] ?? '';
        }
        return filtered;
    });
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Cleyrop');
    worksheet.columns = CLEYROP_COLUMNS.map(key => ({ header: key, key }));
    filteredRows.forEach(row => worksheet.addRow(row));
    const excelFileName = `transfert_RCP_fr_cleyrop_${dateFileStr}.xlsx`;
    const excelFilePath = path.join(repCible, excelFileName);
    await workbook.xlsx.writeFile(excelFilePath);
    return excelFilePath;
}
