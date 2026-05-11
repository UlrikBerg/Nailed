const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Auth endpoints sit behind Hostinger's edge proxy, so we rely on
// app.set('trust proxy', 1) in app.js to expose the real client IP via
// req.ip — without that, every request would look like it came from
// 127.0.0.1 and one user could lock everyone out.
//
// We skip admins. They use the panel under /admin/ which can fan out
// many calls during legitimate use, and they already authenticate
// against a separate role check.
function skipAdmin(req) {
  return Boolean(req.user && req.user.role === 'admin');
}

function makeLimiter({ windowMs, max, name }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: skipAdmin,
    // Identify by IP. trust proxy = 1 makes req.ip the X-Forwarded-For tail.
    // ipKeyGenerator handles IPv6 /64 grouping so a single IPv6 prefix can't
    // rotate addresses to evade the limit.
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    handler: (_req, res /*, next, options */) => {
      res.status(429).json({
        error: 'rate_limited',
        message: 'For mange forsøk. Vent litt og prøv igjen.',
        scope: name,
      });
    },
  });
}

// 30 req/min/IP — refresh is called every ~15 min by the SPA, so 30
// covers tab switching and quick reloads but blocks credential stuffing.
const refreshLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 30,
  name: 'auth_refresh',
});

// 20 req/min/IP — OAuth flow shouldn't be invoked back-to-back.
const oauthStartLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 20,
  name: 'auth_oauth_start',
});

const oauthCallbackLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 20,
  name: 'auth_oauth_callback',
});

// 30 req/min/IP — logout should be infrequent but we allow some slack for
// scripted clients that retry on transient errors.
const logoutLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 30,
  name: 'auth_logout',
});

module.exports = {
  refreshLimiter,
  oauthStartLimiter,
  oauthCallbackLimiter,
  logoutLimiter,
};
