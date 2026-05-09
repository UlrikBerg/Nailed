// Apply backend/schema.sql to the configured MySQL database.
// Usage: npm run db:setup

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('./config');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    multipleStatements: true,
    charset: 'utf8mb4',
  });

  console.log(`Applying schema to ${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database} ...`);
  await conn.query(sql);
  console.log('Schema applied.');
  await conn.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
