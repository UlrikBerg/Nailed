const jwt = require('jsonwebtoken');
const config = require('../config');

function issueAccessToken(user) {
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
  return jwt.verify(token, config.jwt.secret, { issuer: 'nailed' });
}

module.exports = { issueAccessToken, verifyAccessToken };
