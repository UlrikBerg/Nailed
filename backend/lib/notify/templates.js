// Norwegian email + SMS templates. Email templates return { subject, html, text }.
// SMS templates return a plain string. Email HTML uses inline styles and the
// system font stack — many clients strip <link> and <style> blocks.

const config = require('../../config');

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDateTime(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return new Intl.DateTimeFormat('nb-NO', {
    timeZone: 'Europe/Oslo',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dt);
}

function fmtTime(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return new Intl.DateTimeFormat('nb-NO', {
    timeZone: 'Europe/Oslo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dt);
}

function fmtShortDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return new Intl.DateTimeFormat('nb-NO', {
    timeZone: 'Europe/Oslo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(dt);
}

function baseUrl() {
  return (config.publicBaseUrl || '').replace(/\/$/, '');
}

function shell(bodyHtml) {
  return `<!doctype html>
<html lang="nb">
<head><meta charset="utf-8"><title>nailed</title></head>
<body style="margin:0;padding:0;background:#f6f6f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f6;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px;max-width:560px;">
        <tr><td>
          <div style="font-size:20px;font-weight:600;margin-bottom:16px;color:#1a1a1a;">nailed</div>
          ${bodyHtml}
          <hr style="border:none;border-top:1px solid #eaeaea;margin:24px 0;">
          <div style="font-size:12px;color:#888;line-height:1.5;">
            Du mottar denne e-posten fordi du har en konto eller en booking på nailed.no.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Renders the salon's free-text confirmation message (booking_confirmation_text)
// as a paragraph after the booking summary. Returns empty string when unset.
function confirmationParagraphHtml(text) {
  const t = (text || '').toString().trim();
  if (!t) return '';
  return `<p style="margin:16px 0;padding:12px 16px;background:#f6f6f6;border-radius:8px;white-space:pre-wrap;">${escapeHtml(t)}</p>`;
}

function confirmationParagraphText(text) {
  const t = (text || '').toString().trim();
  return t ? `\n${t}\n` : '';
}

// -- bookingCreated.customer -------------------------------------------------
// ctx: { customerName, salonName, serviceName, startAt, endAt, priceNok,
//        confirmationText, occurrences (array of {start_at} for series, optional),
//        bookingId, salonAddress }
function bookingCreatedCustomer(ctx) {
  const subject = ctx.occurrences && ctx.occurrences.length > 1
    ? `Bookinger bekreftet hos ${ctx.salonName}`
    : `Booking bekreftet hos ${ctx.salonName}`;

  const when = fmtDateTime(ctx.startAt);
  const series = ctx.occurrences && ctx.occurrences.length > 1
    ? ctx.occurrences.map(o => fmtDateTime(o.start_at)).map(s => `  • ${s}`).join('\n')
    : null;

  const link = `${baseUrl()}/confirmation.html?id=${ctx.bookingId}`;

  let bodyHtml = `<p style="margin:0 0 12px;">Hei ${escapeHtml(ctx.customerName || '')},</p>`;
  if (series) {
    bodyHtml += `<p style="margin:0 0 12px;">Vi har registrert bookingene dine hos <strong>${escapeHtml(ctx.salonName)}</strong>:</p>`;
    bodyHtml += `<ul style="margin:0 0 16px 20px;padding:0;">`;
    for (const o of ctx.occurrences) {
      bodyHtml += `<li style="margin:4px 0;">${escapeHtml(fmtDateTime(o.start_at))}</li>`;
    }
    bodyHtml += `</ul>`;
  } else {
    bodyHtml += `<p style="margin:0 0 12px;">Vi har registrert bookingen din:</p>`;
  }

  bodyHtml += `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;border-collapse:collapse;">
    <tr><td style="padding:4px 12px 4px 0;color:#666;">Salong:</td><td style="padding:4px 0;"><strong>${escapeHtml(ctx.salonName)}</strong></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666;">Behandling:</td><td style="padding:4px 0;">${escapeHtml(ctx.serviceName)}</td></tr>`;
  if (!series) {
    bodyHtml += `<tr><td style="padding:4px 12px 4px 0;color:#666;">Tid:</td><td style="padding:4px 0;">${escapeHtml(when)}</td></tr>`;
  }
  if (ctx.salonAddress) {
    bodyHtml += `<tr><td style="padding:4px 12px 4px 0;color:#666;">Adresse:</td><td style="padding:4px 0;">${escapeHtml(ctx.salonAddress)}</td></tr>`;
  }
  if (ctx.priceNok != null) {
    bodyHtml += `<tr><td style="padding:4px 12px 4px 0;color:#666;">Pris:</td><td style="padding:4px 0;">${ctx.priceNok} kr</td></tr>`;
  }
  bodyHtml += `</table>`;

  bodyHtml += confirmationParagraphHtml(ctx.confirmationText);

  bodyHtml += `<p style="margin:16px 0 0;"><a href="${link}" style="color:#1a1a1a;text-decoration:underline;">Se bookingen på nailed.no</a></p>`;

  const textLines = [
    `Hei ${ctx.customerName || ''},`,
    '',
    series
      ? `Vi har registrert bookingene dine hos ${ctx.salonName}:`
      : 'Vi har registrert bookingen din:',
    '',
  ];
  if (series) {
    textLines.push(series, '');
  }
  textLines.push(`Salong: ${ctx.salonName}`);
  textLines.push(`Behandling: ${ctx.serviceName}`);
  if (!series) textLines.push(`Tid: ${when}`);
  if (ctx.salonAddress) textLines.push(`Adresse: ${ctx.salonAddress}`);
  if (ctx.priceNok != null) textLines.push(`Pris: ${ctx.priceNok} kr`);
  textLines.push(confirmationParagraphText(ctx.confirmationText));
  textLines.push(`Se bookingen: ${link}`);

  return { subject, html: shell(bodyHtml), text: textLines.filter(l => l !== undefined).join('\n') };
}

// -- bookingCreated.owner ---------------------------------------------------
// ctx: { ownerName, salonName, serviceName, startAt, customerDisplayName,
//        customerPhone, bookingId, occurrences (optional) }
function bookingCreatedOwner(ctx) {
  const when = fmtDateTime(ctx.startAt);
  const subject = ctx.occurrences && ctx.occurrences.length > 1
    ? `Ny serie-booking: ${ctx.customerDisplayName || 'kunde'}`
    : `Ny booking: ${ctx.customerDisplayName || 'kunde'} · ${fmtShortDate(ctx.startAt)} ${fmtTime(ctx.startAt)}`;

  const link = `${baseUrl()}/salong-panel.html`;

  let bodyHtml = `<p style="margin:0 0 12px;">Hei ${escapeHtml(ctx.ownerName || '')},</p>`;
  bodyHtml += `<p style="margin:0 0 12px;">Du har fått en ny booking hos <strong>${escapeHtml(ctx.salonName)}</strong>.</p>`;
  bodyHtml += `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;border-collapse:collapse;">
    <tr><td style="padding:4px 12px 4px 0;color:#666;">Kunde:</td><td style="padding:4px 0;"><strong>${escapeHtml(ctx.customerDisplayName || '')}</strong></td></tr>`;
  if (ctx.customerPhone) {
    bodyHtml += `<tr><td style="padding:4px 12px 4px 0;color:#666;">Telefon:</td><td style="padding:4px 0;">${escapeHtml(ctx.customerPhone)}</td></tr>`;
  }
  bodyHtml += `<tr><td style="padding:4px 12px 4px 0;color:#666;">Behandling:</td><td style="padding:4px 0;">${escapeHtml(ctx.serviceName)}</td></tr>`;
  if (ctx.occurrences && ctx.occurrences.length > 1) {
    bodyHtml += `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top;">Tider:</td><td style="padding:4px 0;">`;
    bodyHtml += ctx.occurrences.map(o => escapeHtml(fmtDateTime(o.start_at))).join('<br>');
    bodyHtml += `</td></tr>`;
  } else {
    bodyHtml += `<tr><td style="padding:4px 12px 4px 0;color:#666;">Tid:</td><td style="padding:4px 0;">${escapeHtml(when)}</td></tr>`;
  }
  bodyHtml += `</table>`;
  bodyHtml += `<p style="margin:16px 0 0;"><a href="${link}" style="color:#1a1a1a;text-decoration:underline;">Åpne salong-panelet</a></p>`;

  const lines = [
    `Hei ${ctx.ownerName || ''},`,
    '',
    `Du har fått en ny booking hos ${ctx.salonName}.`,
    '',
    `Kunde: ${ctx.customerDisplayName || ''}`,
  ];
  if (ctx.customerPhone) lines.push(`Telefon: ${ctx.customerPhone}`);
  lines.push(`Behandling: ${ctx.serviceName}`);
  if (ctx.occurrences && ctx.occurrences.length > 1) {
    lines.push('Tider:');
    for (const o of ctx.occurrences) lines.push(`  ${fmtDateTime(o.start_at)}`);
  } else {
    lines.push(`Tid: ${when}`);
  }
  lines.push('', `Åpne salong-panelet: ${link}`);

  return { subject, html: shell(bodyHtml), text: lines.join('\n') };
}

// -- bookingCreated.owner SMS ----------------------------------------------
// ctx: { salonName, serviceName, startAt, customerDisplayName, occurrences }
function bookingCreatedOwnerSms(ctx) {
  if (ctx.occurrences && ctx.occurrences.length > 1) {
    return `Ny serie-booking (${ctx.occurrences.length} ganger): ${ctx.customerDisplayName || 'kunde'} · ${fmtShortDate(ctx.startAt)} ${fmtTime(ctx.startAt)} · ${ctx.serviceName}`;
  }
  return `Ny booking: ${ctx.customerDisplayName || 'kunde'} · ${fmtShortDate(ctx.startAt)} ${fmtTime(ctx.startAt)} · ${ctx.serviceName}`;
}

// -- bookingConfirmed.customer ---------------------------------------------
function bookingConfirmedCustomer(ctx) {
  const subject = `Bekreftet: ${ctx.serviceName} hos ${ctx.salonName}`;
  const when = fmtDateTime(ctx.startAt);
  const link = `${baseUrl()}/confirmation.html?id=${ctx.bookingId}`;

  let bodyHtml = `<p style="margin:0 0 12px;">Hei ${escapeHtml(ctx.customerName || '')},</p>`;
  bodyHtml += `<p style="margin:0 0 12px;">Salongen har bekreftet bookingen din.</p>`;
  bodyHtml += `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;border-collapse:collapse;">
    <tr><td style="padding:4px 12px 4px 0;color:#666;">Salong:</td><td style="padding:4px 0;"><strong>${escapeHtml(ctx.salonName)}</strong></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666;">Behandling:</td><td style="padding:4px 0;">${escapeHtml(ctx.serviceName)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666;">Tid:</td><td style="padding:4px 0;">${escapeHtml(when)}</td></tr>
  </table>`;
  bodyHtml += confirmationParagraphHtml(ctx.confirmationText);
  bodyHtml += `<p style="margin:16px 0 0;"><a href="${link}" style="color:#1a1a1a;text-decoration:underline;">Se bookingen</a></p>`;

  const text = [
    `Hei ${ctx.customerName || ''},`,
    '',
    'Salongen har bekreftet bookingen din.',
    '',
    `Salong: ${ctx.salonName}`,
    `Behandling: ${ctx.serviceName}`,
    `Tid: ${when}`,
    confirmationParagraphText(ctx.confirmationText),
    `Se bookingen: ${link}`,
  ].join('\n');

  return { subject, html: shell(bodyHtml), text };
}

// -- bookingCancelled.customer ---------------------------------------------
// Sent when the salon cancels — service-critical, no opt-out.
function bookingCancelledCustomer(ctx) {
  const subject = `Avlyst: ${ctx.serviceName} hos ${ctx.salonName}`;
  const when = fmtDateTime(ctx.startAt);

  let bodyHtml = `<p style="margin:0 0 12px;">Hei ${escapeHtml(ctx.customerName || '')},</p>`;
  bodyHtml += `<p style="margin:0 0 12px;"><strong>${escapeHtml(ctx.salonName)}</strong> har dessverre avlyst bookingen din.</p>`;
  bodyHtml += `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;border-collapse:collapse;">
    <tr><td style="padding:4px 12px 4px 0;color:#666;">Behandling:</td><td style="padding:4px 0;">${escapeHtml(ctx.serviceName)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666;">Tid:</td><td style="padding:4px 0;">${escapeHtml(when)}</td></tr>
  </table>`;
  bodyHtml += `<p style="margin:16px 0 0;">Ta kontakt med salongen om du har spørsmål, eller finn en ny tid på <a href="${baseUrl()}/" style="color:#1a1a1a;">nailed.no</a>.</p>`;

  const text = [
    `Hei ${ctx.customerName || ''},`,
    '',
    `${ctx.salonName} har dessverre avlyst bookingen din.`,
    '',
    `Behandling: ${ctx.serviceName}`,
    `Tid: ${when}`,
    '',
    `Ta kontakt med salongen om du har spørsmål, eller finn en ny tid på ${baseUrl()}/`,
  ].join('\n');

  return { subject, html: shell(bodyHtml), text };
}

// -- bookingCancelled.owner ------------------------------------------------
// Sent when the customer cancels.
function bookingCancelledOwner(ctx) {
  const subject = `Avbestilt: ${ctx.customerDisplayName || 'kunde'} · ${fmtShortDate(ctx.startAt)} ${fmtTime(ctx.startAt)}`;
  const when = fmtDateTime(ctx.startAt);
  const link = `${baseUrl()}/salong-panel.html`;

  let bodyHtml = `<p style="margin:0 0 12px;">Hei ${escapeHtml(ctx.ownerName || '')},</p>`;
  bodyHtml += `<p style="margin:0 0 12px;">Kunden har avbestilt bookingen.</p>`;
  bodyHtml += `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;border-collapse:collapse;">
    <tr><td style="padding:4px 12px 4px 0;color:#666;">Kunde:</td><td style="padding:4px 0;"><strong>${escapeHtml(ctx.customerDisplayName || '')}</strong></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666;">Behandling:</td><td style="padding:4px 0;">${escapeHtml(ctx.serviceName)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666;">Tid:</td><td style="padding:4px 0;">${escapeHtml(when)}</td></tr>
  </table>`;
  bodyHtml += `<p style="margin:16px 0 0;"><a href="${link}" style="color:#1a1a1a;text-decoration:underline;">Åpne salong-panelet</a></p>`;

  const text = [
    `Hei ${ctx.ownerName || ''},`,
    '',
    'Kunden har avbestilt bookingen.',
    '',
    `Kunde: ${ctx.customerDisplayName || ''}`,
    `Behandling: ${ctx.serviceName}`,
    `Tid: ${when}`,
    '',
    `Åpne salong-panelet: ${link}`,
  ].join('\n');

  return { subject, html: shell(bodyHtml), text };
}

// -- bookingReminder.customer ----------------------------------------------
function bookingReminderCustomer(ctx) {
  const subject = `Påminnelse: ${ctx.serviceName} hos ${ctx.salonName} i morgen`;
  const when = fmtDateTime(ctx.startAt);
  const link = `${baseUrl()}/confirmation.html?id=${ctx.bookingId}`;

  let bodyHtml = `<p style="margin:0 0 12px;">Hei ${escapeHtml(ctx.customerName || '')},</p>`;
  bodyHtml += `<p style="margin:0 0 12px;">Dette er en påminnelse om bookingen din i morgen.</p>`;
  bodyHtml += `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;border-collapse:collapse;">
    <tr><td style="padding:4px 12px 4px 0;color:#666;">Salong:</td><td style="padding:4px 0;"><strong>${escapeHtml(ctx.salonName)}</strong></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666;">Behandling:</td><td style="padding:4px 0;">${escapeHtml(ctx.serviceName)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666;">Tid:</td><td style="padding:4px 0;">${escapeHtml(when)}</td></tr>`;
  if (ctx.salonAddress) {
    bodyHtml += `<tr><td style="padding:4px 12px 4px 0;color:#666;">Adresse:</td><td style="padding:4px 0;">${escapeHtml(ctx.salonAddress)}</td></tr>`;
  }
  bodyHtml += `</table>`;
  bodyHtml += `<p style="margin:16px 0 0;"><a href="${link}" style="color:#1a1a1a;text-decoration:underline;">Se bookingen</a></p>`;

  const text = [
    `Hei ${ctx.customerName || ''},`,
    '',
    'Dette er en påminnelse om bookingen din i morgen.',
    '',
    `Salong: ${ctx.salonName}`,
    `Behandling: ${ctx.serviceName}`,
    `Tid: ${when}`,
    ctx.salonAddress ? `Adresse: ${ctx.salonAddress}` : '',
    '',
    `Se bookingen: ${link}`,
  ].filter(l => l !== undefined).join('\n');

  return { subject, html: shell(bodyHtml), text };
}

function bookingReminderCustomerSms(ctx) {
  return `Påminnelse: ${ctx.serviceName} hos ${ctx.salonName} ${fmtShortDate(ctx.startAt)} kl ${fmtTime(ctx.startAt)}.`;
}

module.exports = {
  bookingCreatedCustomer,
  bookingCreatedOwner,
  bookingCreatedOwnerSms,
  bookingConfirmedCustomer,
  bookingCancelledCustomer,
  bookingCancelledOwner,
  bookingReminderCustomer,
  bookingReminderCustomerSms,
};
