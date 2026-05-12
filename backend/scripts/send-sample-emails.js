#!/usr/bin/env node
// One-off: rendrer hver e-postmal med eksempel-data og sender til mottakeren
// gitt som argument. Kjøres på server: `node backend/scripts/send-sample-emails.js ulriktheodor99@gmail.com`

const path = require('path');
// Last config så env-baserte ting (baseUrl, fra-adresse) treffes.
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const T = require('../lib/notify/templates');
const { sendEmail } = require('../lib/notify/email');

const to = process.argv[2];
if (!to || !/.+@.+\..+/.test(to)) {
  console.error('Bruk: node send-sample-emails.js <mottaker-epost>');
  process.exit(1);
}

// Eksempel-data delt mellom maler.
const startAt = new Date(Date.now() + 26 * 60 * 60 * 1000); // i morgen + 2t
const endAt = new Date(startAt.getTime() + 45 * 60 * 1000);

const salon = {
  id: 1,
  slug: '7-sma-rom',
  name: '7 Små Rom',
  address_line: 'Storgata 12',
  postal_code: '1771',
  city: 'Halden',
  public_phone: '+47 90 12 34 56',
  cancellation_lead_hours: 24,
  booking_confirmation_text: 'Inngang fra bakgården. Vi har stoppeklokke på alle behandlinger.',
};

const baseCtx = {
  bookingId: 12345,
  salon,
  serviceName: 'Klassisk vippeløft',
  durationMin: 45,
  priceNok: 750,
  startAt,
  endAt,
  customerName: 'Ulrik Theodor',
  customerDisplayName: 'Ulrik T.',
  customerEmail: to,
  customerPhone: '+47 99 88 77 66',
  teamMemberName: 'Katrine',
  isGuest: false,
  isSeries: false,
};

const samples = [
  { fn: 'bookingCreatedCustomer', label: 'Kundebekreftelse: ny booking', ctx: baseCtx },
  { fn: 'bookingCreatedOwner',    label: 'Salongeier: ny booking',       ctx: baseCtx },
  { fn: 'bookingCreatedTeam',     label: 'Teammedlem: ny booking',       ctx: { ...baseCtx, salonName: salon.name } },
  { fn: 'bookingConfirmedCustomer', label: 'Kunde: salongen har bekreftet', ctx: baseCtx },
  { fn: 'bookingCancelledCustomer', label: 'Kunde: salongen avlyste',    ctx: { ...baseCtx, salonName: salon.name, cancelReason: 'Stylist syk' } },
  { fn: 'bookingCancelledOwner',    label: 'Salongeier: kunde avbestilte', ctx: baseCtx },
  { fn: 'bookingCancelledTeam',     label: 'Teammedlem: kunde avbestilte', ctx: { ...baseCtx, salonName: salon.name } },
  { fn: 'bookingReminderCustomer',  label: 'Kunde: påminnelse i morgen',   ctx: { ...baseCtx, salonName: salon.name } },
];

(async () => {
  for (const s of samples) {
    try {
      const tpl = T[s.fn](s.ctx);
      const subject = '[Eksempel: ' + s.label + '] ' + tpl.subject;
      const r = await sendEmail({ to, subject, html: tpl.html, text: tpl.text });
      console.log('OK  ', s.fn, '→', to, r && r.id ? '(' + r.id + ')' : '');
    } catch (e) {
      console.error('FAIL', s.fn, '—', e.message);
    }
  }
  console.log('Ferdig.');
  process.exit(0);
})();
