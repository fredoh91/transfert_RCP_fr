

exports.up = function(knex) {
    return knex.schema.table('liste_fichiers_copies', function(table) {
        table.string('lib_atc').nullable();
        table.string('nom_specialite').nullable();
  });
}

exports.down = function(knex) {
    return knex.schema.table('liste_fichiers_copies', function(table) {
        table.dropColumn('lib_atc');
        table.dropColumn('nom_specialite');
    });
}
