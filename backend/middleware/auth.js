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
  try {
    const claims = verifyAccessToken(token);
    const user = await queryOne(
      `SELECT id, email, name, role, suspended_at FROM users WHERE id = ?`,
      [claims.sub]
    );
    if (!user) return next();
    if (user.suspended_at) return next(new HttpError(403, 'account_suspended', 'Kontoen er suspendert.'));
    req.user = user;
    next();
  } catch (_err) {
    // Invalid/expired token — treat as anonymous, the route can require auth itself.
    next();
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
