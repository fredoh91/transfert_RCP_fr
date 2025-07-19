exports.up = function(knex) {
  return knex.schema.table('liste_fichiers_copies', function(table) {
    table.string('type_document').nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.table('liste_fichiers_copies', function(table) {
    table.dropColumn('type_document');
  });
}; 