import type { RowDataPacket } from 'mysql2/promise';

export type ListeRCPRow = RowDataPacket & {
  code_cis: string;
  nom_vu: string;
  dbo_autorisation_lib_abr: string;
  dbo_classe_atc_lib_abr: string;
  dbo_classe_atc_lib_court: string;
  doc_id: number;
  hname: string;
};
