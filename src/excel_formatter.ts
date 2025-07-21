import ExcelJS from 'exceljs';

export function applyExcelFormatting(worksheet: ExcelJS.Worksheet) {
    // 1. Figer la ligne d'en-tête
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];

    // 2. Ajouter un filtre automatique sur la ligne d'en-tête
    if (worksheet.columns.length > 0) {
        worksheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: worksheet.columns.length }
        };
    }

    // 3. Ajuster la largeur de chaque colonne à son contenu
    worksheet.columns.forEach(column => {
        let maxLength = 0;
        // On vérifie la longueur de l'en-tête
        if (column.header) {
            maxLength = column.header.toString().length;
        }
        // On vérifie la longueur de chaque cellule de la colonne
        column.eachCell!({ includeEmpty: true }, cell => {
            const cellLength = cell.value ? cell.value.toString().length : 0;
            if (cellLength > maxLength) {
                maxLength = cellLength;
            }
        });
        // On applique la largeur avec une petite marge, et une largeur minimale
        column.width = (maxLength < 12 ? 12 : maxLength) + 2;
    });
} 