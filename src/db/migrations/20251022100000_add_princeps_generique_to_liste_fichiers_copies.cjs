exports.up = function(knex) {
  return knex.schema.table('liste_fichiers_copies', function(table) {
    table.string('princeps_generique').nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.table('liste_fichiers_copies', function(table) {
    table.dropColumn('princeps_generique');
  });
};
