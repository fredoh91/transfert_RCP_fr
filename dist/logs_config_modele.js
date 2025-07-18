import { pino } from 'pino';
import logrotateStream from 'logrotate-stream';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// Fonction de calcul de la prochaine date de rotation (non utilisee actuellement)
/*
function getNextRotationDate(currentDate: Date): Date {
    const nextDate = new Date(currentDate);
    nextDate.setMonth(nextDate.getMonth() + 1); // Ajoute un mois
    return nextDate;
}
*/
// Specifiez le repertoire des fichiers de journal
const currentUrl = import.meta.url;
const currentDir = path.dirname(fileURLToPath(currentUrl));
const logDirectory = path.resolve(currentDir, '../logs');
// const logDirectory = '../logs';
const prefixFichierLog = "transf_RCP_fr_";
// Creez le repertoire s'il n'existe pas
if (!fs.existsSync(logDirectory)) {
    fs.mkdirSync(logDirectory);
}
// Obtenez la date actuelle au format 'YYYY-MM' (annee-mois) en utilisant les methodes natives de l'objet Date
const currentDate = new Date();
const currentYear = currentDate.getFullYear();
const currentMonth = String(currentDate.getMonth() + 1).padStart(2, '0'); // Ajoute un zero devant si necessaire
// Specifiez le chemin du fichier de journal avec l'annee et le mois
const logFile = `${prefixFichierLog}_${currentYear}-${currentMonth}.log`;
const logFilePath = path.join(logDirectory, logFile);
// Verifie si le fichier de journal existe, sinon le creer
if (!fs.existsSync(logFilePath)) {
    try {
        // Cree le fichier de journal s'il n'existe pas
        fs.writeFileSync(logFilePath, '');
    }
    catch (error) {
        console.error('Erreur lors de la creation du fichier de journal :', error);
        process.exit(1); // Arrêter le processus en cas d'erreur
    }
}
// Creez un flux de rotation des journaux
const logStream = logrotateStream({
    file: logFilePath,
    size: '10M', // Taille maximale du fichier de journal avant rotation
    keep: 12, // Nombre de fichiers de journal à conserver (pour un mois)
    compress: true // Compression des fichiers de journal archives
});
const logger = pino({
    level: 'debug', // level: niveau de log minimal
    // level: 'info', 
}, logStream);
const flushAndExit = (code) => {
    // Utiliser write pour vider le buffer avant de quitter
    logStream.write('', () => {
        process.exit(code);
    });
};
// Exporter les instances de stream et logger
export { logStream, logger, flushAndExit };
