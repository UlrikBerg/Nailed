// Entry point. Loads .env, builds the Express app, starts listening.
require('dotenv').config();

const config = require('./backend/config');
const { buildApp } = require('./backend/app');

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

app.listen(config.port, () => {
  console.log(`Listening on http://localhost:${config.port}`);
});
