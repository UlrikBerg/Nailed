// Entry point. Loads .env, builds the Express app, starts listening.
require('dotenv').config();

const config = require('./backend/config');
const { buildApp } = require('./backend/app');

const app = buildApp();

app.listen(config.port, () => {
  console.log(`nailed server running on http://localhost:${config.port}`);
});
