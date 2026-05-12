// Lett pageview-tracking. Klient setter en cookie «nailed.visitor» med en
// random UUID v4 første gang (eller hentes fra serversiden via X-Visitor-Id
// header). Hvert sidelast trigger POST /api/v1/track/pageview med { path,
// referrer }. user_id kobles til hvis sender er autentisert.
//
// Personvern: vi lagrer ikke IP direkte i tabellen (kun ephemerally i denne
// requesten via req.ip for rate-limit). Bruker-agent klippes til 255 tegn.

const express = require('express');
const { z } = require('zod');
const { query } = require('../db');
const { asyncRoute } = require('../lib/util');

const router = express.Router();

router.post('/pageview', asyncRoute(async (req, res) => {
  const schema = z.object({
    visitor_id: z.string().trim().min(8).max(64),
    path: z.string().trim().min(1).max(255),
    referrer: z.string().trim().max(255).optional().nullable(),
  });
  let body;
  try {
    body = schema.parse(req.body || {});
  } catch (_) {
    // Trackign er best-effort — aldri returner feil til klienten.
    return res.json({ ok: true });
  }

  const ua = (req.headers['user-agent'] || '').slice(0, 255);
  const userId = req.user ? req.user.id : null;

  await query(
    `INSERT INTO page_views (visitor_id, user_id, path, referrer, user_agent)
     VALUES (?, ?, ?, ?, ?)`,
    [body.visitor_id, userId, body.path, body.referrer || null, ua || null]
  );
  res.json({ ok: true });
}));

module.exports = router;
