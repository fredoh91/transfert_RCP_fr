import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
// Chemin du fichier SQLite (dans le dossier logs)
const dbPath = path.join(process.cwd(), 'logs', 'copie_fichiers.db');
let db;
export async function initCopieFichiersDB() {
    db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });
    await db.exec(`
    CREATE TABLE IF NOT EXISTS liste_fichiers_copies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rep_fichier_source TEXT,
      nom_fichier_source TEXT,
      rep_fichier_cible TEXT,
      nom_fichier_cible TEXT,
      code_cis TEXT,
      code_atc TEXT,
      date_copie_rep_tempo DATETIME DEFAULT CURRENT_TIMESTAMP,
      resultat_copie_rep_tempo TEXT,
      date_copie_sftp DATETIME DEFAULT NULL,
      resultat_copie_sftp TEXT,
      id_batch TEXT
    )
  `);
}
export async function logCopieFichier(row) {
    if (!db)
        await initCopieFichiersDB();
    const hasTypeDocument = 'type_document' in row;
    if (hasTypeDocument) {
        await db.run(`INSERT INTO liste_fichiers_copies (
        rep_fichier_source, nom_fichier_source, rep_fichier_cible, nom_fichier_cible, code_cis, code_atc,
        date_copie_rep_tempo, resultat_copie_rep_tempo, date_copie_sftp, resultat_copie_sftp, id_batch, type_document , lib_atc, nom_specialite
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, row.rep_fichier_source, row.nom_fichier_source, row.rep_fichier_cible, row.nom_fichier_cible, row.code_cis, row.code_atc, row.date_copie_rep_tempo, row.resultat_copie_rep_tempo, row.date_copie_sftp, row.resultat_copie_sftp, row.id_batch, row.type_document, row.lib_atc, row.nom_specialite);
    }
    else {
        await db.run(`INSERT INTO liste_fichiers_copies (
        rep_fichier_source, nom_fichier_source, rep_fichier_cible, nom_fichier_cible, code_cis, code_atc,
        date_copie_rep_tempo, resultat_copie_rep_tempo, date_copie_sftp, resultat_copie_sftp, id_batch, lib_atc, nom_specialite
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, row.rep_fichier_source, row.nom_fichier_source, row.rep_fichier_cible, row.nom_fichier_cible, row.code_cis, row.code_atc, row.date_copie_rep_tempo, row.resultat_copie_rep_tempo, row.date_copie_sftp, row.resultat_copie_sftp, row.id_batch, row.lib_atc, row.nom_specialite);
    }
}
