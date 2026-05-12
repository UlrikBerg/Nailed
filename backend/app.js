const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const { loadUser } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/error');

const authRoutes = require('./routes/auth');
const meRoutes = require('./routes/me');
const salonRoutes = require('./routes/salons');
const imageRoutes = require('./routes/images');
const teamRoutes = require('./routes/team');
const bookingRoutes = require('./routes/bookings');
const waitlistRoutes = require('./routes/waitlist');
const favoriteRoutes = require('./routes/favorites');
const salonApplicationRoutes = require('./routes/salon-applications');
const reviewRoutes = require('./routes/reviews');
const salonAnalyticsRoutes = require('./routes/salon-analytics');
const adminRoutes = require('./routes/admin');
const chatRoutes = require('./routes/chat');
const trackRoutes = require('./routes/track');
const contactRoutes = require('./routes/contact');
const seoRoutes = require('./routes/seo');

function buildApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Security headers. We hand-pick from helmet so we don't fight the existing
  // CORS config (helmet's cross-origin-resource-policy would block image
  // hotlinks from the R2 CDN; we set our own CSP that allows it).
  //
  // CSP notes:
  //   - script-src includes https://unpkg.com because the frontend pulls Lucide
  //     icons from there. Tightening this means self-hosting Lucide.
  //   - style-src needs 'unsafe-inline' because the public pages use inline
  //     style="" attributes for fallback gradient covers and a handful of one-
  //     off rules. Removing it would require a refactor pass we haven't budgeted.
  //   - img-src whitelists the R2 public bucket so salon covers render.
  //   - connect-src must be 'self' so the SPA can call /api/v1/*.
  //   - frame-ancestors 'none' is the modern X-Frame-Options DENY.
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", 'https://unpkg.com'],
        'style-src': ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
        'img-src': [
          "'self'",
          'data:',
          'https://pub-ebd2cad0311743c1b0b727186ba158bc.r2.dev',
        ],
        'font-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'object-src': ["'none'"],
      },
    },
    // We send X-Frame-Options DENY in addition to frame-ancestors for legacy
    // browsers that don't honor CSP frame-ancestors.
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    // helmet's default Cross-Origin-Resource-Policy is 'same-origin', which
    // would prevent our salon covers (served from R2) being embedded on the
    // same-origin HTML pages. 'cross-origin' is the safe choice for a public
    // marketplace.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // OAuth redirects (Google, Vipps) work as full top-level navigations; we
    // don't need COOP/COEP and they would break popup-style flows.
    crossOriginOpenerPolicy: false,
    crossOriginEmbedderPolicy: false,
    // hsts: leave helmet's default (max-age=180d, includeSubDomains). Safe on
    // a single-host deploy behind Hostinger which terminates TLS.
  }));

  // Permissions-Policy isn't exposed by helmet ≥ 7 because the spec keeps
  // changing. Set it ourselves — we don't use any of these APIs.
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
  });

  app.use(cors({
    origin(origin, cb) {
      // Same-origin requests have no Origin header — allow.
      if (!origin) return cb(null, true);
      if (config.corsOrigins.length === 0) {
        // Empty list in production = misconfiguration; deny so a stolen token
        // can't be replayed from arbitrary origins. Dev stays permissive.
        if (config.env === 'production') return cb(new Error('CORS: origin not allowed (CORS_ORIGINS unset in production)'));
        return cb(null, true);
      }
      if (config.corsOrigins.includes(origin)) return cb(null, true);
      // Allow native app schemes like nailed-app:// (treated as origin)
      if (config.corsOrigins.some(o => o.endsWith('://') && origin.startsWith(o))) return cb(null, true);
      cb(new Error('CORS: origin not allowed'));
    },
    credentials: false,
  }));

  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: true, limit: '256kb' }));

  // Local-storage uploads (only relevant when STORAGE_BACKEND=local).
  if (config.storage.backend === 'local') {
    const uploadsAbs = path.resolve(__dirname, '..', config.storage.localDir);
    app.use('/uploads', express.static(uploadsAbs, {
      maxAge: '7d',
      immutable: true,
    }));
  }

  // SEO routes (sitemap.xml, robots.txt) — must be mounted BEFORE the static
  // handler so we win the route, otherwise a stray /sitemap.xml file in the
  // repo root would shadow our dynamic version.
  app.use('/', seoRoutes);

  // Pretty URLs: 301-redirect any incoming /foo.html request to /foo.
  // The static handler below uses `extensions: ['html']`, so /foo already
  // resolves to /foo.html on disk — this middleware just rewrites the
  // address bar (and pleases SEO crawlers by giving a single canonical URL).
  //
  // Skips /api/*, /sitemap.xml and /robots.txt so we never break server
  // routes. Preserves the query string. /index.html collapses to / and
  // /admin/index.html collapses to /admin/.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api/')) return next();
    if (req.path === '/sitemap.xml' || req.path === '/robots.txt') return next();
    const m = /^(\/[A-Za-z0-9_\-\/]*)\.html$/.exec(req.path);
    if (!m) return next();
    let newPath = m[1];
    // /index → /, /admin/index → /admin/
    if (newPath === '/index') newPath = '/';
    else if (newPath.endsWith('/index')) newPath = newPath.slice(0, -'index'.length);
    const qs = req.url.slice(req.path.length); // preserves ?slug=... etc.
    return res.redirect(301, newPath + qs);
  });

  // Static frontend (project root). API mounts at /api/v1 below.
  app.use(express.static(path.join(__dirname, '..'), {
    extensions: ['html'],
    index: 'index.html',
  }));

  // Auth context (sets req.user when a valid Bearer is present).
  app.use(loadUser);

  // Health check — also exposes config status (no secret values, just flags)
  // so ops can `curl /api/v1/health` from prod and see what's missing.
  app.get('/api/v1/health', (_req, res) => {
    res.json({
      ok: true,
      env: config.env,
      storage: config.storage.backend,
      providers: {
        google: config.google.enabled(),
        vipps: config.vipps.enabled(),
        email: config.notify.email.enabled(),
        sms:   config.notify.sms.enabled(),
      },
      ready: {
        jwt: Boolean(config.jwt.secret),
        db: Boolean(config.db.password),
      },
      db_transport: config.db.socket ? 'socket' : 'tcp',
      issues: config.issues.map(i => ({ name: i.name, severity: i.severity })),
    });
  });

  // Routes
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/me', meRoutes);
  app.use('/api/v1/salons', salonRoutes);
  app.use('/api/v1/salons', imageRoutes);
  app.use('/api/v1/salons', teamRoutes);
  app.use('/api/v1/salons', salonAnalyticsRoutes);
  app.use('/api/v1/bookings', bookingRoutes);
  app.use('/api/v1/waitlist', waitlistRoutes);
  app.use('/api/v1/favorites', favoriteRoutes);
  app.use('/api/v1/salon-applications', salonApplicationRoutes);
  // Reviews cover several paths (/salons/:id/reviews, /bookings/:id/review,
  // /reviews/:id) so it's mounted at the API root instead of a single prefix.
  app.use('/api/v1', reviewRoutes);
  app.use('/api/v1/admin', adminRoutes);
  app.use('/api/v1/chat', chatRoutes);
  app.use('/api/v1/track', trackRoutes);
  app.use('/api/v1/contact', contactRoutes);

  // 404 for unknown /api/v1/* — let static handler reply for everything else.
  app.use('/api/v1', notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { buildApp };
