// Fiken-integrasjon (regnskap).
//
// Salongene kobler sin Fiken-konto via OAuth 2.0 (authorization-code flow).
// Tokens lagres på salons-raden. Når en booking markeres «completed», prøver
// vi å opprette en faktura i Fiken automatisk — feiler stille (logget i
// bookings.fiken_sync_error) så booking-flowen ikke blokkeres.
//
// Endepunkter brukes per fiken.no/dokumentasjon (api.fiken.no/api/v2):
//   - GET  {auth}/oauth/authorize  (browser-redirect)
//   - POST {auth}/oauth/token       (server-to-server)
//   - GET  {api}/companies          (etter consent — finn slug)
//   - POST {api}/companies/{slug}/invoices

const config = require('../config');
const { query, queryOne } = require('../db');

function isEnabled() {
  return !!(config.fiken.enabled && config.fiken.clientId && config.fiken.clientSecret && config.fiken.redirectUri);
}

function authStartUrl(state) {
  var u = new URL('/oauth/authorize', config.fiken.authBaseUrl);
  u.searchParams.set('client_id', config.fiken.clientId);
  u.searchParams.set('redirect_uri', config.fiken.redirectUri);
  u.searchParams.set('response_type', 'code');
  // Bestiller bred tilgang: lese selskap + skrive faktura.
  u.searchParams.set('scope', 'read write');
  u.searchParams.set('state', state);
  return u.toString();
}

async function exchangeCodeForToken(code) {
  const tokenUrl = config.fiken.authBaseUrl + '/oauth/token';
  const auth = Buffer.from(config.fiken.clientId + ':' + config.fiken.clientSecret).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: config.fiken.redirectUri,
  });
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + auth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const txt = await res.text().catch(function () { return ''; });
    throw new Error('Fiken token exchange failed: ' + res.status + ' ' + txt);
  }
  return res.json();
}

async function refreshToken(refreshToken) {
  const tokenUrl = config.fiken.authBaseUrl + '/oauth/token';
  const auth = Buffer.from(config.fiken.clientId + ':' + config.fiken.clientSecret).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + auth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const txt = await res.text().catch(function () { return ''; });
    throw new Error('Fiken refresh failed: ' + res.status + ' ' + txt);
  }
  return res.json();
}

// Henter et gyldig access-token for en salong. Refresher hvis utløpt
// (eller utløper innen 60 s). Lagrer det nye tokenet tilbake til DB.
async function getAccessTokenForSalon(salon) {
  if (!salon.fiken_access_token) throw new Error('Fiken ikke koblet til.');
  const now = Date.now();
  const expiresAt = salon.fiken_token_expires_at ? new Date(salon.fiken_token_expires_at).getTime() : 0;
  if (expiresAt && expiresAt - now > 60 * 1000) {
    return salon.fiken_access_token;
  }
  if (!salon.fiken_refresh_token) {
    throw new Error('Fiken-tokenet er utløpt og refresh-token mangler — koble til på nytt.');
  }
  const tok = await refreshToken(salon.fiken_refresh_token);
  const newExpiresAt = new Date(Date.now() + (Number(tok.expires_in || 3600) - 30) * 1000);
  await query(
    `UPDATE salons SET fiken_access_token = ?, fiken_refresh_token = ?, fiken_token_expires_at = ? WHERE id = ?`,
    [tok.access_token, tok.refresh_token || salon.fiken_refresh_token, newExpiresAt, salon.id]
  );
  salon.fiken_access_token = tok.access_token;
  salon.fiken_refresh_token = tok.refresh_token || salon.fiken_refresh_token;
  salon.fiken_token_expires_at = newExpiresAt;
  return tok.access_token;
}

// Lister Fiken-selskaper brukeren har tilgang til. Brukes etter consent
// for å la salongen velge hvilken slug Nailed skal fakturere til.
async function listCompanies(accessToken) {
  const res = await fetch(config.fiken.apiBaseUrl + '/companies', {
    headers: { 'Authorization': 'Bearer ' + accessToken },
  });
  if (!res.ok) throw new Error('Fiken /companies feilet: ' + res.status);
  return res.json();
}

// Opprett en faktura for en booking. Idempotent på vår side: callers bør
// sjekke at bookings.fiken_invoice_id allerede er null før kall.
async function createInvoiceForBooking({ salon, booking, customer, service }) {
  const accessToken = await getAccessTokenForSalon(salon);
  if (!salon.fiken_company_slug) throw new Error('Fiken company_slug ikke satt.');

  const vatCode = service.fiken_vat_code || 'HIGH'; // 25 % MVA default
  const linePrice = Math.round(Number(booking.price_nok || 0) * 100);
  const lineSpec = {
    description: service.name || 'Behandling',
    productId:   service.fiken_product_id || null,
    vatType:     vatCode,
    quantity:    1,
    unitPrice:   linePrice, // øre
    grossPrice:  linePrice, // inkl. MVA
  };

  const payload = {
    issueDate:  new Date().toISOString().slice(0, 10),
    dueDate:    new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    customerEmail: customer.email || null,
    customerName:  customer.name  || 'Kunde',
    lines: [lineSpec],
    bankAccountCode: undefined,
    currency:        'NOK',
    yourReference: 'Nailed booking #' + booking.id,
  };

  const res = await fetch(
    config.fiken.apiBaseUrl + '/companies/' + encodeURIComponent(salon.fiken_company_slug) + '/invoices',
    {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) {
    const txt = await res.text().catch(function () { return ''; });
    throw new Error('Fiken faktura-opprettelse feilet: ' + res.status + ' ' + txt);
  }
  // Fiken returnerer Location-header med URL til den nye fakturaen
  const location = res.headers.get('Location') || res.headers.get('location') || null;
  let invoiceId = null;
  if (location) {
    const m = location.match(/\/invoices\/(\d+)/);
    if (m) invoiceId = m[1];
  }
  return { invoiceId, location };
}

// Kalles fra bookings.js når status → completed. Beste-innsats: feiler
// stille og lagrer feilmeldingen på booking-raden.
async function syncBookingInvoice(bookingId) {
  if (!isEnabled()) return;
  const row = await queryOne(
    `SELECT b.id, b.price_nok, b.salon_id, b.service_id, b.customer_user_id, b.guest_name, b.guest_phone,
            b.fiken_invoice_id,
            sv.name AS service_name, sv.fiken_product_id, sv.fiken_vat_code,
            s.fiken_company_slug, s.fiken_access_token, s.fiken_refresh_token,
            s.fiken_token_expires_at, s.fiken_auto_invoice,
            u.name AS customer_name, u.email AS customer_email
       FROM bookings b
       JOIN services sv ON sv.id = b.service_id
       JOIN salons s    ON s.id = b.salon_id
       LEFT JOIN users u ON u.id = b.customer_user_id
      WHERE b.id = ? LIMIT 1`,
    [bookingId]
  );
  if (!row) return;
  if (row.fiken_invoice_id) return;            // allerede synket
  if (!row.fiken_company_slug) return;          // salong ikke koblet
  if (!row.fiken_auto_invoice)  return;         // auto-faktura avskrudd

  try {
    const result = await createInvoiceForBooking({
      salon: {
        id: row.salon_id,
        fiken_company_slug:      row.fiken_company_slug,
        fiken_access_token:      row.fiken_access_token,
        fiken_refresh_token:     row.fiken_refresh_token,
        fiken_token_expires_at:  row.fiken_token_expires_at,
      },
      booking: { id: row.id, price_nok: row.price_nok },
      customer: {
        name:  row.customer_name  || row.guest_name  || 'Kunde',
        email: row.customer_email || null,
      },
      service: {
        name:             row.service_name,
        fiken_product_id: row.fiken_product_id,
        fiken_vat_code:   row.fiken_vat_code,
      },
    });
    await query(
      `UPDATE bookings
          SET fiken_invoice_id = ?, fiken_invoice_url = ?, fiken_synced_at = NOW(), fiken_sync_error = NULL
        WHERE id = ?`,
      [result.invoiceId, result.location, row.id]
    );
  } catch (err) {
    await query(
      `UPDATE bookings SET fiken_sync_error = ? WHERE id = ?`,
      [String(err.message || err).slice(0, 2000), row.id]
    );
    console.warn('[fiken] sync failed for booking', bookingId, err.message);
  }
}

module.exports = {
  isEnabled,
  authStartUrl,
  exchangeCodeForToken,
  listCompanies,
  syncBookingInvoice,
};
