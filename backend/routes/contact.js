// Kontaktskjema fra /kontakt — sender e-post til hei@nailed.no via Resend.
//
// Validerer input med Zod. Bruker honeypot-felt `website` for billig
// spam-beskyttelse: bots fyller det inn, mennesker ser ikke feltet. Hvis det
// er utfylt, later vi som om alt gikk bra og dropper meldingen i stillhet.
//
// Ingen rate-limiter ennå — kan legges til senere ved misbruk.

const express = require('express');
const { z } = require('zod');
const { sendEmail } = require('../lib/notify/email');
const { asyncRoute } = require('../lib/util');

const router = express.Router();

const TOPICS = ['generelt', 'kunde', 'salong', 'bug', 'annet'];

const schema = z.object({
  name:    z.string().trim().min(1).max(100),
  email:   z.string().trim().email().max(200),
  topic:   z.enum(TOPICS).optional(),
  message: z.string().trim().min(10).max(5000),
  website: z.string().max(0).optional(),
});

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

const TOPIC_LABELS = {
  generelt: 'Generelt',
  kunde:    'Som kunde',
  salong:   'Som salong',
  bug:      'Bug / feil',
  annet:    'Annet',
};

router.post('/', asyncRoute(async (req, res) => {
  let body;
  try {
    body = schema.parse(req.body || {});
  } catch (_) {
    return res.status(400).json({ error: 'invalid_input' });
  }

  // Honeypot — bot detektert, vis suksess men ikke send.
  if (body.website && body.website.length > 0) {
    return res.json({ ok: true });
  }

  const topic = body.topic ? TOPIC_LABELS[body.topic] : 'Generelt';
  const subject = `[Kontakt] ${body.name} — ${topic}`;

  const text =
    `Fra:    ${body.name} <${body.email}>\n` +
    `Emne:   ${topic}\n\n` +
    `${body.message}\n\n` +
    `---\n` +
    `Sendt fra nailed.no/kontakt`;

  const html =
    `<div style="font-family:sans-serif; max-width:560px;">` +
      `<p style="margin:0 0 8px;"><strong>Fra:</strong> ${escapeHtml(body.name)} &lt;${escapeHtml(body.email)}&gt;</p>` +
      `<p style="margin:0 0 16px;"><strong>Emne:</strong> ${escapeHtml(topic)}</p>` +
      `<div style="white-space:pre-wrap; padding:14px 16px; background:#FBF6EE; border-radius:8px; border:1px solid #ECDFCB; color:#3a3530;">` +
        `${escapeHtml(body.message)}` +
      `</div>` +
      `<p style="margin:24px 0 0; font-size:12px; color:#7a6f68;">Sendt fra nailed.no/kontakt</p>` +
    `</div>`;

  const r = await sendEmail({
    to: 'hei@nailed.no',
    subject,
    html,
    text,
    replyTo: body.email,
  });

  if (!r.ok) {
    return res.status(502).json({ error: 'send_failed' });
  }
  res.json({ ok: true });
}));

module.exports = router;
