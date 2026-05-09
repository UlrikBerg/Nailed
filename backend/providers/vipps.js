// Vipps Login (OIDC) provider.
// Docs: https://developer.vippsmobilepay.com/docs/APIs/login-api/
//
// STATUS: Stubbed. The application for Vipps Login API access is pending.
// When credentials arrive, set the env vars in .env (VIPPS_CLIENT_ID, etc.)
// and this provider activates automatically. The flow is OIDC + PKCE,
// matching Google's shape, so the auth route doesn't need changes.

const config = require('../config');
const { HttpError } = require('../lib/util');

function ensureEnabled() {
  if (!config.vipps.enabled()) {
    throw new HttpError(503, 'provider_disabled',
      'Vipps Login er ikke aktivert ennå — vi venter på godkjenning fra Vipps. Bruk Google i mellomtiden.');
  }
}

function authBaseUrl() {
  // Vipps OIDC discovery endpoint differs per env:
  //   test: https://apitest.vipps.no/access-management-1.0/access/.well-known/openid-configuration
  //   prod: https://api.vipps.no/access-management-1.0/access/.well-known/openid-configuration
  return `${config.vipps.baseUrl()}/access-management-1.0/access`;
}

function buildAuthorizeUrl({ state, codeChallenge }) {
  ensureEnabled();
  const params = new URLSearchParams({
    client_id: config.vipps.clientId,
    redirect_uri: config.vipps.redirectUri,
    response_type: 'code',
    scope: 'openid name email phoneNumber address birthDate',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${authBaseUrl()}/oauth2/auth?${params.toString()}`;
}

async function exchangeCode({ code, codeVerifier }) {
  ensureEnabled();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    redirect_uri: config.vipps.redirectUri,
  });
  const basic = Buffer.from(`${config.vipps.clientId}:${config.vipps.clientSecret}`).toString('base64');
  const res = await fetch(`${authBaseUrl()}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
      'Ocp-Apim-Subscription-Key': config.vipps.subscriptionKey,
      'Merchant-Serial-Number': config.vipps.msn,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new HttpError(502, 'oauth_token_exchange_failed', 'Kunne ikke fullføre Vipps-innlogging.', { upstream: text });
  }
  return res.json();
}

async function fetchProfile(accessToken) {
  ensureEnabled();
  const res = await fetch(`${authBaseUrl()}/userinfo`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Ocp-Apim-Subscription-Key': config.vipps.subscriptionKey,
      'Merchant-Serial-Number': config.vipps.msn,
    },
  });
  if (!res.ok) {
    throw new HttpError(502, 'oauth_userinfo_failed', 'Kunne ikke hente profil fra Vipps.');
  }
  const data = await res.json();
  return {
    provider: 'vipps',
    subject: data.sub,
    email: data.email,
    emailVerified: Boolean(data.email_verified),
    name: data.name || [data.given_name, data.family_name].filter(Boolean).join(' ') || data.email,
    phone: data.phone_number || null,
    birthDate: data.birthdate || null,
    address: data.address || null,
  };
}

module.exports = {
  id: 'vipps',
  isEnabled: () => config.vipps.enabled(),
  buildAuthorizeUrl,
  exchangeCode,
  fetchProfile,
};
