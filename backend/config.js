require('dotenv').config();

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
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
  },

  jwt: {
    secret: required('JWT_SECRET'),
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
};

module.exports = config;
