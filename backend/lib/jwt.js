const jwt = require('jsonwebtoken');
const config = require('../config');
const { HttpError } = require('./util');

function ensureSecret() {
  if (!config.jwt.secret) {
    throw new HttpError(503, 'jwt_not_configured',
      'Server-secret er ikke konfigurert. Sett JWT_SECRET i miljovariabel og restart serveren.');
  }
}

function issueAccessToken(user) {
  ensureSecret();
  const payload = {
    sub: String(user.id),
    role: user.role,
    email: user.email,
    name: user.name,
  };
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.accessTtlSeconds,
    issuer: 'nailed',
  });
}

function verifyAccessToken(token) {
  ensureSecret();
  return jwt.verify(token, config.jwt.secret, { issuer: 'nailed' });
}

module.exports = { issueAccessToken, verifyAccessToken };
