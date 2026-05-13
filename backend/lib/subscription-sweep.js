// Subscription-sweep: kjøres som ekstern cron (Hostinger / GitHub Action),
// minst én gang i døgnet. Sjekker salonger der trial er utløpt og status
// fortsatt er 'trial', og:
//
//   1. Setter subscription_status = 'past_due'
//   2. Låser pris (149 hvis is_pilot, ellers 299) i subscription_price_nok
//   3. Sender e-post til SUPPORT_EMAIL med all faktura-info så admin kan
//      opprette faktura manuelt i Fiken (Nailed's egen Fiken-konto, ikke
//      salongens). Når vi senere kobler Nailed's Fiken-konto via API, kan
//      e-posten erstattes av et direkte API-kall.
//   4. Sender e-post til salongeier som varsler om at faktura kommer
//      innen 1–2 virkedager og at panelet nå viser «Start opp igjen».
//
// Idempotent: én rad får aldri e-post mer enn én gang, siden vi bare
// håndterer rader med status='trial'. Etter første sveip står den på
// 'past_due' og hoppes over neste gang.
//
// Tilfeller utenfor scope (admin må håndtere manuelt):
//   - Status 'past_due' som ligger og henger uten betaling
//   - Status 'cancelled' som kommer tilbake (re-aktiverings-flyten gjør det)

const { query } = require('../db');
const { sendEmail } = require('./notify/email');

async function findExpiredTrials() {
  return query(
    `SELECT s.id, s.name, s.slug, s.is_pilot, s.trial_ends_at,
            s.public_email, s.public_phone, s.org_number,
            u.email AS owner_email, u.name AS owner_name
       FROM salons s
       JOIN users u ON u.id = s.owner_user_id
      WHERE s.subscription_status = 'trial'
        AND s.trial_ends_at IS NOT NULL
        AND s.trial_ends_at <= NOW()
        AND (s.status IS NULL OR s.status NOT IN ('deleted'))`,
    []
  );
}

async function processExpiredTrial(row) {
  const price = row.is_pilot ? 149 : 299;
  const supportEmail = process.env.SUPPORT_EMAIL || 'support@nailed.no';

  // 1+2. Sett status til past_due og lås pris.
  await query(
    `UPDATE salons
        SET subscription_status = 'past_due',
            subscription_price_nok = ?
      WHERE id = ? AND subscription_status = 'trial'`,
    [price, row.id]
  );

  // 3. Varsle admin med faktura-grunnlag.
  try {
    await sendEmail({
      to: supportEmail,
      subject: 'Nailed: trial utløpt — fakturer ' + row.name,
      html:
        '<h2>Trial utløpt: ' + row.name + '</h2>' +
        '<p>Salongen har gått over til <strong>past_due</strong>. ' +
        'Opprett faktura i Nailed sin Fiken-konto og marker som «active» i adminpanelet når betaling er mottatt.</p>' +
        '<ul>' +
          '<li><strong>Salong:</strong> ' + row.name + ' (' + row.slug + ')</li>' +
          '<li><strong>Eier:</strong> ' + (row.owner_name || '–') + ' &lt;' + row.owner_email + '&gt;</li>' +
          '<li><strong>Org.nr:</strong> ' + (row.org_number || '–') + '</li>' +
          '<li><strong>Salong e-post:</strong> ' + (row.public_email || row.owner_email) + '</li>' +
          '<li><strong>Salong telefon:</strong> ' + (row.public_phone || '–') + '</li>' +
          '<li><strong>Trial utløp:</strong> ' + row.trial_ends_at + '</li>' +
          '<li><strong>Pris:</strong> ' + price + ' kr/mnd' + (row.is_pilot ? ' (pilot — låst)' : '') + '</li>' +
        '</ul>',
      replyTo: row.owner_email,
    });
  } catch (err) {
    console.warn('[sub-sweep] admin email failed for salon', row.id, err && err.message);
  }

  // 4. Varsle salongeier.
  try {
    await sendEmail({
      to: row.owner_email,
      subject: 'Prøveperioden din på Nailed er utløpt',
      html:
        '<p>Hei ' + (row.owner_name || '') + ',</p>' +
        '<p>Prøveperioden for <strong>' + row.name + '</strong> er nå utløpt.</p>' +
        '<p>Du vil motta en faktura på <strong>' + price + ' kr/mnd</strong> ' +
        'fra Nailed i Fiken innen 1–2 virkedager. Når betalingen er mottatt aktiverer vi kontoen igjen.</p>' +
        '<p>Hvis du ikke ønsker å fortsette, kan du logge inn på panelet og klikke «Kanseller abonnement». ' +
        'Ingen faktura sendes da.</p>' +
        '<p>Spørsmål? Svar på denne e-posten.</p>',
    });
  } catch (err) {
    console.warn('[sub-sweep] owner email failed for salon', row.id, err && err.message);
  }
}

// runSubscriptionSweep — convenience-entry for ekstern cron. Sikker å kalle
// gjentatte ganger; én og samme salong får kun én sveip-behandling fordi
// status flippes fra 'trial' til 'past_due' i samme transaksjon.
async function runSubscriptionSweep() {
  try {
    const rows = await findExpiredTrials();
    for (const row of rows) {
      await processExpiredTrial(row);
    }
    return { count: rows.length };
  } catch (err) {
    console.error('[sub-sweep] runSubscriptionSweep failed', err && err.message ? err.message : err);
    return { count: 0, error: err && err.message ? err.message : 'unknown' };
  }
}

module.exports = {
  findExpiredTrials,
  processExpiredTrial,
  runSubscriptionSweep,
};
