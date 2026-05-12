const express = require('express');
const { z } = require('zod');
const { query, queryOne, tx } = require('../db');
const { getProvider, listEnabled } = require('../providers');
const { issueAccessToken } = require('../lib/jwt');
const { createSession, findValidSession, revokeSession } = require('../lib/sessions');
const { pkcePair, randomBase64Url, asyncRoute, HttpError, nowPlusSeconds } = require('../lib/util');
const config = require('../config');
const {
  refreshLimiter,
  oauthStartLimiter,
  oauthCallbackLimiter,
  logoutLimiter,
} = require('../middleware/rate-limit');

const router = express.Router();

// GET /auth/providers — which providers are usable
router.get('/providers', (_req, res) => {
  res.json({
    providers: listEnabled().map(p => ({ id: p.id })),
    fallbackEnabled: listEnabled().length > 0,
  });
});

// GET /auth/:provider/start — kick off OIDC flow, redirects to provider
router.get('/:provider/start', oauthStartLimiter, asyncRoute(async (req, res) => {
  const provider = getProvider(req.params.provider);
  if (!provider.isEnabled()) {
    throw new HttpError(503, 'provider_disabled', `${provider.id} er ikke aktivert.`);
  }

  const { verifier, challenge } = pkcePair();
  const state = randomBase64Url(24);
  const redirectAfter = sanitizeRedirect(req.query.redirect);

  await query(
    `INSERT INTO oauth_states (state, provider, code_verifier, redirect_after, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [state, provider.id, verifier, redirectAfter, nowPlusSeconds(600)]
  );

  const url = provider.buildAuthorizeUrl({ state, codeChallenge: challenge });
  res.redirect(url);
}));

// GET /auth/:provider/callback — provider redirects back here
router.get('/:provider/callback', oauthCallbackLimiter, asyncRoute(async (req, res) => {
  const provider = getProvider(req.params.provider);
  const { code, state, error: providerError } = req.query;

  if (providerError) {
    return res.redirect(`/login.html?error=${encodeURIComponent(String(providerError))}`);
  }
  if (typeof code !== 'string' || typeof state !== 'string') {
    throw new HttpError(400, 'bad_callback', 'Mangler code eller state.');
  }

  const stateRow = await queryOne(
    `SELECT state, provider, code_verifier, redirect_after, expires_at
       FROM oauth_states WHERE state = ? LIMIT 1`,
    [state]
  );
  if (!stateRow || stateRow.provider !== provider.id) {
    throw new HttpError(400, 'invalid_state', 'Ugyldig state.');
  }
  if (new Date(stateRow.expires_at).getTime() < Date.now()) {
    await query(`DELETE FROM oauth_states WHERE state = ?`, [state]);
    throw new HttpError(400, 'state_expired', 'Innlogging utløp. Prøv igjen.');
  }
  // One-shot: remove immediately to prevent replay.
  await query(`DELETE FROM oauth_states WHERE state = ?`, [state]);

  const tokens = await provider.exchangeCode({ code, codeVerifier: stateRow.code_verifier });
  const profile = await provider.fetchProfile(tokens.access_token);

  if (!profile.email) {
    throw new HttpError(400, 'missing_email', 'Innlogging ga ikke e-postadresse.');
  }

  // Find-or-create user, link identity. Throws email_already_used hvis en
  // annen provider er knyttet til samme e-post — fanges nedenfor og
  // redirecter til login med tydelig melding.
  let user;
  try {
    user = await tx(async (conn) => {
    // 1. Identity already linked?
    const [identityRows] = await conn.execute(
      `SELECT u.id, u.email, u.name, u.role, u.suspended_at
         FROM auth_identities ai
         JOIN users u ON u.id = ai.user_id
        WHERE ai.provider = ? AND ai.subject = ? LIMIT 1`,
      [profile.provider, profile.subject]
    );
    if (identityRows[0]) return identityRows[0];

    // 2. User with same email exists?
    const [byEmailRows] = await conn.execute(
      `SELECT id, email, name, role, suspended_at FROM users WHERE email = ? LIMIT 1`,
      [profile.email]
    );

    let userRow;
    if (byEmailRows[0]) {
      // KRITISK: vi auto-linker IKKE et nytt provider-identity til en
      // eksisterende konto basert på e-post alene. Det er en kjent OAuth
      // account-takeover-vektor — angriper kan registrere en konto hos
      // den andre provideren med offerets e-post og overta kontoen ved
      // første innlogging. Krev at brukeren først logger inn med den
      // opprinnelige provideren og kobler til den nye via innstillinger.
      const [existingProviders] = await conn.execute(
        `SELECT DISTINCT provider FROM auth_identities WHERE user_id = ?`,
        [byEmailRows[0].id]
      );
      const providerList = existingProviders.map(r => r.provider).join(',');
      const err = new HttpError(409, 'email_already_used',
        'Denne e-posten er allerede registrert. Logg inn med den opprinnelige metoden.');
      err.existingProviders = providerList;
      throw err;
    } else {
      // 3. Create new user. Apply bootstrap-admin if email matches.
      const isBootstrapAdmin = config.bootstrapAdminEmails.includes(profile.email.toLowerCase());
      const role = isBootstrapAdmin ? 'admin' : 'user';
      const [insertResult] = await conn.execute(
        `INSERT INTO users (email, name, role) VALUES (?, ?, ?)`,
        [profile.email, profile.name, role]
      );
      const newId = insertResult.insertId;
      // For Vipps profiles, persist phone/birth/address if available.
      if (profile.phone || profile.birthDate || profile.address) {
        const birthYear = profile.birthDate ? parseInt(String(profile.birthDate).slice(0, 4), 10) : null;
        await conn.execute(
          `UPDATE users SET phone = COALESCE(?, phone),
                            birth_year = COALESCE(?, birth_year),
                            address_line = COALESCE(?, address_line),
                            postal_code = COALESCE(?, postal_code),
                            city = COALESCE(?, city)
            WHERE id = ?`,
          [
            profile.phone || null,
            Number.isFinite(birthYear) ? birthYear : null,
            profile.address && profile.address.street_address || null,
            profile.address && profile.address.postal_code || null,
            profile.address && profile.address.locality || null,
            newId,
          ]
        );
      }
      const [created] = await conn.execute(
        `SELECT id, email, name, role, suspended_at FROM users WHERE id = ?`,
        [newId]
      );
      userRow = created[0];
    }

    // Link identity (idempotent).
    await conn.execute(
      `INSERT IGNORE INTO auth_identities (user_id, provider, subject, email_at_link)
       VALUES (?, ?, ?, ?)`,
      [userRow.id, profile.provider, profile.subject, profile.email]
    );

    return userRow;
    });
  } catch (e) {
    if (e && e.code === 'email_already_used') {
      const q = new URLSearchParams({ error: 'email_already_used' });
      if (e.existingProviders) q.set('provider', e.existingProviders);
      return res.redirect('/login?' + q.toString());
    }
    throw e;
  }

  if (user.suspended_at) {
    return res.redirect('/login.html?error=account_suspended');
  }

  // Mint tokens.
  const accessToken = issueAccessToken(user);
  const { token: refreshToken } = await createSession({
    userId: user.id,
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  });

  // Redirect to a tiny client-side page that stores tokens and routes by role.
  // We pass tokens via URL fragment (#) so they don't hit server logs.
  const redirectAfter = stateRow.redirect_after || roleHome(user.role);
  const fragment = new URLSearchParams({
    access_token: accessToken,
    refresh_token: refreshToken,
    role: user.role,
    redirect: redirectAfter,
  });
  res.redirect(`/auth-complete.html#${fragment.toString()}`);
}));

// POST /auth/refresh — { refreshToken } -> { accessToken }
router.post('/refresh', refreshLimiter, asyncRoute(async (req, res) => {
  const schema = z.object({ refreshToken: z.string().min(10) });
  const { refreshToken } = schema.parse(req.body);

  const session = await findValidSession(refreshToken);
  if (!session) throw new HttpError(401, 'invalid_refresh', 'Sesjonen er ugyldig eller utløpt.');

  const user = await queryOne(
    `SELECT id, email, name, role, suspended_at FROM users WHERE id = ?`,
    [session.user_id]
  );
  if (!user || user.suspended_at) {
    throw new HttpError(401, 'invalid_refresh', 'Sesjonen er ugyldig.');
  }

  const accessToken = issueAccessToken(user);
  res.json({ accessToken, expiresIn: config.jwt.accessTtlSeconds });
}));

// POST /auth/logout — { refreshToken }
router.post('/logout', logoutLimiter, asyncRoute(async (req, res) => {
  const refreshToken = (req.body && req.body.refreshToken) || null;
  if (refreshToken) await revokeSession(refreshToken);
  res.json({ ok: true });
}));

function roleHome(role) {
  if (role === 'admin') return '/admin/';
  if (role === 'salon_owner') return '/salong-panel.html';
  return '/kunde-panel.html';
}

// Same-origin only: must start with a single "/", not "//" (protocol-relative)
// and not "/\\" (some browsers normalize backslashes). Anything else is dropped
// so a phisher can't bounce a freshly-authenticated user off-site.
function sanitizeRedirect(raw) {
  if (typeof raw !== 'string') return null;
  const v = raw.slice(0, 512);
  if (!v.startsWith('/')) return null;
  if (v.startsWith('//') || v.startsWith('/\\')) return null;
  return v;
}

module.exports = router;
