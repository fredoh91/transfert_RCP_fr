
exports.up = function(knex) {
  return knex.schema.table('liste_fichiers_copies', function(table) {
    table.string('id_batch');
  });
};

exports.down = function(knex) {
  return knex.schema.table('liste_fichiers_copies', function(table) {
    table.dropColumn('id_batch');
  });
};
