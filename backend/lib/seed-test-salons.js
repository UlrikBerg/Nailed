// Felles seed-logikk brukt av både CLI-scriptet og admin-endepunktet.
// Tar en konnektør (query-funksjon eller mysql2-connection) og oppretter
// N test-salonger med kategorier, tjenester, team, åpningstider,
// amenities og bilder.

const SALON_PREFIX = ['Aurora', 'Velvære', 'Bloom', 'Eleganse', 'Velour', 'Lumen',
  'Atelier', 'Nova', 'Lyra', 'Onde', 'Pure', 'Studio', 'Klinikk', 'Sjelero',
  'Sol', 'Skinn', 'Glo', 'Edel', 'Lilje', 'Brun'];
const SALON_SUFFIX = ['Studio', 'Salong', 'Klinikk', 'Spa', 'Atelier', 'Beauty',
  'House', 'Lab', 'Hjørnet', 'Rom'];
const CITIES = [
  { name: 'Oslo', postal: '0150' }, { name: 'Bergen', postal: '5003' },
  { name: 'Trondheim', postal: '7010' }, { name: 'Stavanger', postal: '4005' },
  { name: 'Drammen', postal: '3015' }, { name: 'Tromsø', postal: '9008' },
  { name: 'Kristiansand', postal: '4612' }, { name: 'Fredrikstad', postal: '1604' },
  { name: 'Sandnes', postal: '4306' }, { name: 'Bodø', postal: '8005' },
  { name: 'Ålesund', postal: '6002' }, { name: 'Halden', postal: '1767' },
  { name: 'Hamar', postal: '2317' }, { name: 'Lillestrøm', postal: '2000' },
];
const STREETS = ['Storgata', 'Kirkegata', 'Hovedgata', 'Bryggen', 'Torggata',
  'Strandvegen', 'Kongensgate', 'Nygata', 'Markens', 'Torvet'];
const FIRST_NAMES = ['Anne', 'Maria', 'Camilla', 'Silje', 'Linn', 'Ida', 'Mia', 'Nora',
  'Sara', 'Emma', 'Sofie', 'Anna', 'Tone', 'Kristin', 'Hilde', 'Marte', 'Lise',
  'Renate', 'Cecilie', 'Trine'];
const LAST_NAMES = ['Hansen', 'Johansen', 'Olsen', 'Larsen', 'Andersen', 'Nilsen',
  'Pedersen', 'Kristiansen', 'Karlsen', 'Berg', 'Lund', 'Solberg', 'Bakken',
  'Eriksen', 'Mathisen'];
const CATEGORIES = ['Vipper', 'Negler', 'Bryn', 'Hud', 'Hår', 'Makeup', 'Voksing', 'Spa'];
const SERVICES_BY_CAT = {
  Vipper:  [
    { name: 'Klassiske vipper', dur: 90, price: 750 },
    { name: 'Volumvipper', dur: 120, price: 950 },
    { name: 'Påfyll', dur: 60, price: 550 },
    { name: 'Fjerning av vipper', dur: 30, price: 300 },
    { name: 'Vippeløft', dur: 45, price: 600 },
  ],
  Negler:  [
    { name: 'Manikyr', dur: 45, price: 450 },
    { name: 'Pedikyr', dur: 60, price: 600 },
    { name: 'Gel-negler', dur: 90, price: 750 },
    { name: 'Akrylforlengelse', dur: 120, price: 950 },
    { name: 'Negldesign', dur: 30, price: 250 },
  ],
  Bryn:    [
    { name: 'Brynforming', dur: 30, price: 350 },
    { name: 'Henna-bryn', dur: 45, price: 500 },
    { name: 'Brow lamination', dur: 60, price: 800 },
    { name: 'Brynfarging', dur: 30, price: 350 },
  ],
  Hud:     [
    { name: 'Ansiktsbehandling', dur: 60, price: 950 },
    { name: 'Microdermabrasion', dur: 45, price: 850 },
    { name: 'Kjemisk peeling', dur: 60, price: 1200 },
    { name: 'Aknekur', dur: 75, price: 1100 },
  ],
  Hår:     [
    { name: 'Dameklipp', dur: 60, price: 750 },
    { name: 'Herreklipp', dur: 30, price: 450 },
    { name: 'Helfarging', dur: 120, price: 1500 },
    { name: 'Striper', dur: 150, price: 1800 },
    { name: 'Föning', dur: 30, price: 350 },
  ],
  Makeup:  [
    { name: 'Brudemakeup', dur: 90, price: 1800 },
    { name: 'Festmakeup', dur: 60, price: 950 },
    { name: 'Makeup-kurs', dur: 90, price: 1400 },
    { name: 'Makeup-konsultasjon', dur: 45, price: 650 },
  ],
  Voksing: [
    { name: 'Voksing av bryn', dur: 15, price: 250 },
    { name: 'Voksing av legger', dur: 30, price: 450 },
    { name: 'Voksing bikinilinje', dur: 30, price: 500 },
    { name: 'Brazilian-voks', dur: 45, price: 700 },
  ],
  Spa:     [
    { name: 'Massasje (klassisk)', dur: 60, price: 950 },
    { name: 'Hot stone', dur: 75, price: 1200 },
    { name: 'Avspenningspakke', dur: 90, price: 1500 },
  ],
};
const UNSPLASH_PHOTOS = [
  '1522335789203-aaa83c7b0d23', '1487412947147-5cebf100ffc2',
  '1599386530000-b8a3a82e6c0b', '1560066984-138dadb4c035',
  '1604654894611-6973b376cbde', '1571781926291-c477ebfd024b',
  '1502823403499-6ccfcf4fb453', '1521735032199-90d3a0099f55',
  '1457972729786-0411a3b2b626', '1573461160327-b450ce3d8e7f',
  '1583241800698-9c2e09a8c8d3', '1503951914875-452162b0f3f1',
  '1559599101-f09722fb4948',    '1556228720-195a672e8a03',
  '1607008829749-c0f284a49841', '1576091160550-2173dba999ef',
  '1612967853503-26f29e7cc92e', '1594825975023-d4c4ec76e927',
  '1503236-1d8ef9c0a08a',       '1583241475880-083f84372725',
];
const AMENITIES = ['wifi', 'parking', 'kortbetaling', 'vippsbetaling',
  'rullestolvennlig', 'barnevennlig', 'kjonnsnoytral', 'gavekort'];

function rand(n)   { return Math.floor(Math.random() * n); }
function pick(arr) { return arr[rand(arr.length)]; }
function pickN(arr, n) {
  const copy = arr.slice();
  const out = [];
  while (out.length < n && copy.length) out.push(copy.splice(rand(copy.length), 1)[0]);
  return out;
}
function imageUrl(photoId, w) {
  return 'https://images.unsplash.com/photo-' + photoId +
    '?auto=format&fit=crop&w=' + (w || 1200) + '&q=80';
}
function slugify(s) {
  return String(s).toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/æ/g, 'a').replace(/ø/g, 'o').replace(/å/g, 'a')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Test-kunder. Opprettes første gang seed kjøres og gjenbrukes etterpå
// for bookinger / anmeldelser / chat-meldinger.
const TEST_CUSTOMERS = [
  ['kari@test-nailed.no',     'Kari Nordmann'],
  ['ola@test-nailed.no',      'Ola Hansen'],
  ['emma@test-nailed.no',     'Emma Berg'],
  ['ingrid@test-nailed.no',   'Ingrid Olsen'],
  ['lars@test-nailed.no',     'Lars Andersen'],
  ['silje@test-nailed.no',    'Silje Larsen'],
  ['petter@test-nailed.no',   'Petter Karlsen'],
  ['mia@test-nailed.no',      'Mia Solberg'],
  ['marius@test-nailed.no',   'Marius Lund'],
  ['nina@test-nailed.no',     'Nina Pedersen'],
  ['johan@test-nailed.no',    'Johan Eriksen'],
  ['sofia@test-nailed.no',    'Sofia Bakken'],
];

const REVIEW_BODIES = [
  'Fantastisk opplevelse! Behandleren var profesjonell og resultatet ble fantastisk. Kommer definitivt tilbake!',
  'Veldig fornøyd. Avslappet atmosfære og dyktige behandlere.',
  'Greit nok, men ventet litt lenge. Resultatet var bra.',
  'Anbefales på det sterkeste. Super service og fint lokale.',
  'Helt fornøyd! Følte meg ivaretatt fra start til slutt.',
  'Ok behandling, men prisene er litt høye for det man får.',
  'Beste salongen i byen! Alltid godt humør og super kvalitet.',
  'Stilig sted, dyktig personale. Resultatet holdt seg lenge.',
  'God service og koselig atmosfære. Anbefaler!',
  'Litt skuffende. Behandleren virket stresset og resultatet ble ikke som forventet.',
];

const REPLY_BODIES = [
  'Tusen takk for hyggelig tilbakemelding! Vi setter stor pris på det og gleder oss til å se deg igjen.',
  'Takk! Vi er glade for at du er fornøyd.',
  'Hei, takk for at du tok deg tid til å skrive. Vi tar gjerne en prat hvis du har innspill.',
  'Beklager opplevelsen — vi tar dette på alvor. Ta gjerne kontakt direkte så fikser vi det.',
];

const CHAT_LINES_CUSTOMER = [
  'Hei! Jeg har et spørsmål om behandlingen.',
  'Er det mulig å flytte timen min?',
  'Tar dere imot kort eller bare Vipps?',
  'Hvor lang tid tar voksing?',
  'Kan jeg ha med meg en venn?',
  'Tusen takk for sist! 😊',
  'Hva slags merker bruker dere?',
  'Hvor mye koster vippeløft?',
];
const CHAT_LINES_SALON = [
  'Hei, hyggelig av deg å høre fra deg! Hva lurer du på?',
  'Selvfølgelig — hvilken dato passer best?',
  'Vi tar både kort, Vipps og kontanter.',
  'Voksing tar ca. 30 min for legger.',
  'Det går helt fint, du kan ha med deg en venn.',
  'Tusen takk for hyggelig tilbakemelding!',
  'Vi bruker bare produkter av høy kvalitet.',
  'Vippeløft koster 600 kr.',
];
const REPORT_REASONS = [
  'Upassende språk',
  'Spam',
  'Truende oppførsel',
  'Annet',
];

// `q` er en async-funksjon som tar (sql, params) og returnerer [rows] (mysql2 promise-style).
async function seedTestSalons(q, count, onProgress) {
  count = Math.max(1, Math.min(500, Number(count) || 100));

  // Test-eier
  const ownerEmail = 'test+seed@nailed.no';
  let ownerRow = (await q('SELECT id FROM users WHERE email = ? LIMIT 1', [ownerEmail]))[0];
  let ownerId;
  if (Array.isArray(ownerRow)) ownerRow = ownerRow[0]; // [rows] tuple
  if (!ownerRow) {
    const r = await q(`INSERT INTO users (email, name, role) VALUES (?, ?, 'salon_owner')`,
      [ownerEmail, 'Test Seed']);
    ownerId = r.insertId || (r[0] && r[0].insertId);
  } else {
    ownerId = ownerRow.id;
  }

  // Test-kunder (12 stk). Gjenbrukes på tvers av salonger.
  const customerIds = [];
  for (const [email, name] of TEST_CUSTOMERS) {
    const existing = await q('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    let row = Array.isArray(existing[0]) ? existing[0][0] : existing[0];
    if (!row) {
      const r = await q(`INSERT INTO users (email, name, role) VALUES (?, ?, 'user')`,
        [email, name]);
      customerIds.push(r.insertId || (r[0] && r[0].insertId));
    } else {
      customerIds.push(row.id);
    }
  }

  let created = 0, skipped = 0, backfilled = 0;

  // Felles inline-aktivitet-seed for en salong: bookinger / anmeldelser / chat.
  // Forventer at salongen allerede har services + ingen bookinger.
  async function seedActivityForSalon(salonId) {
    const svcRows = await q(
      'SELECT id, duration_min, price_nok FROM services WHERE salon_id = ?',
      [salonId]
    );
    const services = Array.isArray(svcRows[0]) ? svcRows[0] : svcRows;
    if (!services.length) return;
    const numBookings = 8 + rand(8);
    const completedBookingIds = [];
    const bookingCustomerByBookingId = {};
    for (let bi = 0; bi < numBookings; bi++) {
      const svc = pick(services);
      const cust = pick(customerIds);
      let status, daysOffset;
      const r = Math.random();
      if (r < 0.35)      { status = 'completed'; daysOffset = -1 - rand(30); }
      else if (r < 0.55) { status = 'confirmed'; daysOffset = 1 + rand(14); }
      else if (r < 0.75) { status = 'pending';   daysOffset = 1 + rand(14); }
      else if (r < 0.9)  { status = 'cancelled'; daysOffset = -5 - rand(20); }
      else               { status = 'no_show';   daysOffset = -1 - rand(20); }
      const start = new Date();
      start.setDate(start.getDate() + daysOffset);
      start.setHours(10 + rand(8), [0, 15, 30, 45][rand(4)], 0, 0);
      const end = new Date(start.getTime() + (svc.duration_min || 60) * 60000);
      const completedAt = status === 'completed' ? new Date(end.getTime() + 5 * 60000) : null;
      const cancelledAt = status === 'cancelled' ? new Date(start.getTime() - 2 * 86400000) : null;
      const cancelledByRole = status === 'cancelled' ? pick(['customer', 'salon']) : null;
      const bRes = await q(
        `INSERT INTO bookings
           (customer_user_id, salon_id, service_id, start_at, end_at, price_nok, status,
            completed_at, cancelled_at, cancelled_by_role, customer_note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [cust, salonId, svc.id, start, end, svc.price_nok, status,
         completedAt, cancelledAt, cancelledByRole,
         Math.random() < 0.3 ? 'Test-merknad fra kunden' : null]
      );
      const bookingId = bRes.insertId || (bRes[0] && bRes[0].insertId);
      if (status === 'completed') {
        completedBookingIds.push(bookingId);
        bookingCustomerByBookingId[bookingId] = cust;
      }
    }
    const numReviews = Math.min(completedBookingIds.length, 2 + rand(4));
    const reviewable = pickN(completedBookingIds, numReviews);
    for (const bId of reviewable) {
      const rating = Math.random() < 0.7 ? (4 + rand(2)) : (1 + rand(3));
      const body = pick(REVIEW_BODIES);
      const ownerReply = Math.random() < 0.4 ? pick(REPLY_BODIES) : null;
      const ownerReplyAt = ownerReply ? new Date() : null;
      await q(
        `INSERT INTO reviews
           (booking_id, customer_user_id, salon_id, rating, body, owner_reply, owner_reply_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [bId, bookingCustomerByBookingId[bId], salonId, rating, body, ownerReply, ownerReplyAt]
      );
    }
    const numThreads = 2 + rand(2);
    const chatCustomers = pickN(customerIds, numThreads);
    for (const ccust of chatCustomers) {
      const tRes = await q(
        `INSERT IGNORE INTO chat_threads
           (customer_user_id, salon_id, last_message_at)
         VALUES (?, ?, NOW())`,
        [ccust, salonId]
      );
      let threadId = tRes.insertId || (tRes[0] && tRes[0].insertId);
      if (!threadId) {
        const ex = await q(
          'SELECT id FROM chat_threads WHERE customer_user_id = ? AND salon_id = ?',
          [ccust, salonId]
        );
        threadId = (Array.isArray(ex[0]) ? ex[0][0] : ex[0]).id;
      }
      const numMsgs = 4 + rand(7);
      const msgIds = [];
      for (let mi = 0; mi < numMsgs; mi++) {
        const isCustomer = mi % 2 === 0;
        const sender_user_id = isCustomer ? ccust : ownerId;
        const sender_role = isCustomer ? 'customer' : 'salon';
        const isImage = Math.random() < 0.15;
        const imageKey = isImage ? imageUrl(pick(UNSPLASH_PHOTOS), 800) : null;
        const body = isImage ? null : pick(isCustomer ? CHAT_LINES_CUSTOMER : CHAT_LINES_SALON);
        const sentAt = new Date(Date.now() - (numMsgs - mi) * 60000);
        const mRes = await q(
          `INSERT INTO chat_messages
             (thread_id, sender_user_id, sender_role, body, image_key, sent_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [threadId, sender_user_id, sender_role, body, imageKey, sentAt]
        );
        msgIds.push({
          id: mRes.insertId || (mRes[0] && mRes[0].insertId),
          sender_user_id,
        });
      }
      await q('UPDATE chat_threads SET last_message_at = NOW() WHERE id = ?', [threadId]);
      if (Math.random() < 0.08) {
        const salonMsg = msgIds.reverse().find(m => m.sender_user_id !== ccust);
        if (salonMsg) {
          await q(
            `INSERT INTO chat_message_reports
               (message_id, thread_id, reporter_user_id, reporter_role, reason)
             VALUES (?, ?, ?, 'customer', ?)`,
            [salonMsg.id, threadId, ccust, pick(REPORT_REASONS)]
          );
        }
      }
    }
  }

  // ---- Fase 1: backfill aktivitet for eksisterende test-salonger uten bookinger ----
  const existingRows = await q(
    `SELECT s.id FROM salons s
      WHERE s.slug LIKE 'test-%'
        AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.salon_id = s.id)`,
    []
  );
  const existingList = Array.isArray(existingRows[0]) && Array.isArray(existingRows[0][0])
    ? existingRows[0] : existingRows;
  for (const r of existingList) {
    if (!r || !r.id) continue;
    await seedActivityForSalon(r.id);
    backfilled++;
    if (onProgress && backfilled % 10 === 0) onProgress(backfilled, existingList.length);
  }

  for (let i = 1; i <= count; i++) {
    const baseName = pick(SALON_PREFIX) + ' ' + pick(SALON_SUFFIX);
    const name = baseName + ' ' + i;
    const slug = 'test-' + slugify(baseName) + '-' + i;
    const city = pick(CITIES);

    const existsRows = await q('SELECT id FROM salons WHERE slug = ?', [slug]);
    const exists = Array.isArray(existsRows[0]) ? existsRows[0][0] : existsRows[0];
    let salonId;
    if (exists) {
      salonId = exists.id;
      skipped++;
    } else {

    const bio = baseName + ' tilbyr et bredt utvalg behandlinger i hjertet av ' + city.name +
      '. Vi spesialiserer oss på vipper, negler og hud, og holder til i lyse, koselige lokaler.\n\n' +
      'Velkommen til en avslappet stund hos våre dyktige behandlere.';
    const address = pick(STREETS) + ' ' + (1 + rand(80)) + ', ' + city.postal + ' ' + city.name;
    const orgNumber = String(900000000 + Math.floor(Math.random() * 99999999));
    const numCats = 3 + rand(3);
    const numTeam = 2 + rand(5);
    const numImages = 4 + rand(3);
    const cats = pickN(CATEGORIES, numCats);
    const amenities = pickN(AMENITIES, 4 + rand(4));

    const sRes = await q(
      `INSERT INTO salons
         (owner_user_id, slug, name, bio, city, address_line, postal_code,
          public_phone_visible, accepts_new_bookings, org_number, status,
          public_email, public_phone, instagram_url, website_url,
          cancellation_lead_hours, booking_window_days, min_booking_lead_hours,
          booking_buffer_min, slot_interval_min)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, 'active', ?, ?, ?, ?, 24, 30, 0, 0, 15)`,
      [ownerId, slug, name, bio, city.name, address, city.postal, orgNumber,
       'kontakt@' + slugify(baseName) + '.no',
       '+47 9' + String(10000000 + rand(89999999)).slice(0, 7),
       'https://instagram.com/' + slugify(baseName),
       'https://' + slugify(baseName) + '.no']
    );
    salonId = sRes.insertId || (sRes[0] && sRes[0].insertId);

    const catIdByName = {};
    for (let p = 0; p < cats.length; p++) {
      const cRes = await q(
        `INSERT INTO service_categories (salon_id, name, position) VALUES (?, ?, ?)`,
        [salonId, cats[p], p]
      );
      catIdByName[cats[p]] = cRes.insertId || (cRes[0] && cRes[0].insertId);
    }

    const numServices = 5 + rand(11);
    for (let k = 0; k < numServices; k++) {
      const catName = pick(cats);
      const proto = pick(SERVICES_BY_CAT[catName]);
      await q(
        `INSERT INTO services
           (salon_id, category_id, name, duration_min, price_nok, active, is_popular,
            description, fiken_vat_code)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, 'HIGH')`,
        [salonId, catIdByName[catName], proto.name, proto.dur, proto.price,
         k < 3 ? 1 : 0,
         'Profesjonell ' + proto.name.toLowerCase() + ' utført av våre dyktige behandlere.']
      );
    }

    for (let t = 0; t < numTeam; t++) {
      const fn = pick(FIRST_NAMES);
      const ln = pick(LAST_NAMES);
      await q(
        `INSERT INTO team_members (salon_id, name, role, bio, active, position)
         VALUES (?, ?, ?, ?, 1, ?)`,
        [salonId, fn + ' ' + ln,
         pick(['Behandler', 'Stylist', 'Hudterapeut', 'Negleterapeut', 'Vippetekniker', 'Frisør']),
         fn + ' har ' + (3 + rand(15)) + ' års erfaring innen ' + pick(cats).toLowerCase() + '.',
         t]
      );
    }

    const hoursRows = [
      [1, 0, '09:00:00', '18:00:00'], [2, 0, '09:00:00', '18:00:00'],
      [3, 0, '09:00:00', '18:00:00'], [4, 0, '09:00:00', '19:00:00'],
      [5, 0, '09:00:00', '18:00:00'], [6, 0, '10:00:00', '16:00:00'],
      [7, 1, null, null],
    ];
    for (const h of hoursRows) {
      await q(
        `INSERT INTO salon_hours (salon_id, weekday, is_closed, open_at, close_at)
         VALUES (?, ?, ?, ?, ?)`,
        [salonId, h[0], h[1], h[2], h[3]]
      );
    }

    for (const a of amenities) {
      await q(`INSERT IGNORE INTO salon_amenities (salon_id, amenity) VALUES (?, ?)`,
        [salonId, a]);
    }

    const photos = pickN(UNSPLASH_PHOTOS, numImages);
    let firstKey = null;
    for (let pi = 0; pi < photos.length; pi++) {
      const url = imageUrl(photos[pi], 1200);
      await q(
        `INSERT INTO salon_images (salon_id, image_key, position) VALUES (?, ?, ?)`,
        [salonId, url, pi]
      );
      if (pi === 0) firstKey = url;
    }
    if (firstKey) {
      await q(`UPDATE salons SET cover_image_key = ? WHERE id = ?`, [firstKey, salonId]);
    }

    } // end of "salon didn't exist — create it" block

    // ----- Bookinger, anmeldelser og chat per salong -----
    // Sjekk om vi allerede har bookinger her — i så fall hopper vi over
    // aktivitet-seeding (idempotent). Eksisterende test-salonger uten
    // bookinger ble allerede backfilled i Fase 1 over.
    const bChk = await q('SELECT COUNT(*) AS n FROM bookings WHERE salon_id = ?', [salonId]);
    const bChkRow = Array.isArray(bChk[0]) ? bChk[0][0] : bChk[0];
    if (!(bChkRow && bChkRow.n > 0)) {
      await seedActivityForSalon(salonId);
    }
    /* OLD INLINE ACTIVITY BLOCK — erstattet av seedActivityForSalon() over */
    if (false) {
    // Hent service-IDene for denne salongen så vi kan koble bookinger til dem.
    const svcRows = await q(
      'SELECT id, duration_min, price_nok FROM services WHERE salon_id = ?',
      [salonId]
    );
    const services = Array.isArray(svcRows[0]) ? svcRows[0] : svcRows;
    if (services.length > 0) {
      // Bookinger: 8-15 stk, blandet status og tid.
      const numBookings = 8 + rand(8);
      const allStatuses = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];
      const completedBookingIds = [];
      const bookingCustomerByBookingId = {};
      for (let bi = 0; bi < numBookings; bi++) {
        const svc = pick(services);
        const cust = pick(customerIds);
        // Velg en status og en realistisk start_at
        let status;
        let daysOffset;
        const r = Math.random();
        if (r < 0.35)      { status = 'completed';  daysOffset = -1 - rand(30); }
        else if (r < 0.55) { status = 'confirmed';  daysOffset = 1 + rand(14); }
        else if (r < 0.75) { status = 'pending';    daysOffset = 1 + rand(14); }
        else if (r < 0.9)  { status = 'cancelled';  daysOffset = -5 - rand(20); }
        else               { status = 'no_show';    daysOffset = -1 - rand(20); }
        const start = new Date();
        start.setDate(start.getDate() + daysOffset);
        start.setHours(10 + rand(8), [0, 15, 30, 45][rand(4)], 0, 0);
        const end = new Date(start.getTime() + (svc.duration_min || 60) * 60000);
        const completedAt = status === 'completed' ? new Date(end.getTime() + 5 * 60000) : null;
        const cancelledAt = status === 'cancelled' ? new Date(start.getTime() - 2 * 86400000) : null;
        const cancelledByRole = status === 'cancelled' ? pick(['customer', 'salon']) : null;
        const bRes = await q(
          `INSERT INTO bookings
             (customer_user_id, salon_id, service_id, start_at, end_at, price_nok, status,
              completed_at, cancelled_at, cancelled_by_role, customer_note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [cust, salonId, svc.id, start, end, svc.price_nok, status,
           completedAt, cancelledAt, cancelledByRole,
           Math.random() < 0.3 ? 'Test-merknad fra kunden' : null]
        );
        const bookingId = bRes.insertId || (bRes[0] && bRes[0].insertId);
        if (status === 'completed') {
          completedBookingIds.push(bookingId);
          bookingCustomerByBookingId[bookingId] = cust;
        }
      }

      // Anmeldelser: en for hver av halvparten av fullførte bookinger.
      // (reviews-tabellen har UNIQUE(booking_id) så vi kan bare ha én per booking)
      const numReviews = Math.min(completedBookingIds.length, 2 + rand(4));
      const reviewable = pickN(completedBookingIds, numReviews);
      for (const bId of reviewable) {
        const rating = Math.random() < 0.7 ? (4 + rand(2))   // 70 % 4-5★
                                            : (1 + rand(3)); // 30 % 1-3★
        const body = pick(REVIEW_BODIES);
        const ownerReply = Math.random() < 0.4 ? pick(REPLY_BODIES) : null;
        const ownerReplyAt = ownerReply ? new Date() : null;
        await q(
          `INSERT INTO reviews
             (booking_id, customer_user_id, salon_id, rating, body, owner_reply, owner_reply_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [bId, bookingCustomerByBookingId[bId], salonId, rating, body, ownerReply, ownerReplyAt]
        );
      }

      // Chat-tråder: 2-3 per salong med ulike test-kunder.
      const numThreads = 2 + rand(2);
      const chatCustomers = pickN(customerIds, numThreads);
      for (const ccust of chatCustomers) {
        const tRes = await q(
          `INSERT IGNORE INTO chat_threads
             (customer_user_id, salon_id, last_message_at)
           VALUES (?, ?, NOW())`,
          [ccust, salonId]
        );
        let threadId = tRes.insertId || (tRes[0] && tRes[0].insertId);
        if (!threadId) {
          // Unique constraint kicked in — hent eksisterende
          const ex = await q(
            'SELECT id FROM chat_threads WHERE customer_user_id = ? AND salon_id = ?',
            [ccust, salonId]
          );
          threadId = (Array.isArray(ex[0]) ? ex[0][0] : ex[0]).id;
        }
        // 4-10 meldinger
        const numMsgs = 4 + rand(7);
        const msgIds = [];
        for (let mi = 0; mi < numMsgs; mi++) {
          const isCustomer = mi % 2 === 0;
          const sender_user_id = isCustomer ? ccust : ownerId;
          const sender_role = isCustomer ? 'customer' : 'salon';
          const body = pick(isCustomer ? CHAT_LINES_CUSTOMER : CHAT_LINES_SALON);
          const sentAt = new Date(Date.now() - (numMsgs - mi) * 60000); // 1 min apart
          // Med 15 % sjanse: bilde-melding (body=null, image_key satt)
          const isImage = Math.random() < 0.15;
          const imageKey = isImage ? imageUrl(pick(UNSPLASH_PHOTOS), 800) : null;
          const mRes = await q(
            `INSERT INTO chat_messages
               (thread_id, sender_user_id, sender_role, body, image_key, sent_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [threadId, sender_user_id, sender_role, isImage ? null : body, imageKey, sentAt]
          );
          msgIds.push({
            id: mRes.insertId || (mRes[0] && mRes[0].insertId),
            sender_user_id,
          });
        }
        await q('UPDATE chat_threads SET last_message_at = NOW() WHERE id = ?', [threadId]);

        // 8 % sjanse: rapporter siste salong-melding i tråden
        if (Math.random() < 0.08) {
          const salonMsg = msgIds.reverse().find(m => m.sender_user_id !== ccust);
          if (salonMsg) {
            await q(
              `INSERT INTO chat_message_reports
                 (message_id, thread_id, reporter_user_id, reporter_role, reason)
               VALUES (?, ?, ?, 'customer', ?)`,
              [salonMsg.id, threadId, ccust, pick(REPORT_REASONS)]
            );
          }
        }
      }
    }
    } // end "salon needs activity-seeding" block

    if (!exists) created++;
    if (onProgress && created % 10 === 0) onProgress(created, count);
  }

  return { created, skipped, backfilled, total: count };
}

module.exports = { seedTestSalons };
