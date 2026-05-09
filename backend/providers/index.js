const google = require('./google');
const vipps = require('./vipps');

const providers = { google, vipps };

function getProvider(id) {
  const p = providers[id];
  if (!p) {
    const err = new Error(`Unknown auth provider: ${id}`);
    err.status = 404;
    throw err;
  }
  return p;
}

function listEnabled() {
  return Object.values(providers).filter(p => p.isEnabled());
}

module.exports = { providers, getProvider, listEnabled };
