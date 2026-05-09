// Google OIDC provider — uses authorization code + PKCE.
// Docs: https://developers.google.com/identity/protocols/oauth2/web-server

const config = require('../config');
const { HttpError } = require('../lib/util');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

function ensureEnabled() {
  if (!config.google.enabled()) {
    throw new HttpError(503, 'provider_disabled', 'Google-innlogging er ikke konfigurert på serveren.');
  }
}

function buildAuthorizeUrl({ state, codeChallenge }) {
  ensureEnabled();
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'online',
    prompt: 'select_account',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function exchangeCode({ code, codeVerifier }) {
  ensureEnabled();
  const body = new URLSearchParams({
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: config.google.redirectUri,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new HttpError(502, 'oauth_token_exchange_failed', 'Kunne ikke fullføre Google-innlogging.', { upstream: text });
  }
  return res.json();
}

async function fetchProfile(accessToken) {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new HttpError(502, 'oauth_userinfo_failed', 'Kunne ikke hente profil fra Google.');
  }
  const data = await res.json();
  // sub = stable Google user id; email_verified should be true for trust.
  return {
    provider: 'google',
    subject: data.sub,
    email: data.email,
    emailVerified: Boolean(data.email_verified),
    name: data.name || data.email,
  };
}

module.exports = {
  id: 'google',
  isEnabled: () => config.google.enabled(),
  buildAuthorizeUrl,
  exchangeCode,
  fetchProfile,
};
