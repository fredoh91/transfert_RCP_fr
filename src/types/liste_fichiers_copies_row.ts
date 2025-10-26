export type ListeFichiersCopiesRow = {
  id?: number;
  rep_fichier_source: string;
  nom_fichier_source: string;
  rep_fichier_cible: string;
  nom_fichier_cible: string;
  code_cis: string;
  code_atc: string;
  date_copie_rep_tempo?: string | Date | null; // DATETIME (ISO string ou Date)
  resultat_copie_rep_tempo?: string | null;
  date_copie_sftp?: string | Date | null; // DATETIME, nullable
  resultat_copie_sftp?: string | null;
  id_batch?: string;
  type_document?: string | null;
  lib_atc?: string | null;
  nom_specialite?: string | null;
  princeps_generique?: string | null;
}; 