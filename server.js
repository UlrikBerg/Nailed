// Entry point. Loads .env, builds the Express app, starts listening.
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('./backend/config');
const { buildApp } = require('./backend/app');

// Idempotent schema apply on boot. backend/schema.sql is built from CREATE
// TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS, so running it on every boot
// is cheap and lets a `git pull && restart` workflow stay one-step. We fail
// SOFT — a migration error logs the issue but doesn't prevent the app from
// listening (the alternative is a degraded site if the DB is briefly flaky).
async function applySchemaOnBoot() {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'backend', 'schema.sql'), 'utf8');
    const connOpts = {
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      multipleStatements: true,
      charset: 'utf8mb4',
    };
    if (config.db.socket) connOpts.socketPath = config.db.socket;
    else { connOpts.host = config.db.host; connOpts.port = config.db.port; }
    const conn = await mysql.createConnection(connOpts);
    await conn.query(sql);
    await conn.end();
    console.log('Schema applied on boot.');
  } catch (err) {
    console.error('Schema apply failed (continuing):', err.message);
  }
}

// Startup banner — prints config status so missing env vars are obvious in logs
// (Hostinger Node logs, PM2, journalctl, etc.).
function logStartupStatus() {
  const lines = [];
  lines.push(`nailed server — env=${config.env} port=${config.port}`);
  lines.push(`  storage:  ${config.storage.backend}`);
  if (config.db.socket) {
    lines.push(`  database: ${config.db.user}@${config.db.socket}/${config.db.database} (socket)`);
  } else {
    lines.push(`  database: ${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database} (tcp)`);
  }
  lines.push(`  jwt:      ${config.jwt.secret ? 'configured' : 'NOT SET — auth endpoints will return 503'}`);
  lines.push(`  google:   ${config.google.enabled() ? 'enabled' : 'disabled'}`);
  lines.push(`  vipps:    ${config.vipps.enabled() ? 'enabled' : 'disabled'}`);
  console.log(lines.join('\n'));

  if (config.issues.length) {
    console.log('\nConfig issues:');
    for (const i of config.issues) {
      console.log(`  [${i.severity}] ${i.name} — ${i.hint}`);
    }
    console.log('');
  }
}

const app = buildApp();
logStartupStatus();

(async () => {
  await applySchemaOnBoot();
  app.listen(config.port, () => {
    console.log(`Listening on http://localhost:${config.port}`);
  });
})();
