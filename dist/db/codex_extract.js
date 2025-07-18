import mysql from 'mysql2/promise';
import { logger } from '../logs_config.js';
let poolCodexExtract = null;
export async function createPoolCodexExtract() {
    try {
        if (!poolCodexExtract) {
            poolCodexExtract = mysql.createPool({
                host: process.env.CODEX_extract_HOST,
                user: process.env.CODEX_extract_USER,
                password: process.env.CODEX_extract_PASSWORD,
                database: process.env.CODEX_extract_DATABASE,
                port: Number(process.env.CODEX_extract_PORT),
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0
            });
            logger.info('Pool de connexions Codex Extract cree avec succes');
        }
        return poolCodexExtract;
    }
    catch (error) {
        logger.error({ err: error }, 'Erreur lors de la creation du pool de connexions Codex Extract');
        throw error;
    }
}
export async function closePoolCodexExtract() {
    if (poolCodexExtract) {
        try {
            await poolCodexExtract.end();
            logger.info('Pool de connexions Codex Extract ferme avec succes.');
            poolCodexExtract = null;
        }
        catch (error) {
            logger.error({ err: error }, 'Erreur lors de la fermeture du pool de connexions Codex Extract');
            throw error;
        }
    }
}
export async function getListeRCP(pool) {
    let connection = null;
    try {
        connection = await pool.getConnection();
        const query = `
            SELECT v.code_cis,
                   v.nom_vu,
                   v.dbo_autorisation_lib_abr,
                   v.dbo_classe_atc_lib_abr,
                   v.dbo_classe_atc_lib_court,
                   mh.doc_id,
                   mh.hname
            FROM vuutil v
            INNER JOIN mocatordocument_html mh ON v.code_vu = mh.spec_id
            WHERE v.dbo_statut_speci_lib_abr = 'Actif'
              AND LEFT(mh.hname, 1) = 'R';
        `;
        const [rows] = await connection.execute(query);
        logger.info(`Nombre de lignes retournees : ${rows.length}`);
        console.log(`Nombre de lignes retournees : ${rows.length}`);
        return rows;
    }
    catch (error) {
        logger.error({ err: error }, 'Erreur lors de la recuperation de la liste des RCP');
        throw error;
    }
    finally {
        if (connection) {
            connection.release();
        }
    }
}
