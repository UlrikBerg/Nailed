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

async function seedSalonActivity(slug) {
  const salon = await queryOne(
    `SELECT id, owner_user_id, name FROM salons WHERE slug = ? LIMIT 1`,
    [slug]
  );
  if (!salon) return { ok: false, error: 'salon_not_found' };

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
    services_created: servicesCreated,
    bookings: statusPlan.length,
    reviews: completedBookingIds.length,
    chat_threads: chatThreads.length,
  };
}

module.exports = { seedSalonActivity };
