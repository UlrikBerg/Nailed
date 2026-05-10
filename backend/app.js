const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const { loadUser } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/error');

const authRoutes = require('./routes/auth');
const meRoutes = require('./routes/me');
const salonRoutes = require('./routes/salons');
const imageRoutes = require('./routes/images');
const teamRoutes = require('./routes/team');
const bookingRoutes = require('./routes/bookings');
const favoriteRoutes = require('./routes/favorites');
const salonApplicationRoutes = require('./routes/salon-applications');
const adminRoutes = require('./routes/admin');

function buildApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

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
  app.use('/api/v1/bookings', bookingRoutes);
  app.use('/api/v1/favorites', favoriteRoutes);
  app.use('/api/v1/salon-applications', salonApplicationRoutes);
  app.use('/api/v1/admin', adminRoutes);

  // 404 for unknown /api/v1/* — let static handler reply for everything else.
  app.use('/api/v1', notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { buildApp };
