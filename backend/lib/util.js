const crypto = require('crypto');

function randomBase64Url(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// PKCE: code_verifier is a random string; code_challenge = base64url(sha256(verifier)).
function pkcePair() {
  const verifier = randomBase64Url(32);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function nowPlusSeconds(seconds) {
  return new Date(Date.now() + seconds * 1000);
}

function nowPlusDays(days) {
  return nowPlusSeconds(days * 24 * 60 * 60);
}

function slugify(input) {
  return String(input)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = {
  randomBase64Url,
  sha256Hex,
  pkcePair,
  nowPlusSeconds,
  nowPlusDays,
  slugify,
  HttpError,
  asyncRoute,
};
