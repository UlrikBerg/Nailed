// Norwegian email + SMS templates. Email templates return { subject, html, text }.
// SMS templates return a plain string. Email HTML uses inline styles and a
// table-based layout so it renders in Outlook/Gmail/Apple Mail/mobile clients.
//
// Brand: cream background (#FBF6EE), rouge accent (#EE3F7E), ink text (#1B1218).
// Logo: rendered as styled HTML text ("nailed.") — SVG/PNG embedded images are
// unreliable across email clients.

const config = require('../../config');

const C = {
  cream: '#FBF6EE',
  cream100: '#F4ECDF',
  ink: '#1B1218',
  fgMuted: '#7A6E69',
  rouge: '#EE3F7E',
  rouge50: '#FFF1F5',
  rouge700: '#82103D',
  stone200: '#E3DCD5',
  stone300: '#CDC4BA',
};

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
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(dt);
}

function fmtDateLong(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return new Intl.DateTimeFormat('nb-NO', {
    timeZone: 'Europe/Oslo',
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  }).format(dt);
}

function fmtTime(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return new Intl.DateTimeFormat('nb-NO', {
    timeZone: 'Europe/Oslo',
    hour: '2-digit', minute: '2-digit',
  }).format(dt);
}

function fmtShortDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return new Intl.DateTimeFormat('nb-NO', {
    timeZone: 'Europe/Oslo',
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(dt);
}

function baseUrl() {
  return (config.publicBaseUrl || '').replace(/\/$/, '');
}

// Logo rendered as HTML text — works in every email client. Cream-on-ink
// version for the header banner.
function logoHtml({ color = C.ink, dotColor = C.rouge, size = 24 } = {}) {
  return `<span style="font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:${size}px;letter-spacing:-0.5px;color:${color};">nailed<span style="color:${dotColor};">.</span></span>`;
}

// Shell wraps every email: cream backdrop → rouge header banner → white card.
function shell({ bodyHtml, preheader }) {
  const pre = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;color:${C.cream};">${escapeHtml(preheader)}</div>`
    : '';
  return `<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>nailed</title>
</head>
<body style="margin:0;padding:0;background:${C.cream};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${C.ink};-webkit-font-smoothing:antialiased;">
${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.cream};">
  <tr><td align="center" style="padding:32px 16px;">

    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
      <tr><td style="padding:0 4px 18px 4px;">
        <a href="${baseUrl()}/" style="text-decoration:none;display:inline-block;">${logoHtml({ size: 26 })}</a>
      </td></tr>

      <tr><td style="background:#ffffff;border-radius:16px;border:1px solid ${C.stone200};padding:36px 36px 30px 36px;box-shadow:0 1px 2px rgba(27,18,24,0.04);">
        ${bodyHtml}
      </td></tr>

      <tr><td style="padding:22px 4px 4px 4px;color:${C.fgMuted};font-size:12px;line-height:1.6;">
        <a href="${baseUrl()}/" style="color:${C.fgMuted};text-decoration:none;">nailed.no</a>
        &nbsp;·&nbsp; <a href="https://www.instagram.com/nailed.no/" style="color:${C.fgMuted};text-decoration:none;">Instagram</a>
        &nbsp;·&nbsp; <a href="${baseUrl()}/kunde-panel.html" style="color:${C.fgMuted};text-decoration:none;">Mine bookinger</a>
        <br>
        <span style="color:${C.stone300};">Du mottar denne e-posten fordi du har en konto eller en booking på nailed.no.</span>
      </td></tr>
    </table>

  </td></tr>
</table>
</body>
</html>`;
}

// "Hero" — the headline + status pill at the top of the card.
function heroHtml({ title, accent }) {
  const pill = accent
    ? `<div style="display:inline-block;background:${C.rouge50};color:${C.rouge700};font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:5px 11px;border-radius:999px;margin-bottom:14px;">${escapeHtml(accent)}</div>`
    : '';
  return `${pill}<h1 style="margin:0 0 18px 0;font-family:Georgia,'Times New Roman',serif;font-weight:600;font-size:28px;line-height:1.18;color:${C.ink};">${escapeHtml(title)}</h1>`;
}

// "When" — the prominent rouge-tinted date/time block.
function whenBlockHtml({ startAt, endAt, durationMin }) {
  const date = fmtDateLong(startAt);
  const start = fmtTime(startAt);
  const end = endAt ? fmtTime(endAt) : null;
  const range = end ? `kl. ${start} – ${end}` : `kl. ${start}`;
  const dur = durationMin ? `<span style="color:${C.fgMuted};font-weight:400;"> · ${durationMin} min</span>` : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.rouge50};border:1px solid #FFD8E5;border-radius:12px;margin:0 0 20px 0;">
    <tr><td style="padding:18px 20px;">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${C.rouge700};margin-bottom:6px;">Tidspunkt</div>
      <div style="font-size:18px;font-weight:600;color:${C.ink};line-height:1.3;">${escapeHtml(date)}</div>
      <div style="font-size:16px;color:${C.ink};margin-top:2px;">${escapeHtml(range)}${dur}</div>
    </td></tr>
  </table>`;
}

// "Detail" — heading + rows.
function detailSectionHtml(title, rows) {
  const visible = rows.filter(r => r && r.value);
  if (!visible.length) return '';
  const rowHtml = visible.map(r => `
    <tr>
      <td style="padding:5px 16px 5px 0;color:${C.fgMuted};font-size:13px;white-space:nowrap;vertical-align:top;">${escapeHtml(r.label)}</td>
      <td style="padding:5px 0;color:${C.ink};font-size:14px;">${r.html ? r.value : escapeHtml(r.value)}</td>
    </tr>`).join('');
  return `<div style="margin:0 0 18px 0;">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${C.fgMuted};margin-bottom:8px;">${escapeHtml(title)}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
      ${rowHtml}
    </table>
  </div>`;
}

function divider() {
  return `<div style="height:1px;background:${C.stone200};margin:22px 0;"></div>`;
}

// Primary CTA button.
function buttonHtml(label, href) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px 0;"><tr><td>
    <a href="${href}" style="background:${C.rouge};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;display:inline-block;padding:12px 22px;border-radius:999px;">${escapeHtml(label)}</a>
  </td></tr></table>`;
}

// Subtle text link.
function linkHtml(label, href) {
  return `<a href="${href}" style="color:${C.rouge700};text-decoration:none;font-weight:600;">${escapeHtml(label)}</a>`;
}

function confirmationParagraphHtml(text) {
  const t = (text || '').toString().trim();
  if (!t) return '';
  return `<div style="margin:0 0 20px 0;padding:16px 18px;background:${C.cream100};border-radius:10px;color:${C.ink};font-size:14px;line-height:1.55;white-space:pre-wrap;">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${C.fgMuted};margin-bottom:6px;">Beskjed fra salongen</div>
    ${escapeHtml(t)}
  </div>`;
}

function mapsLink(salon) {
  if (Number.isFinite(salon.lat) && Number.isFinite(salon.lng)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(salon.lat + ',' + salon.lng)}`;
  }
  const addr = [salon.address_line, salon.postal_code, salon.city].filter(Boolean).join(' ');
  return addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` : null;
}

function salonPageLink(salon) {
  return salon.slug ? `${baseUrl()}/salon.html?slug=${encodeURIComponent(salon.slug)}` : `${baseUrl()}/`;
}

function bookingPageLink(bookingId) {
  return `${baseUrl()}/confirmation.html?id=${encodeURIComponent(bookingId)}`;
}

// Cancellation deadline = startAt - leadHours.
function cancelDeadline(startAt, leadHours) {
  if (!leadHours) return null;
  const dt = startAt instanceof Date ? startAt : new Date(startAt);
  if (Number.isNaN(dt.getTime())) return null;
  return new Date(dt.getTime() - Number(leadHours) * 3_600_000);
}

// =============================================================================
// bookingCreated.customer
// =============================================================================
// ctx: { customerName, salon, salonPhone, serviceName, durationMin,
//        teamMemberName, startAt, endAt, priceNok, customerNote,
//        confirmationText, cancellationLeadHours, occurrences, bookingId }
function bookingCreatedCustomer(ctx) {
  const isSeries = ctx.occurrences && ctx.occurrences.length > 1;
  const subject = isSeries
    ? `Bookinger bekreftet hos ${ctx.salon.name}`
    : `Booking bekreftet hos ${ctx.salon.name}`;
  const preheader = isSeries
    ? `${ctx.occurrences.length} timer hos ${ctx.salon.name} — første: ${fmtShortDate(ctx.startAt)} kl. ${fmtTime(ctx.startAt)}`
    : `${fmtShortDate(ctx.startAt)} kl. ${fmtTime(ctx.startAt)} · ${ctx.serviceName} hos ${ctx.salon.name}`;

  const link = bookingPageLink(ctx.bookingId);
  const map = mapsLink(ctx.salon);
  const salonLink = salonPageLink(ctx.salon);
  const deadline = cancelDeadline(ctx.startAt, ctx.cancellationLeadHours);

  let body = '';
  body += heroHtml({
    title: isSeries ? `Bookingene dine er registrert ✓` : `Bookingen din er bekreftet ✓`,
    accent: isSeries ? 'Fast time-serie' : null,
  });
  body += `<p style="margin:0 0 22px 0;font-size:15px;line-height:1.55;color:${C.fgMuted};">Hei ${escapeHtml(ctx.customerName || '')}, takk for at du booket hos <strong style="color:${C.ink};">${escapeHtml(ctx.salon.name)}</strong>. Vi har sendt en kopi av denne bekreftelsen til e-posten din.</p>`;

  if (isSeries) {
    body += `<div style="margin:0 0 20px 0;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${C.rouge700};margin-bottom:8px;">${ctx.occurrences.length} tider</div>
      <ul style="margin:0;padding:0 0 0 20px;color:${C.ink};font-size:14px;line-height:1.7;">
        ${ctx.occurrences.map(o => `<li>${escapeHtml(fmtDateTime(o.start_at))}</li>`).join('')}
      </ul>
    </div>`;
  } else {
    body += whenBlockHtml({ startAt: ctx.startAt, endAt: ctx.endAt, durationMin: ctx.durationMin });
  }

  // SALONG
  const addressRow = ctx.salon.address ? { label: 'Adresse', value: ctx.salon.address } : null;
  const phoneRow = ctx.salonPhone ? { label: 'Telefon', value: ctx.salonPhone } : null;
  body += detailSectionHtml('Salong', [
    { label: 'Navn', value: ctx.salon.name },
    addressRow,
    phoneRow,
  ]);

  // BEHANDLING
  body += detailSectionHtml('Behandling', [
    { label: 'Tjeneste', value: ctx.serviceName },
    ctx.teamMemberName ? { label: 'Behandler', value: ctx.teamMemberName } : null,
    ctx.priceNok != null ? { label: 'Pris', value: `${ctx.priceNok} kr` } : null,
    ctx.durationMin && !isSeries ? null : (ctx.durationMin ? { label: 'Varighet', value: `${ctx.durationMin} min` } : null),
  ]);

  // Customer's own note to the salon (echo back so they know it was received).
  if (ctx.customerNote) {
    body += `<div style="margin:0 0 18px 0;padding:14px 16px;background:${C.cream};border:1px dashed ${C.stone200};border-radius:10px;color:${C.ink};font-size:13px;line-height:1.55;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${C.fgMuted};margin-bottom:6px;">Din beskjed</div>
      ${escapeHtml(ctx.customerNote)}
    </div>`;
  }

  body += confirmationParagraphHtml(ctx.confirmationText);

  // CTA
  body += buttonHtml('Se bookingen', link);
  const sideLinks = [];
  if (map) sideLinks.push(linkHtml('Veibeskrivelse', map));
  sideLinks.push(linkHtml('Salongens side', salonLink));
  body += `<div style="margin-top:14px;font-size:13px;color:${C.fgMuted};">${sideLinks.join(' &nbsp;·&nbsp; ')}</div>`;

  body += divider();
  body += `<div style="font-size:12px;color:${C.fgMuted};line-height:1.6;">
    <strong style="color:${C.ink};font-weight:600;">Avbestilling</strong><br>`;
  if (deadline) {
    body += `Avbestill senest <strong style="color:${C.ink};">${escapeHtml(fmtDateTime(deadline))}</strong> for å unngå gebyr.`;
  } else if (ctx.cancellationLeadHours) {
    body += `Avbestill senest ${ctx.cancellationLeadHours} timer før timen for å unngå gebyr.`;
  } else {
    body += `Ta kontakt med salongen om du må avbestille.`;
  }
  body += `<br>Bookings-ID: <span style="font-family:Menlo,Consolas,monospace;color:${C.ink};">#${escapeHtml(String(ctx.bookingId))}</span></div>`;

  // ----- Plain-text fallback -----
  const lines = [
    `Hei ${ctx.customerName || ''},`,
    '',
    isSeries
      ? `Vi har registrert ${ctx.occurrences.length} bookinger hos ${ctx.salon.name}:`
      : `Bookingen din hos ${ctx.salon.name} er bekreftet.`,
    '',
  ];
  if (isSeries) {
    for (const o of ctx.occurrences) lines.push(`  • ${fmtDateTime(o.start_at)}`);
    lines.push('');
  } else {
    lines.push(`Tid: ${fmtDateTime(ctx.startAt)}`);
    if (ctx.durationMin) lines.push(`Varighet: ${ctx.durationMin} min`);
    lines.push('');
  }
  lines.push(`Salong: ${ctx.salon.name}`);
  if (ctx.salon.address) lines.push(`Adresse: ${ctx.salon.address}`);
  if (ctx.salonPhone) lines.push(`Telefon: ${ctx.salonPhone}`);
  lines.push('');
  lines.push(`Behandling: ${ctx.serviceName}`);
  if (ctx.teamMemberName) lines.push(`Behandler: ${ctx.teamMemberName}`);
  if (ctx.priceNok != null) lines.push(`Pris: ${ctx.priceNok} kr`);
  if (ctx.customerNote) {
    lines.push('', `Din beskjed: ${ctx.customerNote}`);
  }
  if ((ctx.confirmationText || '').trim()) {
    lines.push('', `Beskjed fra salongen:`, ctx.confirmationText.trim());
  }
  lines.push('');
  lines.push(`Se bookingen: ${link}`);
  if (map) lines.push(`Veibeskrivelse: ${map}`);
  lines.push('');
  if (deadline) lines.push(`Avbestill senest: ${fmtDateTime(deadline)}`);
  else if (ctx.cancellationLeadHours) lines.push(`Avbestill senest ${ctx.cancellationLeadHours} timer før timen.`);
  lines.push(`Bookings-ID: #${ctx.bookingId}`);

  return { subject, html: shell({ bodyHtml: body, preheader }), text: lines.join('\n') };
}

// =============================================================================
// bookingCreated.owner
// =============================================================================
// ctx: { ownerName, salonName, serviceName, durationMin, priceNok,
//        teamMemberName, startAt, endAt, customerDisplayName, customerPhone,
//        customerNote, isGuest, bookingId, occurrences }
function bookingCreatedOwner(ctx) {
  const isSeries = ctx.occurrences && ctx.occurrences.length > 1;
  const subject = isSeries
    ? `Ny serie-booking: ${ctx.customerDisplayName || 'kunde'} (${ctx.occurrences.length} timer)`
    : `Ny booking: ${ctx.customerDisplayName || 'kunde'} · ${fmtShortDate(ctx.startAt)} kl. ${fmtTime(ctx.startAt)}`;
  const preheader = `${ctx.serviceName}${ctx.teamMemberName ? ' · ' + ctx.teamMemberName : ''} · ${fmtShortDate(ctx.startAt)} kl. ${fmtTime(ctx.startAt)}`;

  const panelLink = `${baseUrl()}/salong-panel.html`;
  const callLink = ctx.customerPhone ? `tel:${ctx.customerPhone.replace(/\s+/g, '')}` : null;

  let body = '';
  body += heroHtml({
    title: isSeries ? `Ny serie-booking` : `Ny booking`,
    accent: ctx.isGuest ? 'Walk-in / telefon' : 'Online',
  });
  body += `<p style="margin:0 0 22px 0;font-size:15px;line-height:1.55;color:${C.fgMuted};">Hei ${escapeHtml(ctx.ownerName || '')}, du har fått en ny booking i kalenderen.</p>`;

  if (isSeries) {
    body += `<div style="margin:0 0 20px 0;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${C.rouge700};margin-bottom:8px;">${ctx.occurrences.length} tider</div>
      <ul style="margin:0;padding:0 0 0 20px;color:${C.ink};font-size:14px;line-height:1.7;">
        ${ctx.occurrences.map(o => `<li>${escapeHtml(fmtDateTime(o.start_at))}</li>`).join('')}
      </ul>
    </div>`;
  } else {
    body += whenBlockHtml({ startAt: ctx.startAt, endAt: ctx.endAt, durationMin: ctx.durationMin });
  }

  // KUNDE
  body += detailSectionHtml('Kunde', [
    { label: 'Navn', value: ctx.customerDisplayName || '—' },
    ctx.customerPhone ? {
      label: 'Telefon',
      value: callLink
        ? `<a href="${callLink}" style="color:${C.rouge700};text-decoration:none;">${escapeHtml(ctx.customerPhone)}</a>`
        : escapeHtml(ctx.customerPhone),
      html: true,
    } : null,
    ctx.isGuest ? { label: 'Type', value: 'Manuell booking (walk-in / telefon)' } : null,
  ]);

  // BEHANDLING
  body += detailSectionHtml('Behandling', [
    { label: 'Tjeneste', value: ctx.serviceName },
    ctx.teamMemberName ? { label: 'Behandler', value: ctx.teamMemberName } : null,
    ctx.durationMin ? { label: 'Varighet', value: `${ctx.durationMin} min` } : null,
    ctx.priceNok != null ? { label: 'Pris', value: `${ctx.priceNok} kr` } : null,
  ]);

  if (ctx.customerNote) {
    body += `<div style="margin:0 0 18px 0;padding:14px 16px;background:${C.cream};border:1px dashed ${C.stone200};border-radius:10px;color:${C.ink};font-size:13px;line-height:1.55;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${C.fgMuted};margin-bottom:6px;">Beskjed fra kunden</div>
      ${escapeHtml(ctx.customerNote)}
    </div>`;
  }

  body += buttonHtml('Åpne salong-panelet', panelLink);
  body += divider();
  body += `<div style="font-size:12px;color:${C.fgMuted};">Bookings-ID: <span style="font-family:Menlo,Consolas,monospace;color:${C.ink};">#${escapeHtml(String(ctx.bookingId))}</span></div>`;

  // ----- Plain text -----
  const lines = [
    `Hei ${ctx.ownerName || ''},`,
    '',
    isSeries
      ? `Ny serie-booking (${ctx.occurrences.length} timer):`
      : 'Ny booking i kalenderen:',
    '',
  ];
  if (isSeries) {
    for (const o of ctx.occurrences) lines.push(`  • ${fmtDateTime(o.start_at)}`);
  } else {
    lines.push(`Tid: ${fmtDateTime(ctx.startAt)}`);
    if (ctx.durationMin) lines.push(`Varighet: ${ctx.durationMin} min`);
  }
  lines.push('');
  lines.push(`Kunde: ${ctx.customerDisplayName || '—'}`);
  if (ctx.customerPhone) lines.push(`Telefon: ${ctx.customerPhone}`);
  if (ctx.isGuest) lines.push(`Type: Manuell booking (walk-in / telefon)`);
  lines.push('');
  lines.push(`Behandling: ${ctx.serviceName}`);
  if (ctx.teamMemberName) lines.push(`Behandler: ${ctx.teamMemberName}`);
  if (ctx.priceNok != null) lines.push(`Pris: ${ctx.priceNok} kr`);
  if (ctx.customerNote) lines.push('', `Beskjed fra kunden: ${ctx.customerNote}`);
  lines.push('', `Åpne salong-panelet: ${panelLink}`);
  lines.push(`Bookings-ID: #${ctx.bookingId}`);

  return { subject, html: shell({ bodyHtml: body, preheader }), text: lines.join('\n') };
}

// =============================================================================
// bookingCreated.owner SMS (Twilio max ~160 chars per segment — keep tight)
// =============================================================================
function bookingCreatedOwnerSms(ctx) {
  if (ctx.occurrences && ctx.occurrences.length > 1) {
    return `nailed: Ny serie-booking (${ctx.occurrences.length}×): ${ctx.customerDisplayName || 'kunde'} · første ${fmtShortDate(ctx.startAt)} kl. ${fmtTime(ctx.startAt)} · ${ctx.serviceName}`;
  }
  return `nailed: Ny booking ${fmtShortDate(ctx.startAt)} kl. ${fmtTime(ctx.startAt)} — ${ctx.customerDisplayName || 'kunde'} · ${ctx.serviceName}`;
}

// =============================================================================
// bookingConfirmed.customer
// =============================================================================
function bookingConfirmedCustomer(ctx) {
  const subject = `Bekreftet: ${ctx.serviceName} hos ${ctx.salonName}`;
  const preheader = `${fmtShortDate(ctx.startAt)} kl. ${fmtTime(ctx.startAt)} — salongen har bekreftet`;
  const link = bookingPageLink(ctx.bookingId);

  let body = '';
  body += heroHtml({ title: 'Salongen har bekreftet ✓', accent: 'Bekreftet' });
  body += `<p style="margin:0 0 22px 0;font-size:15px;line-height:1.55;color:${C.fgMuted};">Hei ${escapeHtml(ctx.customerName || '')}, <strong style="color:${C.ink};">${escapeHtml(ctx.salonName)}</strong> har bekreftet bookingen din. Vi sees!</p>`;
  body += whenBlockHtml({ startAt: ctx.startAt });
  body += detailSectionHtml('Detaljer', [
    { label: 'Salong', value: ctx.salonName },
    { label: 'Behandling', value: ctx.serviceName },
  ]);
  body += confirmationParagraphHtml(ctx.confirmationText);
  body += buttonHtml('Se bookingen', link);

  const text = [
    `Hei ${ctx.customerName || ''},`,
    '',
    `${ctx.salonName} har bekreftet bookingen din.`,
    '',
    `Tid: ${fmtDateTime(ctx.startAt)}`,
    `Behandling: ${ctx.serviceName}`,
    (ctx.confirmationText || '').trim() ? `\nBeskjed fra salongen:\n${ctx.confirmationText.trim()}` : '',
    '',
    `Se bookingen: ${link}`,
  ].join('\n');

  return { subject, html: shell({ bodyHtml: body, preheader }), text };
}

// =============================================================================
// bookingCancelled.customer (salon cancelled — service-critical)
// =============================================================================
function bookingCancelledCustomer(ctx) {
  const subject = `Avlyst: ${ctx.serviceName} hos ${ctx.salonName}`;
  const preheader = `${ctx.salonName} har avlyst timen din ${fmtShortDate(ctx.startAt)}`;

  let body = '';
  body += heroHtml({ title: 'Timen din ble avlyst', accent: 'Avlyst av salongen' });
  body += `<p style="margin:0 0 22px 0;font-size:15px;line-height:1.55;color:${C.fgMuted};">Hei ${escapeHtml(ctx.customerName || '')}, <strong style="color:${C.ink};">${escapeHtml(ctx.salonName)}</strong> har dessverre måttet avlyse bookingen din. Vi beklager bryderiet.</p>`;
  body += whenBlockHtml({ startAt: ctx.startAt });
  body += detailSectionHtml('Det gjaldt', [
    { label: 'Behandling', value: ctx.serviceName },
    { label: 'Salong', value: ctx.salonName },
  ]);
  body += `<p style="margin:0 0 18px 0;font-size:14px;line-height:1.55;color:${C.ink};">Ta gjerne kontakt med salongen om du har spørsmål, eller finn en ny tid på nailed.</p>`;
  body += buttonHtml('Finn ny tid', `${baseUrl()}/utforsk.html`);

  const text = [
    `Hei ${ctx.customerName || ''},`,
    '',
    `${ctx.salonName} har dessverre måttet avlyse bookingen din.`,
    '',
    `Tid: ${fmtDateTime(ctx.startAt)}`,
    `Behandling: ${ctx.serviceName}`,
    '',
    `Finn ny tid: ${baseUrl()}/utforsk.html`,
  ].join('\n');

  return { subject, html: shell({ bodyHtml: body, preheader }), text };
}

// =============================================================================
// bookingCancelled.owner (customer cancelled)
// =============================================================================
function bookingCancelledOwner(ctx) {
  const subject = `Avbestilt: ${ctx.customerDisplayName || 'kunde'} · ${fmtShortDate(ctx.startAt)} kl. ${fmtTime(ctx.startAt)}`;
  const preheader = `${ctx.customerDisplayName || 'Kunden'} har avbestilt — slotten er ledig igjen`;
  const link = `${baseUrl()}/salong-panel.html`;

  let body = '';
  body += heroHtml({ title: 'Kunden har avbestilt', accent: 'Avbestilling' });
  body += `<p style="margin:0 0 22px 0;font-size:15px;line-height:1.55;color:${C.fgMuted};">Hei ${escapeHtml(ctx.ownerName || '')}, slotten er nå ledig igjen i kalenderen din.</p>`;
  body += whenBlockHtml({ startAt: ctx.startAt });
  body += detailSectionHtml('Det gjaldt', [
    { label: 'Kunde', value: ctx.customerDisplayName || '—' },
    { label: 'Behandling', value: ctx.serviceName },
  ]);
  body += buttonHtml('Åpne salong-panelet', link);

  const text = [
    `Hei ${ctx.ownerName || ''},`,
    '',
    'Kunden har avbestilt bookingen.',
    '',
    `Tid: ${fmtDateTime(ctx.startAt)}`,
    `Kunde: ${ctx.customerDisplayName || '—'}`,
    `Behandling: ${ctx.serviceName}`,
    '',
    `Åpne salong-panelet: ${link}`,
  ].join('\n');

  return { subject, html: shell({ bodyHtml: body, preheader }), text };
}

// =============================================================================
// bookingReminder.customer
// =============================================================================
function bookingReminderCustomer(ctx) {
  const subject = `Påminnelse: ${ctx.serviceName} hos ${ctx.salonName} i morgen`;
  const preheader = `I morgen kl. ${fmtTime(ctx.startAt)} hos ${ctx.salonName}`;
  const link = bookingPageLink(ctx.bookingId);

  let body = '';
  body += heroHtml({ title: 'Vi sees i morgen ✨', accent: 'Påminnelse' });
  body += `<p style="margin:0 0 22px 0;font-size:15px;line-height:1.55;color:${C.fgMuted};">Hei ${escapeHtml(ctx.customerName || '')}, en liten påminnelse om bookingen din hos <strong style="color:${C.ink};">${escapeHtml(ctx.salonName)}</strong>.</p>`;
  body += whenBlockHtml({ startAt: ctx.startAt });
  body += detailSectionHtml('Detaljer', [
    { label: 'Behandling', value: ctx.serviceName },
    ctx.salonAddress ? { label: 'Adresse', value: ctx.salonAddress } : null,
  ]);
  body += buttonHtml('Se bookingen', link);

  const text = [
    `Hei ${ctx.customerName || ''},`,
    '',
    `Påminnelse om bookingen din hos ${ctx.salonName} i morgen.`,
    '',
    `Tid: ${fmtDateTime(ctx.startAt)}`,
    `Behandling: ${ctx.serviceName}`,
    ctx.salonAddress ? `Adresse: ${ctx.salonAddress}` : '',
    '',
    `Se bookingen: ${link}`,
  ].filter(Boolean).join('\n');

  return { subject, html: shell({ bodyHtml: body, preheader }), text };
}

function bookingReminderCustomerSms(ctx) {
  return `nailed: Påminnelse — ${ctx.serviceName} hos ${ctx.salonName} ${fmtShortDate(ctx.startAt)} kl. ${fmtTime(ctx.startAt)}.`;
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
