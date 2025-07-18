/**
 * @param {import('knex').Knex} knex
 */
exports.up = function(knex) {
  return knex.schema.createTable('liste_id_batch', function(table) {
    table.increments('id').primary();
    table.string('id_batch').notNullable();
    table.dateTime('debut_batch').notNullable();
    table.dateTime('fin_batch').nullable();
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('liste_id_batch');
};
