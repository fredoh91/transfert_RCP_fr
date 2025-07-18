export const getSavuQuery = () => {
    return `
    SELECT
      codex.dbo.VU.codeVU,
      codex.dbo.VU.codeCIS,
      codex.dbo.VU.codeDossier,
      codex.dbo.VU.nomVU,
      codex.dbo.Composants.numElement,
      codex.dbo.Composants.codeSubstance,
      codex.dbo.Composants.numComposant,
      codex.dbo.Composants.codeUniteDosage,
      codex.dbo.Composants.codeNature,
      codex.dbo.Nature.libAbr AS libNature,
      codex.dbo.Composants.dosageLibraTypo,
      codex.dbo.Composants.dosageLibra,
      codex.dbo.VoieAdmin.libCourt,
      codex.dbo.NomsSubstance.nomSubstance,
      codex.dbo.VU.codeProduit,
      codex.dbo.FormePH.libCourt AS libFormePH,
      codex.dbo.NomsSubstance.libRech AS lib_rech_substance,
      codex.dbo.VU.libRech AS lib_rech_denomination
    FROM codex.dbo.VU
    INNER JOIN codex.dbo.StatutSpeci ON codex.dbo.VU.codeStatut = codex.dbo.StatutSpeci.codeTerme
    INNER JOIN codex.dbo.Composants ON codex.dbo.VU.codeVU = codex.dbo.Composants.codeVU
    INNER JOIN codex.dbo.NomsSubstance ON codex.dbo.Composants.codeNomSubstance = codex.dbo.NomsSubstance.codeNomSubstance
    INNER JOIN codex.dbo.VUVoiesAdmin ON codex.dbo.VU.codeVU = codex.dbo.VUVoiesAdmin.codeVU
    INNER JOIN codex.dbo.VoieAdmin ON codex.dbo.VUVoiesAdmin.codeVoie = codex.dbo.VoieAdmin.codeTerme
    LEFT JOIN codex.dbo.Nature ON codex.dbo.Composants.codeNature = codex.dbo.Nature.codeTerme
    INNER JOIN codex.dbo.VUElements ON codex.dbo.Composants.numElement = codex.dbo.VUElements.numElement AND codex.dbo.Composants.codeVU = codex.dbo.VUElements.codeVU
    INNER JOIN codex.dbo.FormePH ON codex.dbo.VUElements.codeFormePH = codex.dbo.FormePH.codeTerme
    WHERE (codex.dbo.Composants.codeNature = 3 OR codex.dbo.Composants.codeNature = 5)
    AND (codex.dbo.StatutSpeci.libAbr = 'Archivé' OR codex.dbo.StatutSpeci.libAbr = 'Actif')
    ORDER BY codex.dbo.VU.codeVU
  `;
};
export const getVuutilQuery = () => {
    return `
    SELECT
      v.codeVU,
      v.codeCIS,
      v.codeDossier,
      v.nomVU,
      a.libAbr AS autorisationLibAbr,
      catc.libAbr AS classeATCLibAbr,
      catc.libCourt AS classeATCLibCourt,
      vt.codeContact,
      c.nomContactLibra,
      c.adresseContact,
      c.adresseCompl,
      c.codePost,
      c.nomVille,
      c.telContact,
      c.faxContact,
      p.libCourt AS paysLibCourt,
      ss.libAbr AS statutSpeciLibAbr,
      CASE
        WHEN ss.libAbr = 'Archivé' THEN 'M'
        WHEN ss.libAbr = 'Actif' THEN 'V'
        ELSE ''
      END AS statutAbrege,
      va.codeActeur,
      va.codeTigre,
      va.nomActeurLong,
      va.adresse,
      va.adresseCompl AS adresseComplExpl,
      va.codePost AS codePostExpl,
      va.nomVille AS nomVilleExpl,
      va.complement,
      va.tel,
      va.fax,
      p.libAbr AS paysLibAbr,
      v.codeProduit,
      v.libRech AS lib_rech_denomination
    FROM codex.dbo.VU v
    INNER JOIN codex.dbo.Autorisation a ON v.codeAutorisation = a.codeTerme
    INNER JOIN codex.dbo.VUClassesATC vcatc ON v.codeVU = vcatc.codeVU
    INNER JOIN codex.dbo.ClasseATC catc ON vcatc.codeClasATC = catc.codeTerme
    INNER JOIN codex.dbo.VUTitulaires vt ON v.codeVU = vt.codeVU
    INNER JOIN codex.dbo.Contact c ON vt.codeContact = c.codeContact
    INNER JOIN codex.dbo.Pays p ON c.codePays = p.codeTerme
    INNER JOIN codex.dbo.StatutSpeci ss ON v.codeStatut = ss.codeTerme
    LEFT JOIN (
      SELECT
        va.codeVU,
        va.codeActeur,
        a.codeTigre,
        a.nomActeurLong,
        a.adresse,
        a.adresseCompl,
        a.codePost,
        a.nomVille,
        a.complement,
        a.tel,
        a.fax
      FROM codex.dbo.VUActeurs va
      INNER JOIN codex.dbo.Acteur a ON va.codeActeur = a.codeActeur
      WHERE va.codeRoleAct = 4 AND va.indicValide = 1
    ) va ON v.codeVU = va.codeVU
    WHERE (ss.libAbr = 'Archivé' OR ss.libAbr = 'Actif') AND vt.indicValide = 1
    ORDER BY v.codeVU
  `;
};
export const getCodexcodeAtcQuery = () => {
    return `
    SELECT
      libAbr AS CodeATC,
      libCourt,
      LEN(libAbr) AS NbCarCodeATC,
      CASE
        WHEN LEN(libAbr) = 1 THEN CONVERT(VARCHAR, 1)
        WHEN LEN(libAbr) = 3 THEN CONVERT(VARCHAR, 2)
        WHEN LEN(libAbr) = 4 THEN CONVERT(VARCHAR, 3)
        WHEN LEN(libAbr) = 5 THEN CONVERT(VARCHAR, 4)
        WHEN LEN(libAbr) = 7 THEN CONVERT(VARCHAR, 5)
        ELSE 'chelou'
      END AS TypeCodeATC
    FROM codex.dbo.ClasseATC
    GROUP BY libAbr, libCourt
  `;
};
export function getCodexpictoGrossesseQuery() {
    return `
    SELECT
        p.codeVU,
        p.numPresentation,
        p.nomPresentation,
        p.codeCIP,
        p.codeCIP13,
        p.statutComm,
        pe.codeEvntPres AS Code_Picto,
        dep.libCourt AS Lib_Picto 
    FROM codex.dbo.Presentations p
    INNER JOIN codex.dbo.PresentationEvnts pe
        ON p.numPresentation = pe.numPresentation
        AND p.codeVU = pe.codeVU
    INNER JOIN codex.dbo.DicoEvntPresentation dep
        ON pe.codeEvntPres = dep.codeTerme
    WHERE pe.codeEvntPres IN (50, 51, 52, 53)
  `;
}
export function getCodexpresentationQuery() {
    return `
    SELECT
      p.codeVU,
      p.numPresentation,
      p.nomPresentation,
      p.codeCIP,
      p.codeCIP13,
      p.statutComm,
      scp.libCourt AS infoCommCourt,
      scp.libLong AS infoCommLong
    FROM codex.dbo.Presentations p
    INNER JOIN codex.dbo.StatutCommPres scp ON p.statutComm = scp.codeTerme
  `;
}
export function getCodexvoieAdminQuery() {
    return `
    SELECT
      vva.codeVU,
      vva.codeVoie,
      va.libAbr,
      va.libCourt,
      va.libLong,
      va.libRech,
      va.numOrdreEdit,
      vva.indicValide
    FROM codex.dbo.VUVoiesAdmin vva
    INNER JOIN codex.dbo.VoieAdmin va ON vva.codeVoie = va.codeTerme
    WHERE vva.indicValide = 0
  `;
}
export function getDboComposantsHaumeaQuery() {
    return `
    SELECT
      codeVU,
      numElement,
      codeSubstance,
      numComposant,
      codeUniteDosage,
      codeNomSubstance,
      codeNature,
      qteDosage,
      dosageLibra,
      dosageLibraTypo,
      CEP,
      numOrdreEdit,
      remComposants,
      dateCreation,
      dateDernModif,
      indicValide,
      codeModif
    FROM codex.dbo.Composants
  `;
}
export function getDboContactHaumeaQuery() {
    return `
    SELECT
      codeContact,
      codePays,
      codeGroupeLabo,
      nomContact,
      libRech,
      codeAMM,
      codeLibra,
      codeMuse,
      nomContactLibra,
      adresseContact,
      adresseCompl,
      codePost,
      nomVille,
      telContact,
      faxContact,
      nomResponsable,
      indicCandidat,
      dateCreation,
      dateDernModif,
      codeOrigine,
      remContact,
      flagActif,
      codeModif
    FROM codex.dbo.Contact
  `;
}
export function getDboDossierHaumeaQuery() {
    return `
    SELECT
      codeVU,
      codeDossier,
      codeNatureCode,
      numOrdreEdit,
      dateDebut,
      dateFin,
      remDossier
    FROM codex.dbo.Dossier
  `;
}
export function getDboNomsSubstanceHaumeaQuery() {
    return `
    SELECT
      codeNomSubstance,
      codeSubstance,
      nomSubstance,
      libRech,
      codeDenom,
      codeOrigineNom,
      indicValide,
      nomValidePar,
      indicCandidat,
      dateCreation,
      dateDernModif
    FROM codex.dbo.NomsSubstance
  `;
}
export function getDboVuHaumeaQuery() {
    return `
    SELECT
      codeVU,
      codeCIS,
      codeDossier,
      codeProduit,
      codeInnovation,
      codeAutorisation,
      nomVU,
      libRech,
      codeVUCommun,
      numDossierCommun,
      codeVUPrinceps,
      dateAMM,
      remVU,
      indicValide,
      nomValidePar,
      dateCreation,
      dateDernModif,
      dateAutorisation,
      codeOrigine,
      commentaireVU,
      remNotes,
      flagNouvelle,
      codeStatut,
      statutQualif,
      codeModif,
      codePaysProvenance,
      nomVUTypo,
      nomCourt,
      nomCourtTypo,
      textSolvants
    FROM codex.dbo.VU
  `;
}
export function getDboVuTitulairesHaumeaQuery() {
    return `
    SELECT
      codeVU,
      codeContact,
      dateDebut,
      dateFin,
      identiteProvisoire,
      remCommentaire,
      indicValide,
      dateCreation,
      dateDernModif,
      codeModif
    FROM codex.dbo.VUTitulaires
  `;
}
export function getVudelivranceQuery() {
    return `
    SELECT
      vd.codeVU,
      vd.codeDelivrance,
      d.libLong
    FROM codex.dbo.VUDelivrance vd
    LEFT JOIN codex.dbo.Delivrance d ON vd.codeDelivrance = d.codeTerme
    ORDER BY vd.codeVU
  `;
}
export function getDashboardRs5CodeVUQuery() {
    return `
    SELECT DISTINCT codeVU
    FROM VU
    WHERE codeVU IS NOT NULL
  `;
}
export function getDashboardRs5Query(codeVUs) {
    const codeVUString = codeVUs.map(codeVU => `'${codeVU}'`).join(',');
    return `
    SELECT DISTINCT
      VU.codeVU as code_vu,
      VU.codeCIS as code_cis,
      VU.codeDossier as code_dossier,
      VU.nomVU as nom_vu,
      Autorisation.libAbr as type_procedure,
      ClasseATC.libAbr as code_atc,
      ClasseATC.libCourt as lib_atc,
      VUElements.nomElement as forme_pharma,
      VoieAdmin.libCourt as voie_admin,
      StatutSpeci.libAbr as statut_specialite,
      StatutSpeci.codeTerme as code_terme,
      VU.codeProduit as code_produit,
      VUTitulaires.indicValide as indic_valide,
      Presentations.codeCIP13 as code_cip13,
      Presentations.nomPresentation as nom_presentation,
      NomsSubstance.nomSubstance as nom_substance,
      Composants.dosageLibra as dosage_libra,
      (SELECT ClasseACP.libCourt
       FROM VUClassesACP
       INNER JOIN ClasseACP ON VUClassesACP.codeClasACP = ClasseACP.codeTerme
       WHERE VUClassesACP.codeVU = VU.codeVU
       AND ClasseACP.codeTermePere = 300) as classe_acp_lib_court
    FROM VU
    INNER JOIN Autorisation ON VU.codeAutorisation = Autorisation.codeTerme
    INNER JOIN VUClassesATC ON VU.codeVU = VUClassesATC.codeVU
    INNER JOIN ClasseATC ON VUClassesATC.codeClasATC = ClasseATC.codeTerme
    INNER JOIN VUTitulaires ON VU.codeVU = VUTitulaires.codeVU
    INNER JOIN StatutSpeci ON VU.codeStatut = StatutSpeci.codeTerme
    INNER JOIN VUElements ON VU.codeVU = VUElements.codeVU
    INNER JOIN VUVoiesAdmin ON VU.codeVU = VUVoiesAdmin.codeVU
    INNER JOIN VoieAdmin ON VUVoiesAdmin.codeVoie = VoieAdmin.codeTerme
    INNER JOIN Presentations ON VU.codeVU = Presentations.codeVU
    INNER JOIN Composants ON VU.codeVU = Composants.codeVU
    INNER JOIN NomsSubstance ON Composants.codeNomSubstance = NomsSubstance.codeNomSubstance
    WHERE StatutSpeci.codeTerme = 1
      AND VUTitulaires.indicValide = 1
      AND Presentations.flagActif = 0
      AND Composants.codeNature = 3
      AND VU.codeVU IN (${codeVUString})
    ORDER BY VU.codeVU, Presentations.codeCIP13
  `;
}
export function getMocatorDocumentQuery() {
    return `
    SELECT 
      d.DocId,
      d.GrpId,
      d.NotId,
      d.DateArch,
      d.DateNotif,
      d.SrceName,
      d.SrceSize,
      d.SrceLastUpd,
      d.NativeFormat,
      d.ServerName,
      d.Rem,
      d.Author,
      d.SeanceId,
      d.DateSeance
    FROM MOCATOR.dbo.Document d
  `;
}
export function getMocatorDocumentHtmlQuery() {
    return `
    SELECT 
      dh.HdocId,
      dh.SpecId,
      dh.DocId,
      dh.TypId,
      dh.HName,
      dh.DateConv
    FROM MOCATOR.dbo.DocumentHTML dh
  `;
}
export function getMocatorDocumentXmlQuery() {
    return `
    SELECT 
      dx.XdocId,
      dx.codeVU,
      dx.DocId,
      dx.NatureDoc,
      dx.StatutDoc,
      dx.Auteur,
      dx.ServerName,
      dx.SrceName,
      dx.SrceSize,
      dx.SrceLastUpd,
      dx.NativeFormat,
      dx.VersionDTD,
      dx.DocJoint,
      dx.NumOrdre,
      dx.DateMajAMM,
      dx.DateValide,
      dx.DateLiv,
      dx.DateArch,
      dx.Commentaire
    FROM MOCATOR.dbo.DocumentXML dx
  `;
}
