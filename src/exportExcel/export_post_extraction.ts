import ExcelJS from 'exceljs';
import path from 'path';
import { Knex } from 'knex';
import { applyExcelFormatting } from './excel_formatter.js';
import { logger } from '../logs_config.js';

// Helper function to derive new columns
function getDerivedColumns(nom_fichier_cible: string) {
    if (nom_fichier_cible.startsWith('R')) {
        return {
            type_document: 'RCP',
            repertoire_export: '\\FR\\RCP\\'
        };
    }
    if (nom_fichier_cible.startsWith('N')) {
        return {
            type_document: 'Notice',
            repertoire_export: '\\FR\\Notices\\'
        };
    }
    if (nom_fichier_cible.startsWith('E')) {
        return {
            type_document: 'RCP_Notice_EU',
            repertoire_export: '\\EU\\RCP_Notices\\'
        };
    }
    return {
        type_document: 'Inconnu',
        repertoire_export: ''
    };
}

/**
 * Exporte un fichier Excel "Cleyrop" avec des colonnes spécifiques et dérivées.
 */
export async function exportCleyropPostExtraction(db: Knex, idBatch: string, repCible: string, dateFileStr: string): Promise<string | null> {
    logger.info(`[Export Cleyrop] Début de l'export pour le batch ${idBatch}`);
    const dbRows = await db('liste_fichiers_copies').where({ id_batch: idBatch });
    if (dbRows.length === 0) {
        logger.warn(`[Export Cleyrop] Aucune donnée trouvée pour le batch ${idBatch}.`);
        return null;
    }

    const CLEYROP_COLUMNS_ORDER = [
        'nom_fichier_cible', 'code_cis', 'code_atc', 'lib_atc', 
        'nom_specialite', 'princeps_generique', 'type_document', 'repertoire_export'
    ];

    const processedData = dbRows.map(row => {
        const derived = getDerivedColumns(row.nom_fichier_cible);
        return {
            nom_fichier_cible: row.nom_fichier_cible,
            code_cis: row.code_cis,
            code_atc: row.code_atc,
            lib_atc: row.lib_atc,
            nom_specialite: row.nom_specialite,
            princeps_generique: row.princeps_generique,
            type_document: derived.type_document,
            repertoire_export: derived.repertoire_export
        };
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Export Cleyrop');
    worksheet.columns = CLEYROP_COLUMNS_ORDER.map(key => ({ header: key, key: key }));
    worksheet.addRows(processedData);

    applyExcelFormatting(worksheet);

    const excelFileName = `transfert_RcpNotice_cleyrop_${dateFileStr}.xlsx`;
    const excelFilePath = path.join(repCible, excelFileName);
    await workbook.xlsx.writeFile(excelFilePath);
    logger.info(`[Export Cleyrop] Fichier Excel généré : ${excelFilePath}`);
    return excelFilePath;
}

/**
 * Exporte un fichier Excel complet avec toutes les colonnes de la DB + colonnes dérivées.
 */
export async function exportFullPostExtraction(db: Knex, idBatch: string, repCible: string, dateFileStr: string): Promise<string | null> {
    logger.info(`[Export Full] Début de l'export pour le batch ${idBatch}`);
    const dbRows = await db('liste_fichiers_copies').where({ id_batch: idBatch });
    if (dbRows.length === 0) {
        logger.warn(`[Export Full] Aucune donnée trouvée pour le batch ${idBatch}.`);
        return null;
    }

    const processedData = dbRows.map(row => {
        const derived = getDerivedColumns(row.nom_fichier_cible);
        return {
            ...row,
            type_document: derived.type_document,
            repertoire_export: derived.repertoire_export
        };
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Export Complet');
    
    // Define columns based on the first processed row to include all fields
    if (processedData.length > 0) {
        worksheet.columns = Object.keys(processedData[0]).map(key => ({ header: key, key: key }));
    }
    
    worksheet.addRows(processedData);

    applyExcelFormatting(worksheet);

    const excelFileName = `transfert_RcpNotice_${dateFileStr}.xlsx`;
    const excelFilePath = path.join(repCible, excelFileName);
    await workbook.xlsx.writeFile(excelFilePath);
    logger.info(`[Export Full] Fichier Excel généré : ${excelFilePath}`);
    return excelFilePath;
}
