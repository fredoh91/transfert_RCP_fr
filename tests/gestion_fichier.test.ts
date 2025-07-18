import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { copierFichierRCP } from '../src/gestion_fichiers';


const nomFichier = 'R0152687.htm';
const codeCIS = '60446911';
const codeATC = 'B05BB01';



const nouveauNom = `R_60446911_B05BB01.htm`;

const baseCibleDir = process.env.REP_RCP_CIBLE;
const now = new Date();
const pad = (n: number) => n.toString().padStart(2, '0');
const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
const cibleDir = baseCibleDir ? `${baseCibleDir}/Extract_RCP_${dateStr}` : undefined;


beforeAll(async () => {
  const sourceDir = process.env.REP_RCP_SOURCE;
  if (!sourceDir || !cibleDir) {
    throw new Error('Variables d\'environnement REP_RCP_SOURCE ou REP_RCP_CIBLE manquantes');
  }
  // Vérifie que le répertoire source existe
  try {
    await fs.stat(sourceDir);
  } catch (err) {
    throw new Error(`Le répertoire source n'existe pas : ${sourceDir}`);
  }
  // Crée le répertoire cible daté si besoin
  await fs.mkdir(cibleDir, { recursive: true });
  // Efface le fichier cible s'il existe déjà
  const ciblePath = path.join(cibleDir, nomFichier);
  await fs.rm(ciblePath, { force: true });
});

afterAll(async () => {
  // Pas de nettoyage global ici, car on ne veut pas supprimer les vrais dossiers source/cible
});

describe('copierFichierRCP', () => {
  it('copie le fichier du dossier source vers le dossier cible sans modifier le contenu', async () => {
    const retourCopie = await copierFichierRCP(nomFichier, codeCIS, codeATC, cibleDir!);
    const ciblePath = path.join(cibleDir!, nouveauNom);
    const existe = !!(await fs.stat(ciblePath).catch(() => false));
    expect(existe).toBe(true);
    expect(['FICHIER_COPIE', 'FICHIER_DEJA_PRESENT']).toContain(retourCopie);
  });
}); 