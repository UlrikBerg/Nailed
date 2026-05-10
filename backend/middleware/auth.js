const jwt = require('jsonwebtoken');
const { verifyAccessToken } = require('../lib/jwt');
const { queryOne } = require('../db');
const { HttpError } = require('../lib/util');
const config = require('../config');

function readBearer(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/.exec(h);
  return m ? m[1] : null;
}

async function loadUser(req, res, next) {
  const token = readBearer(req);
  if (!token) return next();
  if (!config.jwt.secret) return next(); // server misconfigured — handled in requireAuth

  // Token verification: invalid/expired tokens drop the user to anonymous.
  // DB errors must propagate so requireAuth doesn't silently downgrade an
  // outage to 401 — they belong in 5xx with a real stack trace.
  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError
        || err instanceof jwt.NotBeforeError) {
      return next();
    }
    return next(err);
  }
  try {
    const user = await queryOne(
      `SELECT id, email, name, role, suspended_at FROM users WHERE id = ?`,
      [claims.sub]
    );
    if (!user) return next();
    if (user.suspended_at) return next(new HttpError(403, 'account_suspended', 'Kontoen er suspendert.'));
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAuth(req, _res, next) {
  if (!config.jwt.secret) {
    return next(new HttpError(503, 'jwt_not_configured',
      'Server-secret er ikke konfigurert. Sett JWT_SECRET i miljovariabel og restart serveren.'));
  }
  if (!req.user) return next(new HttpError(401, 'auth_required', 'Du må være logget inn.'));
  next();
}

function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'auth_required', 'Du må være logget inn.'));
    if (!roles.includes(req.user.role)) {
      return next(new HttpError(403, 'forbidden', 'Du har ikke tilgang til denne ressursen.'));
    }
    next();
  };
}

module.exports = { loadUser, requireAuth, requireRole };
