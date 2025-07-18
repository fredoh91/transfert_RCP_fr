
exports.up = function(knex) {
  return knex.schema.createTable('liste_fichiers_copies', function(table) {
    table.increments('id').primary();
    table.string('rep_fichier_source');
    table.string('nom_fichier_source');
    table.string('rep_fichier_cible');
    table.string('nom_fichier_cible');
    table.string('code_cis');
    table.string('code_atc');
    table.datetime('date_copie_rep_tempo').defaultTo(knex.fn.now());
    table.string('resultat_copie_rep_tempo');
    table.datetime('date_copie_sftp').nullable().defaultTo(null);
    table.string('resultat_copie_sftp');
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('liste_fichiers_copies');
};
