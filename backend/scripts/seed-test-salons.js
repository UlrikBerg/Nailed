// Seed 100 test-salonger med kategorier, tjenester, team, åpningstider,
// amenities og bilder (Unsplash-URL-er).
//
// Bruk:
//   node backend/scripts/seed-test-salons.js
//
// Idempotent: hopper over salonger som allerede har slug starter med
// «test-».
// Eier: opprettes et test-user (test+seed@nailed.no) om det ikke finnes.

require('dotenv').config();
const config = require('../config');
const mysql = require('mysql2/promise');

const NUM_SALONS = 100;

// ----- Statiske pooler ------------------------------------------------------
const SALON_PREFIX = ['Aurora', 'Velvære', 'Bloom', 'Eleganse', 'Velour', 'Lumen',
  'Atelier', 'Nova', 'Lyra', 'Onde', 'Pure', 'Studio', 'Klinikk', 'Sjelero',
  'Sol', 'Skinn', 'Glo', 'Edel', 'Lilje', 'Brun'];
const SALON_SUFFIX = ['Studio', 'Salong', 'Klinikk', 'Spa', 'Atelier', 'Beauty',
  'House', 'Lab', 'Hjørnet', 'Rom'];

const CITIES = [
  { name: 'Oslo',         postal: '0150' },
  { name: 'Bergen',       postal: '5003' },
  { name: 'Trondheim',    postal: '7010' },
  { name: 'Stavanger',    postal: '4005' },
  { name: 'Drammen',      postal: '3015' },
  { name: 'Tromsø',       postal: '9008' },
  { name: 'Kristiansand', postal: '4612' },
  { name: 'Fredrikstad',  postal: '1604' },
  { name: 'Sandnes',      postal: '4306' },
  { name: 'Bodø',         postal: '8005' },
  { name: 'Ålesund',      postal: '6002' },
  { name: 'Halden',       postal: '1767' },
  { name: 'Hamar',        postal: '2317' },
  { name: 'Lillestrøm',   postal: '2000' },
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
    { name: 'Klassiske vipper', dur: 90,  price: 750 },
    { name: 'Volumvipper',      dur: 120, price: 950 },
    { name: 'Påfyll',           dur: 60,  price: 550 },
    { name: 'Fjerning av vipper', dur: 30, price: 300 },
    { name: 'Vippeløft',        dur: 45,  price: 600 },
  ],
  Negler:  [
    { name: 'Manikyr',          dur: 45,  price: 450 },
    { name: 'Pedikyr',          dur: 60,  price: 600 },
    { name: 'Gel-negler',       dur: 90,  price: 750 },
    { name: 'Akrylforlengelse', dur: 120, price: 950 },
    { name: 'Negldesign',       dur: 30,  price: 250 },
  ],
  Bryn:    [
    { name: 'Brynforming',      dur: 30,  price: 350 },
    { name: 'Henna-bryn',       dur: 45,  price: 500 },
    { name: 'Brow lamination',  dur: 60,  price: 800 },
    { name: 'Brynfarging',      dur: 30,  price: 350 },
  ],
  Hud:     [
    { name: 'Ansiktsbehandling', dur: 60, price: 950 },
    { name: 'Microdermabrasion', dur: 45, price: 850 },
    { name: 'Kjemisk peeling',   dur: 60, price: 1200 },
    { name: 'Aknekur',           dur: 75, price: 1100 },
  ],
  Hår:     [
    { name: 'Dameklipp',        dur: 60,  price: 750 },
    { name: 'Herreklipp',       dur: 30,  price: 450 },
    { name: 'Helfarging',       dur: 120, price: 1500 },
    { name: 'Striper',          dur: 150, price: 1800 },
    { name: 'Föning',           dur: 30,  price: 350 },
  ],
  Makeup:  [
    { name: 'Brudemakeup',      dur: 90,  price: 1800 },
    { name: 'Festmakeup',       dur: 60,  price: 950 },
    { name: 'Makeup-kurs',      dur: 90,  price: 1400 },
    { name: 'Makeup-konsultasjon', dur: 45, price: 650 },
  ],
  Voksing: [
    { name: 'Voksing av bryn',  dur: 15,  price: 250 },
    { name: 'Voksing av legger', dur: 30, price: 450 },
    { name: 'Voksing bikinilinje', dur: 30, price: 500 },
    { name: 'Brazilian-voks',   dur: 45,  price: 700 },
  ],
  Spa:     [
    { name: 'Massasje (klassisk)', dur: 60, price: 950 },
    { name: 'Hot stone',           dur: 75, price: 1200 },
    { name: 'Avspenningspakke',    dur: 90, price: 1500 },
  ],
};

// Curated Unsplash photos — makeup, beauty studio, hair, nails, skincare.
// Vi varierer ?w-parameter for å gi litt ulik vekt og tar &auto=format for å
// la Unsplash levere webp der mulig.
const UNSPLASH_PHOTOS = [
  '1522335789203-aaa83c7b0d23', // makeup brushes
  '1487412947147-5cebf100ffc2', // makeup palette
  '1599386530000-b8a3a82e6c0b', // makeup tools
  '1560066984-138dadb4c035',    // nail salon
  '1604654894611-6973b376cbde', // lash
  '1571781926291-c477ebfd024b', // makeup model
  '1502823403499-6ccfcf4fb453', // salong-interior
  '1521735032199-90d3a0099f55', // beauty
  '1457972729786-0411a3b2b626', // cosmetics
  '1573461160327-b450ce3d8e7f', // styling
  '1583241800698-9c2e09a8c8d3', // hairstyle
  '1503951914875-452162b0f3f1', // brun nails
  '1559599101-f09722fb4948',    // makeup brushes
  '1556228720-195a672e8a03',    // wax
  '1607008829749-c0f284a49841', // brows
  '1576091160550-2173dba999ef', // skincare
  '1612967853503-26f29e7cc92e', // makeup-faglig
  '1594825975023-d4c4ec76e927', // styled salon
  '1503236-1d8ef9c0a08a',       // makeup
  '1583241475880-083f84372725', // nail studio
];

const AMENITIES = ['wifi', 'parking', 'kortbetaling', 'vippsbetaling',
  'rullestolvennlig', 'barnevennlig', 'kjønnsnøytral', 'gavekort'];

// ----- Helpers --------------------------------------------------------------
function rand(n)   { return Math.floor(Math.random() * n); }
function pick(arr) { return arr[rand(arr.length)]; }
function pickN(arr, n) {
  const copy = arr.slice();
  const out = [];
  while (out.length < n && copy.length) {
    out.push(copy.splice(rand(copy.length), 1)[0]);
  }
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

// ----- Main -----------------------------------------------------------------
async function main() {
  const connOpts = {
    user: config.db.user, password: config.db.password,
    database: config.db.database, multipleStatements: true,
  };
  if (config.db.socket) connOpts.socketPath = config.db.socket;
  else { connOpts.host = config.db.host; connOpts.port = config.db.port; }
  const db = await mysql.createConnection(connOpts);

  // Test-eier-bruker
  const ownerEmail = 'test+seed@nailed.no';
  let [[ownerRow]] = await db.query('SELECT id FROM users WHERE email = ? LIMIT 1', [ownerEmail]);
  if (!ownerRow) {
    const [r] = await db.query(
      `INSERT INTO users (email, name, role) VALUES (?, ?, 'salon_owner')`,
      [ownerEmail, 'Test Seed']
    );
    ownerRow = { id: r.insertId };
    console.log('Opprettet test-eier:', ownerEmail);
  }
  const ownerId = ownerRow.id;

  let created = 0, skipped = 0;
  for (let i = 1; i <= NUM_SALONS; i++) {
    const baseName = pick(SALON_PREFIX) + ' ' + pick(SALON_SUFFIX);
    const name = baseName + ' ' + i;
    const slug = 'test-' + slugify(baseName) + '-' + i;
    const city = pick(CITIES);

    const [[exists]] = await db.query('SELECT id FROM salons WHERE slug = ?', [slug]);
    if (exists) { skipped++; continue; }

    const bio = baseName + ' tilbyr et bredt utvalg behandlinger i hjertet av ' + city.name +
      '. Vi spesialiserer oss på vipper, negler og hud, og holder til i lyse, koselige lokaler.\n\n' +
      'Velkommen til en avslappet stund hos våre dyktige behandlere.';
    const address = pick(STREETS) + ' ' + (1 + rand(80)) + ', ' + city.postal + ' ' + city.name;
    const orgNumber = String(900000000 + Math.floor(Math.random() * 99999999));

    // Velg 3-5 kategorier + en pool av tjenester
    const numCats     = 3 + rand(3);
    const numTeam     = 2 + rand(5);
    const numImages   = 4 + rand(3);
    const cats        = pickN(CATEGORIES, numCats);
    const amenities   = pickN(AMENITIES, 4 + rand(4));

    // Salong-rad
    const [sRes] = await db.query(
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
    const salonId = sRes.insertId;

    // Kategorier
    const catIdByName = {};
    for (let p = 0; p < cats.length; p++) {
      const [cRes] = await db.query(
        `INSERT INTO service_categories (salon_id, name, position) VALUES (?, ?, ?)`,
        [salonId, cats[p], p]
      );
      catIdByName[cats[p]] = cRes.insertId;
    }

    // Tjenester (5-15 totalt på tvers av valgte kategorier)
    const numServices = 5 + rand(11);
    for (let k = 0; k < numServices; k++) {
      const catName = pick(cats);
      const proto = pick(SERVICES_BY_CAT[catName]);
      await db.query(
        `INSERT INTO services
           (salon_id, category_id, name, duration_min, price_nok, active, is_popular,
            description, fiken_vat_code)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, 'HIGH')`,
        [salonId, catIdByName[catName], proto.name, proto.dur, proto.price,
         k < 3 ? 1 : 0,
         'Profesjonell ' + proto.name.toLowerCase() + ' utført av våre dyktige behandlere.']
      );
    }

    // Team-medlemmer
    for (let t = 0; t < numTeam; t++) {
      const fn = pick(FIRST_NAMES);
      const ln = pick(LAST_NAMES);
      await db.query(
        `INSERT INTO team_members
           (salon_id, name, role, bio, active, position)
         VALUES (?, ?, ?, ?, 1, ?)`,
        [salonId, fn + ' ' + ln,
         pick(['Behandler', 'Stylist', 'Hudterapeut', 'Negleterapeut', 'Vippetekniker', 'Frisør']),
         fn + ' har ' + (3 + rand(15)) + ' års erfaring innen ' + pick(cats).toLowerCase() + '.',
         t]
      );
    }

    // Åpningstider (man-fre 09-18, lør 10-16, søn stengt)
    const hoursRows = [
      [1, 0, '09:00:00', '18:00:00'],
      [2, 0, '09:00:00', '18:00:00'],
      [3, 0, '09:00:00', '18:00:00'],
      [4, 0, '09:00:00', '19:00:00'],
      [5, 0, '09:00:00', '18:00:00'],
      [6, 0, '10:00:00', '16:00:00'],
      [7, 1, null, null],
    ];
    for (const h of hoursRows) {
      await db.query(
        `INSERT INTO salon_hours (salon_id, weekday, is_closed, open_at, close_at)
         VALUES (?, ?, ?, ?, ?)`,
        [salonId, h[0], h[1], h[2], h[3]]
      );
    }

    // Amenities (kolonne heter `amenity`, ikke `code`)
    for (const a of amenities) {
      await db.query(
        `INSERT IGNORE INTO salon_amenities (salon_id, amenity) VALUES (?, ?)`,
        [salonId, a]
      );
    }

    // Bilder — Unsplash URLs lagres som image_key (storage.publicUrl
    // pass-through-er http(s)-prefiksede keys).
    const photos = pickN(UNSPLASH_PHOTOS, numImages);
    let firstKey = null;
    for (let pi = 0; pi < photos.length; pi++) {
      const url = imageUrl(photos[pi], 1200);
      await db.query(
        `INSERT INTO salon_images (salon_id, image_key, position) VALUES (?, ?, ?)`,
        [salonId, url, pi]
      );
      if (pi === 0) firstKey = url;
    }
    if (firstKey) {
      await db.query(`UPDATE salons SET cover_image_key = ? WHERE id = ?`, [firstKey, salonId]);
    }

    created++;
    if (created % 10 === 0) console.log('Opprettet', created, '/', NUM_SALONS);
  }

  console.log('Ferdig:', created, 'opprettet,', skipped, 'hoppet over (slug fantes).');
  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
