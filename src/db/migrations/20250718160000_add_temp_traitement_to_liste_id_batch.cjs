exports.up = function(knex) {
  return knex.schema.table('liste_id_batch', function(table) {
    table.bigInteger('temp_traitement'); // INTEGER en SQLite = 8 octets (le plus grand possible)
  });
};

exports.down = function(knex) {
  return knex.schema.table('liste_id_batch', function(table) {
    table.dropColumn('temp_traitement');
  });
}; 