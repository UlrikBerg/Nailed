// Seed-aktivitet for én eksisterende salong (booking-eksempler, anmeldelser
// og chat-meldinger). Brukes for pilot-salonger som trenger fyll til
// screenshot/marketing. Forventer at salongen finnes og har minst én tjeneste.
//
// Aktivitet som lages:
//   - Demo-kunder: 4 stk (Maja Lien, Lisa Berg, Sofia Aas, Emma Holm) — innsatt
//     bare hvis de ikke finnes fra før.
//   - Bookinger: 10 stk fordelt over ±3 uker. Statusmiks som ser realistisk ut:
//     4 completed (bak i tid), 3 confirmed (fram i tid), 2 pending, 1 cancelled.
//   - Anmeldelser: én per fullført booking, alle 4–5 stjerner, halvparten har
//     eiers svar.
//   - Chat: 2 tråder med 6–8 meldinger hver, blanding kunde/salong.
//
// Idempotent: kjøres flere ganger uten å duplisere kunder, men hver kjøring
// legger til en ny runde med bookinger/anmeldelser/chat. Caller bør sjekke
// at salongen ikke allerede har for mye aktivitet hvis det er et problem.

const { query, queryOne } = require('../db');

const DEMO_CUSTOMERS = [
  { name: 'Maja Lien',   email: 'demo.maja@nailed.no' },
  { name: 'Lisa Berg',   email: 'demo.lisa@nailed.no' },
  { name: 'Sofia Aas',   email: 'demo.sofia@nailed.no' },
  { name: 'Emma Holm',   email: 'demo.emma@nailed.no' },
];

const POSITIVE_REVIEWS = [
  { rating: 5, body: 'Helt fantastisk! Katrine er så dyktig og rolig — gleder meg allerede til neste gang.' },
  { rating: 5, body: 'Beste behandlingen jeg har fått på lenge. Vippene ble akkurat som jeg ville ha dem.' },
  { rating: 5, body: 'Følte meg så godt ivaretatt fra første minutt. Anbefaler på det sterkeste!' },
  { rating: 4, body: 'Veldig fornøyd med resultatet. Koselig lokale og hyggelig stemning.' },
  { rating: 5, body: 'Profesjonelt og hyggelig. Lytter til hva man vil ha og leverer alltid.' },
  { rating: 4, body: 'Fin opplevelse — Katrine er flink til å forklare hva hun gjør underveis.' },
];

const POSITIVE_REPLIES = [
  'Tusen takk! 💕 Gleder meg til å se deg igjen.',
  'Så hyggelig å høre! Takk for at du tok deg tid til å skrive.',
  null,
  'Tusen takk! Det er alltid kjekt å se deg her.',
  null,
];

const CHAT_THREAD_1 = [
  { who: 'customer', body: 'Hei Katrine! Lurte på om jeg kan endre timen min på torsdag til litt senere på dagen?' },
  { who: 'salon',    body: 'Hei! Ja det går fint. Jeg har ledig kl. 15:30 eller 16:45 — hva passer best?' },
  { who: 'customer', body: 'Tar 16:45 da! Tusen takk 🥰' },
  { who: 'salon',    body: 'Flott, jeg har flyttet bookingen. Vi sees torsdag!' },
  { who: 'customer', body: 'Forresten — kan jeg ha med klassisk eller skal jeg gå for volum denne gang?' },
  { who: 'salon',    body: 'Med dine egne vipper vil jeg anbefale lett volum — det gir fyldigere uttrykk uten å bli for tungt. Vi prater mer torsdag!' },
];

// Standard-tjenester som lages hvis salongen ikke har egne. Realistisk
// utvalg for en negl/bryn/vippe-behandler — bytter dette ut for andre
// behandler-typer hvis nødvendig.
const DEFAULT_SERVICES = [
  { name: 'Klassisk vippeløft', duration_min: 60, price_nok: 750, popular: 1 },
  { name: 'Volum vippeextensions', duration_min: 120, price_nok: 1450, popular: 1 },
  { name: 'Påfyll vipper (innen 3 uker)', duration_min: 60, price_nok: 650, popular: 0 },
  { name: 'Brynforming + farge', duration_min: 45, price_nok: 550, popular: 1 },
  { name: 'Brynsbleking', duration_min: 30, price_nok: 350, popular: 0 },
  { name: 'Overleppe-voks', duration_min: 15, price_nok: 200, popular: 0 },
];

const CHAT_THREAD_2 = [
  { who: 'customer', body: 'Hei! Tar du imot nye kunder, eller er det venteliste?' },
  { who: 'salon',    body: 'Hei og velkommen! Jeg har ledig fra neste uke. Hva slags behandling tenker du på?' },
  { who: 'customer', body: 'Brynforming og litt voksing. En venninne anbefalte deg!' },
  { who: 'salon',    body: 'Så hyggelig 💖 Brynforming + voksing tar ca. 45 min. Skal jeg booke deg inn tirsdag kl. 13?' },
  { who: 'customer', body: 'Perfekt, det passer fint!' },
  { who: 'salon',    body: 'Da har jeg satt deg opp. Hvis du vil sende meg et bilde av brynene før du kommer, kan jeg planlegge formen ferdig 🤍' },
  { who: 'customer', body: 'Skal gjøre det i kveld. Tusen takk!' },
];

async function ensureDemoCustomers() {
  const ids = [];
  for (const c of DEMO_CUSTOMERS) {
    const existing = await queryOne(`SELECT id FROM users WHERE email = ? LIMIT 1`, [c.email]);
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const r = await query(
      `INSERT INTO users (email, name, role) VALUES (?, ?, 'user')`,
      [c.email, c.name]
    );
    ids.push(r.insertId);
  }
  return ids;
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Defaults for å fylle ut salongprofilen så den er screenshot-klar. Lar
// eksisterende felter være i fred — overskriver bare når noe mangler.
const PROFILE_DEFAULTS = {
  address_line: 'Storgata 12',
  postal_code: '1771',
  city: 'Halden',
  public_phone: '+47 90 12 34 56',
  public_email: 'hei@katrinehanstedt.no',
  bio: 'Hei! Jeg heter Katrine og driver mitt eget lille studio i sentrum av Halden. '
     + 'Spesialiteten min er klassiske og volum-vippeextensions, men jeg gjør også brynforming, '
     + 'farging og voksing. Jeg jobber rolig og lavmælt — du skal kunne slappe helt av i stolen min. '
     + 'Bestilling skjer enklest her i appen. Velkommen inn! 🤍',
  booking_confirmation_text: 'Inngang fra bakgården. Vennligst ikke kom for tidlig — jeg er ofte midt i en behandling. Vil du parkere, er det gratis i sidegata.',
  cancellation_lead_hours: 24,
};

const DEFAULT_HOURS = [
  { weekday: 1, is_closed: 0, open_at: '09:00', close_at: '17:00' },
  { weekday: 2, is_closed: 0, open_at: '09:00', close_at: '19:00' },
  { weekday: 3, is_closed: 0, open_at: '09:00', close_at: '19:00' },
  { weekday: 4, is_closed: 0, open_at: '09:00', close_at: '17:00' },
  { weekday: 5, is_closed: 0, open_at: '09:00', close_at: '15:00' },
  { weekday: 6, is_closed: 0, open_at: '10:00', close_at: '14:00' },
  { weekday: 7, is_closed: 1, open_at: null,    close_at: null    },
];

const DEFAULT_AMENITIES = [
  'wifi', 'coffee', 'water', 'parking',
  'card_payment', 'vipps_payment',
  'late_hours', 'weekend_hours',
  'free_cancellation_24h', 'vegan_products',
];

async function fillEmptyProfileFields(salon) {
  const sets = [];
  const vals = [];
  for (const k of Object.keys(PROFILE_DEFAULTS)) {
    if (salon[k] == null || salon[k] === '') {
      sets.push(k + ' = ?');
      vals.push(PROFILE_DEFAULTS[k]);
    }
  }
  if (!sets.length) return 0;
  vals.push(salon.id);
  await query(`UPDATE salons SET ${sets.join(', ')} WHERE id = ?`, vals);
  return sets.length;
}

async function ensureHours(salonId) {
  const existing = await query(`SELECT weekday FROM salon_hours WHERE salon_id = ?`, [salonId]);
  if (existing.length >= 7) return 0;
  // Slett evt. ufullstendige og insert hele uka
  await query(`DELETE FROM salon_hours WHERE salon_id = ?`, [salonId]);
  for (const h of DEFAULT_HOURS) {
    await query(
      `INSERT INTO salon_hours (salon_id, weekday, is_closed, open_at, close_at)
       VALUES (?, ?, ?, ?, ?)`,
      [salonId, h.weekday, h.is_closed, h.open_at, h.close_at]
    );
  }
  return DEFAULT_HOURS.length;
}

async function ensureAmenities(salonId) {
  const existing = await query(`SELECT amenity FROM salon_amenities WHERE salon_id = ?`, [salonId]);
  if (existing.length >= 5) return 0;
  let added = 0;
  for (const code of DEFAULT_AMENITIES) {
    await query(
      `INSERT IGNORE INTO salon_amenities (salon_id, amenity) VALUES (?, ?)`,
      [salonId, code]
    );
    added++;
  }
  return added;
}

async function ensureKatrineTeamMember(salonId, ownerName) {
  const existing = await queryOne(
    `SELECT id FROM team_members WHERE salon_id = ? AND active = 1 LIMIT 1`,
    [salonId]
  );
  if (existing) return 0;
  const displayName = ownerName || 'Katrine';
  await query(
    `INSERT INTO team_members (salon_id, name, role, bio, active, position)
     VALUES (?, ?, ?, ?, 1, 0)`,
    [
      salonId,
      displayName,
      'Daglig leder & behandler',
      'Sertifisert vippetekniker med over 7 års erfaring. Spesialiteten min er klassiske og volum-vipper, men jeg er like glad i å forme bryn som å lakke negler.',
    ]
  );
  return 1;
}

async function seedSalonActivity(slug) {
  const salon = await queryOne(
    `SELECT id, owner_user_id, name, address_line, postal_code, city, public_phone,
            public_email, bio, booking_confirmation_text, cancellation_lead_hours,
            public_phone_visible
       FROM salons WHERE slug = ? LIMIT 1`,
    [slug]
  );
  if (!salon) return { ok: false, error: 'salon_not_found' };

  // Hvis telefon legges inn, vis den også offentlig
  if (salon.public_phone == null && !salon.public_phone_visible) {
    await query(`UPDATE salons SET public_phone_visible = 1 WHERE id = ?`, [salon.id]);
  }

  const owner = await queryOne(`SELECT name FROM users WHERE id = ? LIMIT 1`, [salon.owner_user_id]);
  const ownerName = owner ? owner.name : null;

  const profileFieldsFilled = await fillEmptyProfileFields(salon);
  const hoursAdded = await ensureHours(salon.id);
  const amenitiesAdded = await ensureAmenities(salon.id);
  const teamAdded = await ensureKatrineTeamMember(salon.id, ownerName);

  let services = await query(
    `SELECT id, duration_min, price_nok FROM services WHERE salon_id = ?`,
    [salon.id]
  );
  let servicesCreated = 0;
  if (!services.length) {
    for (const svc of DEFAULT_SERVICES) {
      await query(
        `INSERT INTO services
           (salon_id, name, duration_min, price_nok, active, is_popular, description)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
        [salon.id, svc.name, svc.duration_min, svc.price_nok, svc.popular,
         'Profesjonell ' + svc.name.toLowerCase() + ' i rolige omgivelser.']
      );
      servicesCreated++;
    }
    services = await query(
      `SELECT id, duration_min, price_nok FROM services WHERE salon_id = ?`,
      [salon.id]
    );
  }

  const customerIds = await ensureDemoCustomers();

  // ----- BOOKINGER -----
  const completedBookingIds = [];
  const bookingCustomerByBookingId = {};
  const statusPlan = [
    { status: 'completed', daysOffset: -2 }, { status: 'completed', daysOffset: -5 },
    { status: 'completed', daysOffset: -9 }, { status: 'completed', daysOffset: -14 },
    { status: 'confirmed', daysOffset: 1 },  { status: 'confirmed', daysOffset: 3 },
    { status: 'confirmed', daysOffset: 8 },
    { status: 'pending',   daysOffset: 5 },  { status: 'pending',   daysOffset: 11 },
    { status: 'cancelled', daysOffset: -7 },
  ];

  for (const plan of statusPlan) {
    const svc = pick(services);
    const cust = pick(customerIds);
    const start = new Date();
    start.setDate(start.getDate() + plan.daysOffset);
    start.setHours(10 + Math.floor(Math.random() * 8), [0, 15, 30, 45][Math.floor(Math.random() * 4)], 0, 0);
    const end = new Date(start.getTime() + (svc.duration_min || 60) * 60000);
    const completedAt = plan.status === 'completed' ? new Date(end.getTime() + 5 * 60000) : null;
    const cancelledAt = plan.status === 'cancelled' ? new Date(start.getTime() - 2 * 86400000) : null;
    const cancelledByRole = plan.status === 'cancelled' ? 'customer' : null;
    const r = await query(
      `INSERT INTO bookings
         (customer_user_id, salon_id, service_id, start_at, end_at, price_nok, status,
          completed_at, cancelled_at, cancelled_by_role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [cust, salon.id, svc.id, start, end, svc.price_nok, plan.status,
       completedAt, cancelledAt, cancelledByRole]
    );
    const bookingId = r.insertId;
    if (plan.status === 'completed') {
      completedBookingIds.push(bookingId);
      bookingCustomerByBookingId[bookingId] = cust;
    }
  }

  // ----- ANMELDELSER (én per fullført booking) -----
  for (let i = 0; i < completedBookingIds.length; i++) {
    const bId = completedBookingIds[i];
    const review = POSITIVE_REVIEWS[i % POSITIVE_REVIEWS.length];
    const reply = POSITIVE_REPLIES[i % POSITIVE_REPLIES.length];
    const ownerReplyAt = reply ? new Date() : null;
    await query(
      `INSERT INTO reviews
         (booking_id, customer_user_id, salon_id, rating, body, owner_reply, owner_reply_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [bId, bookingCustomerByBookingId[bId], salon.id, review.rating, review.body, reply, ownerReplyAt]
    );
  }

  // ----- CHAT-TRÅDER -----
  const chatThreads = [
    { customerIdx: 0, messages: CHAT_THREAD_1 },
    { customerIdx: 1, messages: CHAT_THREAD_2 },
  ];

  for (const t of chatThreads) {
    const cust = customerIds[t.customerIdx % customerIds.length];
    const tRes = await query(
      `INSERT IGNORE INTO chat_threads (customer_user_id, salon_id, last_message_at)
       VALUES (?, ?, NOW())`,
      [cust, salon.id]
    );
    let threadId = tRes.insertId;
    if (!threadId) {
      const ex = await queryOne(
        `SELECT id FROM chat_threads WHERE customer_user_id = ? AND salon_id = ?`,
        [cust, salon.id]
      );
      if (!ex) continue;
      threadId = ex.id;
    }
    const baseTime = Date.now() - t.messages.length * 7 * 60000;
    for (let mi = 0; mi < t.messages.length; mi++) {
      const m = t.messages[mi];
      const sender_user_id = m.who === 'customer' ? cust : salon.owner_user_id;
      const sentAt = new Date(baseTime + mi * 7 * 60000);
      await query(
        `INSERT INTO chat_messages
           (thread_id, sender_user_id, sender_role, body, sent_at)
         VALUES (?, ?, ?, ?, ?)`,
        [threadId, sender_user_id, m.who, m.body, sentAt]
      );
    }
    await query(`UPDATE chat_threads SET last_message_at = NOW() WHERE id = ?`, [threadId]);
  }

  return {
    ok: true,
    salon: salon.name,
    profile_fields_filled: profileFieldsFilled,
    hours_added: hoursAdded,
    amenities_added: amenitiesAdded,
    team_added: teamAdded,
    services_created: servicesCreated,
    bookings: statusPlan.length,
    reviews: completedBookingIds.length,
    chat_threads: chatThreads.length,
  };
}

module.exports = { seedSalonActivity };
