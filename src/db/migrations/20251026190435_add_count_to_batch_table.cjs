'use strict';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.table('liste_id_batch', function(table) {
    table.integer('nb_fichiers_traites').notNullable().defaultTo(0);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.table('liste_id_batch', function(table) {
    table.dropColumn('nb_fichiers_traites');
  });
};