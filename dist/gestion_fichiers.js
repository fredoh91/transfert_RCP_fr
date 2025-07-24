import fs from "fs/promises";
import path from "path";
import { logger } from './logs_config.js';
let compteurCopies = 0;
/**
 * Copie un fichier RCP du dossier source vers le dossier cible, selon les variables d'environnement.
 * @param nomFichier Le nom du fichier à copier (ex: R0152678.htm)
 * @throws Erreur si la copie échoue ou si les variables d'environnement sont manquantes
 */
export async function copierFichierRCP(nomFichier, codeCIS, codeATC, repCible) {
    const repSource = process.env.REP_RCP_SOURCE;
    if (!repSource || !repCible) {
        throw new Error("Variables d'environnement REP_RCP_SOURCE ou REP_RCP_CIBLE manquantes");
    }
    // Extraire le caractère de gauche (premier caractère) du nom du fichier
    const premierCaractere = nomFichier.charAt(0);
    // Extraire l'extension du fichier (ex: .htm)
    const extension = path.extname(nomFichier);
    // Compléter le code ATC à droite par des underscores si moins de 7 caractères
    const codeATCComplet = codeATC.length < 7 ? codeATC.padEnd(7, "_") : codeATC;
    // Construire le nouveau nom de fichier
    const nouveauNom = `${premierCaractere}_${codeCIS}_${codeATCComplet}${extension}`;
    const cheminSource = path.join(repSource, nomFichier);
    const cheminCible = path.join(repCible, nouveauNom);
    // Vérifier si le fichier existe déjà dans le répertoire cible
    try {
        await fs.access(cheminCible);
        // Si pas d'erreur, le fichier existe déjà
        return { statut: "FICHIER_DEJA_PRESENT", nouveauNom };
    }
    catch (err) {
        // Si erreur, le fichier n'existe pas, on continue
    }
    // Vérifier si le fichier source existe avant de tenter la copie
    try {
        await fs.access(cheminSource);
    }
    catch (err) {
        // Le fichier source n'existe pas
        logger.warn(`⚠️ Fichier source introuvable : ${cheminSource}`);
        return { statut: "FICHIER_SOURCE_INTROUVABLE", nouveauNom };
    }
    await fs.copyFile(cheminSource, cheminCible);
    compteurCopies++;
    if (compteurCopies % 100 === 0) {
        console.log(`✅ ${compteurCopies} fichiers copiés : ${nouveauNom}`);
        logger.info(`✅ ${compteurCopies} fichiers copiés : ${nouveauNom}`);
    }
    return { statut: "FICHIER_COPIE", nouveauNom };
}
export async function verifierCopieFichier(nomFichier, codeCIS, codeATC, repCible) {
    const premierCaractere = nomFichier.charAt(0);
    // Extraire l'extension du fichier (ex: .htm)
    const extension = path.extname(nomFichier);
    // Compléter le code ATC à droite par des underscores si moins de 7 caractères
    const codeATCComplet = codeATC.length < 7 ? codeATC.padEnd(7, "_") : codeATC;
    // Construire le nouveau nom de fichier
    const nouveauNom = `${premierCaractere}_${codeCIS}_${codeATCComplet}${extension}`;
    const cheminCible = path.join(repCible, nouveauNom);
    try {
        await fs.access(cheminCible);
        return 'COPIE OK';
    }
    catch {
        return 'COPIE KO';
    }
}
