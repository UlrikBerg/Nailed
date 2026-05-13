// Cron-endepunkter: trigges av Hostinger-cron via HTTPS med en Bearer-token.
//
// Hvorfor ikke admin-sesjon? Cron har ikke en bruker, og vi vil ikke at den
// skal lagre en cookie. Token-baserte interne endepunkter er enklere.
//
// CRON_TOKEN settes som env-var i Hostinger-panelet. Cron-linja sender den
// som `Authorization: Bearer <token>`. Hvis tokenet ikke matcher (eller ikke
// er satt), returnerer endepunktet 401.

const express = require('express');
const config = require('../config');
const { asyncRoute } = require('../lib/util');

const router = express.Router();

function requireCronToken(req, res, next) {
  const expected = config.cronToken;
  if (!expected) return res.status(503).json({ error: 'cron_token_not_configured' });
  const header = req.headers['authorization'] || '';
  const m = header.match(/^Bearer\s+(.+)$/);
  const got = m ? m[1] : '';
  if (got !== expected) return res.status(401).json({ error: 'invalid_token' });
  next();
}

router.post('/subscription-sweep', requireCronToken, asyncRoute(async (req, res) => {
  const { runSubscriptionSweep } = require('../lib/subscription-sweep');
  const result = await runSubscriptionSweep();
  res.json(result);
}));

module.exports = router;
