// Fiken-OAuth-flow + status/disconnect-endepunkter.
//
//   GET  /fiken/auth/start?salon_id=N  →  redirect til Fiken-consent
//   GET  /fiken/auth/callback?code=…&state=…  ←  Fiken redirector hit
//   GET  /fiken/status?salon_id=N      →  koblet ja/nei + company_slug
//   POST /fiken/disconnect              →  fjern tokenene
//
// State er en signert salong-id + nonce så vi vet hvilken salong som
// kobler til når vi får callbacken. Vi krever requireAuth på alle
// rutene unntatt callback (Fiken kaller den uten Bearer-header).

const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const { query, queryOne } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute, HttpError } = require('../lib/util');
const fiken = require('../lib/fiken');
const config = require('../config');

const router = express.Router();

function signState(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', config.fiken.clientSecret || 'dev')
    .update(body)
    .digest('base64url');
  return body + '.' + sig;
}
function verifyState(state) {
  if (!state || typeof state !== 'string') return null;
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const expected = crypto
    .createHmac('sha256', config.fiken.clientSecret || 'dev')
    .update(parts[0])
    .digest('base64url');
  if (expected !== parts[1]) return null;
  try {
    return JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch (_) { return null; }
}

async function loadOwnedSalon(req) {
  const salonId = parseInt(req.query.salon_id || req.body?.salon_id, 10);
  if (!Number.isFinite(salonId)) throw new HttpError(400, 'bad_id', 'salon_id mangler.');
  const salon = await queryOne(`SELECT id, owner_user_id FROM salons WHERE id = ?`, [salonId]);
  if (!salon) throw new HttpError(404, 'not_found', 'Salongen finnes ikke.');
  if (req.user.role !== 'admin' && salon.owner_user_id !== req.user.id) {
    throw new HttpError(403, 'forbidden', 'Du eier ikke denne salongen.');
  }
  return salon;
}

// Start OAuth — returnerer JSON med Fiken-URL-en frontend kan window.location til.
// Bruker JSON i stedet for redirect så Bearer-headeren går gjennom og state
// blir signert med innloggings-sjekk gjort.
router.get('/auth/start', requireAuth, asyncRoute(async (req, res) => {
  if (!fiken.isEnabled()) {
    throw new HttpError(503, 'fiken_disabled', 'Fiken-integrasjonen er ikke konfigurert ennå.');
  }
  const salon = await loadOwnedSalon(req);
  const state = signState({
    salon_id: salon.id,
    user_id:  req.user.id,
    nonce:    crypto.randomBytes(8).toString('base64url'),
    ts:       Date.now(),
  });
  res.json({ auth_url: fiken.authStartUrl(state) });
}));

// Callback fra Fiken — bytter code mot tokens, henter companies-listen
// og redirector tilbake til salongpanelet.
router.get('/auth/callback', asyncRoute(async (req, res) => {
  if (!fiken.isEnabled()) {
    return res.redirect('/salong-panel?fiken=disabled');
  }
  const code  = (req.query.code  || '').toString();
  const state = (req.query.state || '').toString();
  const decoded = verifyState(state);
  if (!decoded || !code) {
    return res.redirect('/salong-panel?fiken=invalid_state');
  }
  // State maks gyldig i 15 min
  if (Date.now() - decoded.ts > 15 * 60 * 1000) {
    return res.redirect('/salong-panel?fiken=expired');
  }
  try {
    const tok = await fiken.exchangeCodeForToken(code);
    const companies = await fiken.listCompanies(tok.access_token);
    const company = Array.isArray(companies) ? companies[0] : (companies?.companies?.[0] || null);
    const slug = company?.slug || company?.companySlug || null;
    const expiresAt = new Date(Date.now() + (Number(tok.expires_in || 3600) - 30) * 1000);
    await query(
      `UPDATE salons
          SET fiken_access_token = ?, fiken_refresh_token = ?, fiken_token_expires_at = ?,
              fiken_company_slug = ?, fiken_connected_at = NOW()
        WHERE id = ?`,
      [tok.access_token, tok.refresh_token || null, expiresAt, slug, decoded.salon_id]
    );
    res.redirect('/salong-panel?fiken=connected#tab-innstillinger');
  } catch (err) {
    console.warn('[fiken] callback failed', err.message);
    res.redirect('/salong-panel?fiken=error#tab-innstillinger');
  }
}));

// Status: er denne salongen koblet til Fiken?
router.get('/status', requireAuth, asyncRoute(async (req, res) => {
  const salon = await loadOwnedSalon(req);
  const row = await queryOne(
    `SELECT fiken_company_slug, fiken_connected_at, fiken_auto_invoice
       FROM salons WHERE id = ?`,
    [salon.id]
  );
  res.json({
    enabled:       fiken.isEnabled(),
    connected:     !!row?.fiken_company_slug,
    company_slug:  row?.fiken_company_slug || null,
    connected_at:  row?.fiken_connected_at || null,
    auto_invoice:  !!row?.fiken_auto_invoice,
  });
}));

// Disconnect: nuller ut tokens + slug. Auto-faktura slutter automatisk.
router.post('/disconnect', requireAuth, asyncRoute(async (req, res) => {
  const schema = z.object({ salon_id: z.number().int().positive() });
  const { salon_id } = schema.parse(req.body || {});
  req.query = { salon_id: String(salon_id) };
  const salon = await loadOwnedSalon(req);
  await query(
    `UPDATE salons
        SET fiken_access_token = NULL, fiken_refresh_token = NULL,
            fiken_token_expires_at = NULL, fiken_company_slug = NULL,
            fiken_connected_at = NULL
      WHERE id = ?`,
    [salon.id]
  );
  res.json({ ok: true });
}));

// Toggle: skru av/på auto-faktura uten å disconnecte.
router.patch('/auto-invoice', requireAuth, asyncRoute(async (req, res) => {
  const schema = z.object({
    salon_id: z.number().int().positive(),
    enabled:  z.boolean(),
  });
  const { salon_id, enabled } = schema.parse(req.body || {});
  req.query = { salon_id: String(salon_id) };
  const salon = await loadOwnedSalon(req);
  await query(`UPDATE salons SET fiken_auto_invoice = ? WHERE id = ?`, [enabled ? 1 : 0, salon.id]);
  res.json({ ok: true });
}));

module.exports = router;
