// Twilio HTTPS adapter. POST form-urlencoded
//   From=<TWILIO_FROM>&To=<+47…>&Body=<msg>
// to https://api.twilio.com/2010-04-01/Accounts/<SID>/Messages.json
// with Basic auth (SID:AUTH_TOKEN). Never throws — returns { ok, id, error }.

const config = require('../../config');

function endpointFor(sid) {
  return `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
}

async function sendSms({ to, body }) {
  if (!config.notify.sms.enabled()) {
    return { ok: false, error: 'sms_disabled' };
  }
  if (!to || !body) {
    return { ok: false, error: 'invalid_args' };
  }
  try {
    const params = new URLSearchParams({
      From: config.notify.sms.from,
      To: to,
      Body: body,
    });
    const basic = Buffer.from(
      `${config.notify.sms.accountSid}:${config.notify.sms.authToken}`
    ).toString('base64');
    const res = await fetch(endpointFor(config.notify.sms.accountSid), {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[notify-sms]', `twilio ${res.status}`, text.slice(0, 400));
      return { ok: false, error: `twilio_${res.status}: ${text.slice(0, 200)}` };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, id: data.sid || null };
  } catch (err) {
    console.error('[notify-sms]', err && err.message ? err.message : err);
    return { ok: false, error: 'network' };
  }
}

module.exports = { sendSms };
