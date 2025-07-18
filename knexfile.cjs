/**
 * @type { Object.<string, import("knex").Knex.Config> }
 */
module.exports = {
  development: {
    client: 'sqlite3',
    connection: {
      filename: './logs/copie_fichiers.db'
    },
    useNullAsDefault: true,
    migrations: {
      directory: './src/db/migrations'
    }
  }
};
