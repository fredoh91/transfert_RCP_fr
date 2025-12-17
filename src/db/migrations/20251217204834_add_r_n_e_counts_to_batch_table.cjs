exports.up = function(knex) {
  return knex.schema.table('liste_id_batch', function(table) {
    table.integer('nb_fichiers_R').notNullable().defaultTo(0);
    table.integer('nb_fichiers_N').notNullable().defaultTo(0);
    table.integer('nb_fichiers_E').notNullable().defaultTo(0);
  });
};

exports.down = function(knex) {
  return knex.schema.table('liste_id_batch', function(table) {
    table.dropColumn('nb_fichiers_R');
    table.dropColumn('nb_fichiers_N');
    table.dropColumn('nb_fichiers_E');
  });
};
