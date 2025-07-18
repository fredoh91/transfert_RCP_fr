import mysql from 'mysql2/promise';
import path from 'path';
import { fileURLToPath } from 'url';
// import 'dotenv/config'
import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';
// const envPath = path.resolve(__dirname, '..', '.env');
const currentUrl = import.meta.url;
const currentDir = path.dirname(fileURLToPath(currentUrl));
const envPath = path.resolve(currentDir, '..', '.env');
dotenv.config({ path: envPath });
// -------------------------------------------------------------------------------
// --            Création d'un pool de connexion pour la base CODEX_extract     --
// -------------------------------------------------------------------------------
/**
 *
 * @returns pool
 */
async function createPoolCodexExtract() {
    try {
        const { CODEX_extract_HOST, CODEX_extract_USER, CODEX_extract_PASSWORD, CODEX_extract_DATABASE } = process.env;
        if (!CODEX_extract_HOST || !CODEX_extract_USER || !CODEX_extract_PASSWORD || !CODEX_extract_DATABASE) {
            throw new Error('Une ou plusieurs variables d\'environnement pour la connexion à la BDD sont manquantes.');
        }
        const pool = mysql.createPool({
            host: CODEX_extract_HOST,
            user: CODEX_extract_USER,
            password: CODEX_extract_PASSWORD,
            database: CODEX_extract_DATABASE,
            charset: 'utf8mb4' // Ensure UTF-8 encoding
        });
        console.log('Pool BDD CODEX_extract ouvert');
        logger.info('Pool BDD CODEX_extract ouvert');
        return pool;
    }
    catch (err) {
        console.error('Erreur à la connexion de CODEX_extract :', err);
        logger.error('Erreur à la connexion de CODEX_extract :', err);
        throw err;
    }
}
// -------------------------------------------------------------------------------
// --                          Ferme le pool CODEX_extract                      --
// -------------------------------------------------------------------------------
/**
 *
 * @param {*} pool : pool vers SUSAR_EU qui sera fermé
 */
async function closePoolCodexExtract(pool) {
    try {
        console.log('Fermeture du pool vers la BDD CODEX_extract');
        logger.info('Fermeture du pool vers la BDD CODEX_extract');
        await pool.end();
    }
    catch (err) {
        console.error('Erreur à la fermeture de la connexion de CODEX_extract :', err);
        logger.error('Erreur à la fermeture de la connexion de CODEX_extract :', err);
        throw err;
    }
}
;
export { createPoolCodexExtract, closePoolCodexExtract, };
