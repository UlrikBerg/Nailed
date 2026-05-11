// Resend HTTPS adapter. POST https://api.resend.com/emails with
// { from, to, subject, html, text }. Never throws — returns { ok, id, error }.

const config = require('../../config');

const ENDPOINT = 'https://api.resend.com/emails';

async function sendEmail({ to, subject, html, text }) {
  if (!config.notify.email.enabled()) {
    return { ok: false, error: 'email_disabled' };
  }
  if (!to || !subject || (!html && !text)) {
    return { ok: false, error: 'invalid_args' };
  }
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.notify.email.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.notify.email.from,
        to,
        subject,
        html: html || undefined,
        text: text || undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[notify-email]', `resend ${res.status}`, body.slice(0, 400));
      return { ok: false, error: `resend_${res.status}` };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, id: data.id || null };
  } catch (err) {
    console.error('[notify-email]', err && err.message ? err.message : err);
    return { ok: false, error: 'network' };
  }
}

module.exports = { sendEmail };
