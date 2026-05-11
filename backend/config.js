require('dotenv').config();

// Module-load must NEVER throw. If a critical env var is missing, surface it via
// config.issues + the /api/v1/health endpoint so ops can debug from logs and
// the Hostinger edge proxy can still return 200 for static files.

const issues = [];

function optional(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function expected(name, severity, hint) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    issues.push({ name, severity, hint });
    return null;
  }
  return v;
}

function list(name) {
  const v = process.env[name];
  if (!v) return [];
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

const config = {
  env: optional('NODE_ENV', 'development'),
  port: parseInt(optional('PORT', '3000'), 10),
  publicBaseUrl: optional('PUBLIC_BASE_URL', 'http://localhost:3000'),

  db: {
    host: optional('DB_HOST', 'localhost'),
    port: parseInt(optional('DB_PORT', '3306'), 10),
    user: optional('DB_USER', 'nailed'),
    password: optional('DB_PASSWORD', ''),
    database: optional('DB_NAME', 'nailed'),
    // When set, mysql2 connects via Unix socket instead of TCP. Required on
    // Hostinger Cloud where MySQL users have @localhost socket grants only,
    // not @127.0.0.1 / @::1 TCP grants. Common paths: /var/lib/mysql/mysql.sock.
    socket: optional('DB_SOCKET', ''),
  },

  jwt: {
    // null when missing — auth endpoints fail with 503 + clear message,
    // public endpoints keep working.
    secret: expected('JWT_SECRET', 'critical',
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"'),
    accessTtlSeconds: parseInt(optional('JWT_ACCESS_TTL_SECONDS', '900'), 10),
    refreshTtlDays: parseInt(optional('JWT_REFRESH_TTL_DAYS', '30'), 10),
  },

  corsOrigins: list('CORS_ORIGINS'),

  google: {
    clientId: optional('GOOGLE_CLIENT_ID', ''),
    clientSecret: optional('GOOGLE_CLIENT_SECRET', ''),
    redirectUri: optional('GOOGLE_REDIRECT_URI', ''),
    enabled() {
      return Boolean(this.clientId && this.clientSecret && this.redirectUri);
    },
  },

  vipps: {
    env: optional('VIPPS_ENV', ''),
    clientId: optional('VIPPS_CLIENT_ID', ''),
    clientSecret: optional('VIPPS_CLIENT_SECRET', ''),
    msn: optional('VIPPS_MSN', ''),
    subscriptionKey: optional('VIPPS_SUBSCRIPTION_KEY', ''),
    redirectUri: optional('VIPPS_REDIRECT_URI', ''),
    enabled() {
      return Boolean(this.clientId && this.clientSecret && this.msn && this.subscriptionKey && this.env);
    },
    baseUrl() {
      return this.env === 'production' ? 'https://api.vipps.no' : 'https://apitest.vipps.no';
    },
  },

  notify: {
    email: {
      apiKey: optional('RESEND_API_KEY', ''),
      from: optional('RESEND_FROM', 'nailed <hei@nailed.no>'),
      enabled() {
        return Boolean(this.apiKey);
      },
    },
    sms: {
      accountSid: optional('TWILIO_ACCOUNT_SID', ''),
      authToken: optional('TWILIO_AUTH_TOKEN', ''),
      from: optional('TWILIO_FROM', ''),
      enabled() {
        return Boolean(this.accountSid && this.authToken && this.from);
      },
    },
  },

  bootstrapAdminEmails: list('BOOTSTRAP_ADMIN_EMAILS'),

  storage: {
    backend: optional('STORAGE_BACKEND', 'local'),
    localDir: optional('LOCAL_UPLOAD_DIR', './uploads'),
    r2: {
      accountId: optional('R2_ACCOUNT_ID', ''),
      accessKeyId: optional('R2_ACCESS_KEY_ID', ''),
      secretAccessKey: optional('R2_SECRET_ACCESS_KEY', ''),
      bucket: optional('R2_BUCKET', ''),
      publicBaseUrl: optional('R2_PUBLIC_BASE_URL', ''),
    },
  },

  issues,
};

// Cross-checks that depend on combinations of env vars.
if (config.storage.backend === 'r2') {
  const r = config.storage.r2;
  if (!r.accountId || !r.accessKeyId || !r.secretAccessKey || !r.bucket || !r.publicBaseUrl) {
    issues.push({
      name: 'R2_*',
      severity: 'critical',
      hint: 'STORAGE_BACKEND=r2 but R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET/R2_PUBLIC_BASE_URL are not all set. See docs/R2_SETUP.md.',
    });
  }
}
if (!config.db.password) {
  issues.push({
    name: 'DB_PASSWORD',
    severity: 'warning',
    hint: 'DB_PASSWORD is empty — DB queries will fail unless your MySQL user has no password.',
  });
}
if (!config.notify.email.enabled()) {
  issues.push({
    name: 'notify.email.missing',
    severity: 'info',
    hint: 'Set RESEND_API_KEY in hPanel UI to enable booking emails.',
  });
}
if (!config.notify.sms.enabled()) {
  issues.push({
    name: 'notify.sms.missing',
    severity: 'info',
    hint: 'Set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM in hPanel UI to enable booking SMS.',
  });
}

module.exports = config;
