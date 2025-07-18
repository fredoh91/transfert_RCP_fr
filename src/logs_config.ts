
import { pino } from 'pino';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import logrotateStream from 'logrotate-stream';

// Specifiez le repertoire des fichiers de journal
const currentUrl = import.meta.url;
const currentDir = path.dirname(fileURLToPath(currentUrl));
const logDirectory = path.resolve(currentDir, '../logs');
const prefixFichierLog = "transf_RCP_fr_"

// Creez le repertoire s'il n'existe pas
if (!fs.existsSync(logDirectory)) {
  fs.mkdirSync(logDirectory, { recursive: true });
}

// Obtenez la date actuelle au format 'YYYY-MM' (annee-mois) en utilisant les methodes natives de l'objet Date
const currentDate = new Date();
const currentYear = currentDate.getFullYear();
const currentMonth = String(currentDate.getMonth() + 1).padStart(2, '0'); // Ajoute un zero devant si necessaire
// Specifiez le chemin du fichier de journal avec l'annee et le mois
const logFile = `${prefixFichierLog}_${currentYear}-${currentMonth}.log`;

const logFilePath = path.join(logDirectory, logFile);

// Creez un flux de rotation des journaux
const logStream = logrotateStream({
    file: logFilePath,
    size: '10M', // Taille maximale du fichier de journal avant rotation
    keep: 12, // Nombre de fichiers de journal a conserver (pour un mois)
    compress: true // Compression des fichiers de journal archives
  });

const logger = pino({
    level: 'debug', // level: niveau de log minimal
    timestamp: () => `,"time":"${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(/\//g, '/')}"`,
    formatters: {
        level: (label) => { return { level: label.toUpperCase() }; },
    },
  }, logStream);

export { logger };
