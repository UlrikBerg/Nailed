const express = require('express');
const { z } = require('zod');
const { pool, query, queryOne, tx } = require('../db');
const { requireRole } = require('../middleware/auth');
const { asyncRoute, HttpError, slugify, randomBase64Url } = require('../lib/util');
const geocode = require('../lib/geocode');
const T = require('../lib/notify/templates');
const { sendEmail } = require('../lib/notify/email');

const router = express.Router();

// All admin routes require role=admin.
router.use(requireRole('admin'));

// POST /admin/email-samples — sender en eksempel-render av hver mal til
// gitt mottaker. Body: { to: "mail@..." }. Brukes til design-review.
router.post('/email-samples', asyncRoute(async (req, res) => {
  const schema = z.object({ to: z.string().email() });
  const { to } = schema.parse(req.body || {});

  const startAt = new Date(Date.now() + 26 * 60 * 60 * 1000);
  const endAt = new Date(startAt.getTime() + 45 * 60 * 1000);
  const salon = {
    id: 1, slug: '7-sma-rom', name: '7 Små Rom',
    address_line: 'Storgata 12', postal_code: '1771', city: 'Halden',
    public_phone: '+47 90 12 34 56', cancellation_lead_hours: 24,
    booking_confirmation_text: 'Inngang fra bakgården. Vi har stoppeklokke på alle behandlinger.',
  };
  const baseCtx = {
    bookingId: 12345, salon, salonName: salon.name,
    serviceName: 'Klassisk vippeløft', durationMin: 45, priceNok: 750,
    startAt, endAt,
    customerName: 'Ulrik Theodor', customerDisplayName: 'Ulrik T.',
    customerEmail: to, customerPhone: '+47 99 88 77 66',
    teamMemberName: 'Katrine', isGuest: false, isSeries: false,
    cancelReason: 'Stylist syk',
  };
  const samples = [
    ['bookingCreatedCustomer',   'Kundebekreftelse'],
    ['bookingCreatedOwner',      'Salongeier: ny booking'],
    ['bookingCreatedTeam',       'Teammedlem: ny booking'],
    ['bookingConfirmedCustomer', 'Kunde: bekreftet'],
    ['bookingCancelledCustomer', 'Kunde: avlyst av salong'],
    ['bookingCancelledOwner',    'Salongeier: kunde avbestilte'],
    ['bookingCancelledTeam',     'Teammedlem: kunde avbestilte'],
    ['bookingReminderCustomer',  'Kunde: påminnelse'],
  ];

  const results = [];
  for (const [fn, label] of samples) {
    try {
      const tpl = T[fn](baseCtx);
      const r = await sendEmail({
        to,
        subject: '[Eksempel: ' + label + '] ' + tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
      results.push({ fn, ok: r.ok, id: r.id || null, error: r.error || null });
    } catch (e) {
      results.push({ fn, ok: false, error: e.message });
    }
  }
  res.json({ to, results });
}));

// ----------------------------------------------------------------------------
// Dashboard counts
// ----------------------------------------------------------------------------

router.get('/dashboard', asyncRoute(async (_req, res) => {
  const [users, salons, pendingApps, openBookings, todaysBookings] = await Promise.all([
    queryOne(`SELECT COUNT(*) AS n FROM users WHERE suspended_at IS NULL`),
    queryOne(`SELECT COUNT(*) AS n FROM salons WHERE status = 'active'`),
    queryOne(`SELECT COUNT(*) AS n FROM salon_applications WHERE status = 'pending'`),
    queryOne(`SELECT COUNT(*) AS n FROM bookings WHERE status IN ('pending','confirmed')`),
    queryOne(`SELECT COUNT(*) AS n FROM bookings WHERE DATE(start_at) = CURDATE()`),
  ]);
  res.json({
    users: users.n,
    salons: salons.n,
    pending_applications: pendingApps.n,
    open_bookings: openBookings.n,
    todays_bookings: todaysBookings.n,
  });
}));

// ----------------------------------------------------------------------------
// Users
// ----------------------------------------------------------------------------

router.get('/users', asyncRoute(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;
  const search = (req.query.search || '').toString().trim();

  const where = ['1 = 1'];
  const params = [];
  if (search) {
    where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  const rows = await query(
    `SELECT id, email, name, phone, role, suspended_at, created_at,
            (SELECT COUNT(*) FROM bookings b WHERE b.customer_user_id = users.id) AS booking_count
       FROM users
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ users: rows, limit, offset });
}));

router.post('/users/:id/suspend', asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  await query(`UPDATE users SET suspended_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
  await query(`UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL`, [id]);
  await audit(req.user.id, 'user.suspend', 'user', id);
  res.json({ ok: true });
}));

router.post('/users/:id/unsuspend', asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  await query(`UPDATE users SET suspended_at = NULL WHERE id = ?`, [id]);
  await audit(req.user.id, 'user.unsuspend', 'user', id);
  res.json({ ok: true });
}));

// ----------------------------------------------------------------------------
// Salons
// ----------------------------------------------------------------------------

router.get('/salons', asyncRoute(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;
  const rows = await query(
    `SELECT s.id, s.slug, s.name, s.city, s.status, s.created_at,
            u.email AS owner_email, u.name AS owner_name
       FROM salons s JOIN users u ON u.id = s.owner_user_id
      ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  res.json({ salons: rows, limit, offset });
}));

router.post('/salons/:id/suspend', asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  await query(`UPDATE salons SET status = 'suspended' WHERE id = ?`, [id]);
  await audit(req.user.id, 'salon.suspend', 'salon', id);
  res.json({ ok: true });
}));

router.post('/salons/:id/activate', asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  await query(`UPDATE salons SET status = 'active' WHERE id = ?`, [id]);
  await audit(req.user.id, 'salon.activate', 'salon', id);
  res.json({ ok: true });
}));

// Soft-delete a salon. We never hard-delete because bookings/services have
// RESTRICT FKs into salons; flipping status='deleted' hides it from public
// pages while preserving history.
router.delete('/salons/:id', asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  await query(`UPDATE salons SET status = 'deleted' WHERE id = ?`, [id]);
  await audit(req.user.id, 'salon.delete', 'salon', id);
  res.json({ ok: true });
}));

// ----------------------------------------------------------------------------
// Salon applications
// ----------------------------------------------------------------------------

router.get('/salon-applications', asyncRoute(async (req, res) => {
  const status = (req.query.status || 'pending').toString();
  const allowed = ['pending', 'approved', 'rejected', 'withdrawn', 'all'];
  if (!allowed.includes(status)) throw new HttpError(400, 'bad_status', 'Ugyldig status.');

  const where = status === 'all' ? '1 = 1' : 'a.status = ?';
  const params = status === 'all' ? [] : [status];

  const rows = await query(
    `SELECT a.id, a.salon_name, a.city, a.status, a.created_at, a.decided_at,
            a.instagram_url, a.tiktok_url, a.facebook_url, a.website_url,
            a.application_text, a.reviewer_notes,
            u.id AS applicant_id, u.name AS applicant_name, u.email AS applicant_email,
            r.name AS reviewer_name
       FROM salon_applications a
       JOIN users u ON u.id = a.applicant_user_id
       LEFT JOIN users r ON r.id = a.reviewer_user_id
      WHERE ${where}
      ORDER BY a.created_at DESC LIMIT 200`,
    params
  );
  res.json({ applications: rows });
}));

router.post('/salon-applications/:id/approve', asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  const schema = z.object({ notes: z.string().max(2000).optional() });
  const { notes } = schema.parse(req.body || {});

  const app = await queryOne(`SELECT * FROM salon_applications WHERE id = ?`, [id]);
  if (!app) throw new HttpError(404, 'not_found', 'Søknaden finnes ikke.');
  if (app.status !== 'pending') throw new HttpError(409, 'not_pending', 'Søknaden er allerede behandlet.');

  // Geocode the application's address before we open the transaction so a slow
  // Nominatim response doesn't hold a DB row lock. Coords are best-effort.
  const coords = await geocode(app.address_line, app.postal_code, app.city);

  await tx(async (conn) => {
    await conn.execute(
      `UPDATE salon_applications
          SET status = 'approved', reviewer_user_id = ?, reviewer_notes = ?, decided_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [req.user.id, notes || null, id]
    );

    const baseSlug = slugify(app.salon_name) || `salong-${id}`;
    // Try base, then -2, -3, ... up to -50. Deterministic suffixes so we
    // can't accidentally end up with an empty random suffix (`base-`) and
    // we don't crash a salon-application approval on slug exhaustion.
    let slug = baseSlug;
    for (let i = 2; i <= 50; i++) {
      const [taken] = await conn.execute(`SELECT id FROM salons WHERE slug = ? LIMIT 1`, [slug]);
      if (!taken[0]) break;
      slug = `${baseSlug}-${i}`;
      if (i === 50) {
        // Extremely unlikely. Fall back to the application id for a guaranteed
        // unique slug rather than throwing the admin into a 500.
        slug = `${baseSlug}-app${id}`;
      }
    }

    await conn.execute(
      `INSERT INTO salons
         (owner_user_id, slug, name, city, address_line, postal_code, lat, lng,
          instagram_url, tiktok_url, facebook_url, website_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        app.applicant_user_id, slug, app.salon_name, app.city,
        app.address_line, app.postal_code,
        coords ? coords.lat : null, coords ? coords.lng : null,
        app.instagram_url, app.tiktok_url, app.facebook_url, app.website_url,
      ]
    );

    // Promote the user to salon_owner if they aren't already (admin keeps admin).
    await conn.execute(
      `UPDATE users SET role = 'salon_owner'
        WHERE id = ? AND role = 'user'`,
      [app.applicant_user_id]
    );
  });
  await audit(req.user.id, 'salon_application.approve', 'salon_application', id);
  res.json({ ok: true });
}));

router.post('/salon-applications/:id/reject', asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  const schema = z.object({ notes: z.string().max(2000).optional() });
  const { notes } = schema.parse(req.body || {});

  const app = await queryOne(`SELECT id, status FROM salon_applications WHERE id = ?`, [id]);
  if (!app) throw new HttpError(404, 'not_found', 'Søknaden finnes ikke.');
  if (app.status !== 'pending') throw new HttpError(409, 'not_pending', 'Søknaden er allerede behandlet.');

  await query(
    `UPDATE salon_applications
        SET status = 'rejected', reviewer_user_id = ?, reviewer_notes = ?, decided_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [req.user.id, notes || null, id]
  );
  await audit(req.user.id, 'salon_application.reject', 'salon_application', id);
  res.json({ ok: true });
}));

// ----------------------------------------------------------------------------
// Review reports (moderation queue for flagged reviews)
// ----------------------------------------------------------------------------

router.get('/review-reports', asyncRoute(async (req, res) => {
  const status = (req.query.status || 'pending').toString();
  const allowed = ['pending', 'dismissed', 'actioned', 'all'];
  if (!allowed.includes(status)) throw new HttpError(400, 'bad_status', 'Ugyldig status.');

  const where = status === 'all' ? '1 = 1' : 'rr.status = ?';
  const params = status === 'all' ? [] : [status];

  const rows = await query(
    `SELECT rr.id, rr.review_id, rr.reason, rr.details, rr.status, rr.created_at,
            rr.resolved_at,
            SUBSTRING(r.body, 1, 200) AS review_snippet,
            r.rating AS review_rating, r.hidden_at AS review_hidden_at,
            s.name AS salon_name, s.slug AS salon_slug,
            reporter.name AS reporter_name, reporter.email AS reporter_email
       FROM review_reports rr
       JOIN reviews r       ON r.id = rr.review_id
       JOIN salons  s       ON s.id = r.salon_id
       JOIN users   reporter ON reporter.id = rr.reporter_user_id
      WHERE ${where}
      ORDER BY rr.created_at DESC LIMIT 200`,
    params
  );
  res.json({ reports: rows });
}));

router.patch('/review-reports/:id', asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');

  const schema = z.object({ action: z.enum(['dismiss', 'hide']) });
  const { action } = schema.parse(req.body || {});

  const report = await queryOne(
    `SELECT id, review_id, status FROM review_reports WHERE id = ?`,
    [id]
  );
  if (!report) throw new HttpError(404, 'not_found', 'Rapporten finnes ikke.');
  if (report.status !== 'pending') {
    throw new HttpError(409, 'not_pending', 'Rapporten er allerede behandlet.');
  }

  if (action === 'dismiss') {
    await query(
      `UPDATE review_reports
          SET status = 'dismissed', resolved_at = NOW(), resolved_by_user_id = ?
        WHERE id = ?`,
      [req.user.id, id]
    );
    await audit(req.user.id, 'review_report.dismiss', 'review_report', id, { review_id: report.review_id });
    return res.json({ ok: true });
  }

  // action === 'hide' — atomically resolve the report AND hide the review.
  await tx(async (conn) => {
    await conn.execute(
      `UPDATE review_reports
          SET status = 'actioned', resolved_at = NOW(), resolved_by_user_id = ?
        WHERE id = ?`,
      [req.user.id, id]
    );
    await conn.execute(
      `UPDATE reviews SET hidden_at = NOW() WHERE id = ? AND hidden_at IS NULL`,
      [report.review_id]
    );
  });
  await audit(req.user.id, 'review_report.hide', 'review_report', id, { review_id: report.review_id });
  res.json({ ok: true });
}));

// ----------------------------------------------------------------------------
// Bookings (read-only listing for admin)
// ----------------------------------------------------------------------------

router.get('/bookings', asyncRoute(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;
  const status = (req.query.status || '').toString();
  const fromDate = (req.query.from || '').toString();
  const toDate = (req.query.to || '').toString();

  const where = ['1 = 1'];
  const params = [];
  if (status) { where.push('b.status = ?'); params.push(status); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) { where.push('b.start_at >= ?'); params.push(fromDate + ' 00:00:00'); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(toDate))   { where.push('b.start_at <= ?'); params.push(toDate + ' 23:59:59'); }

  const rows = await query(
    `SELECT b.id, b.start_at, b.status, b.price_nok,
            u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone,
            u.address_line AS customer_address, u.city AS customer_city, u.postal_code AS customer_postal,
            u.birth_year AS customer_birth_year,
            s.name AS salon_name, s.slug AS salon_slug,
            sv.name AS service_name
       FROM bookings b
       JOIN users u ON u.id = b.customer_user_id
       JOIN salons s ON s.id = b.salon_id
       JOIN services sv ON sv.id = b.service_id
      WHERE ${where.join(' AND ')}
      ORDER BY b.start_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ bookings: rows, limit, offset });
}));

// ----------------------------------------------------------------------------
// Analytics
// ----------------------------------------------------------------------------
//
// All endpoints accept a ?period=1d|7d|30d|90d|6m|12m|all selector. The
// returned shape is API-stable: KPIs, breakdowns, and (for booking analytics)
// a "detailed" array — caller renders whatever it can show.
//
// Geographic breakdowns use users.city / salons.city as a coarse "fylke"
// proxy. We don't store county on either table today; a follow-up can
// upgrade this when address structure improves.

const PERIODS = {
  '1d':  { days: 1   },
  '7d':  { days: 7   },
  '30d': { days: 30  },
  '90d': { days: 90  },
  '6m':  { days: 183 },
  '12m': { days: 365 },
  'all': { days: null },
};

function parsePeriod(p) {
  return PERIODS[p] || PERIODS['30d'];
}

// Group an array of {bucket, count} rows into 5-year age buckets.
function bucketAges(rows) {
  const buckets = ['<18', '18–24', '25–34', '35–44', '45–54', '55+', 'Ukjent'];
  const acc = Object.fromEntries(buckets.map((b) => [b, 0]));
  const currentYear = new Date().getFullYear();
  for (const r of rows) {
    if (!r.birth_year) { acc['Ukjent'] += r.count; continue; }
    const age = currentYear - r.birth_year;
    if (age < 18)      acc['<18']   += r.count;
    else if (age < 25) acc['18–24'] += r.count;
    else if (age < 35) acc['25–34'] += r.count;
    else if (age < 45) acc['35–44'] += r.count;
    else if (age < 55) acc['45–54'] += r.count;
    else               acc['55+']   += r.count;
  }
  return buckets.map((b) => ({ bucket: b, count: acc[b] }));
}

router.get('/analytics/bookings', asyncRoute(async (req, res) => {
  const { days } = parsePeriod((req.query.period || '30d').toString());
  const periodFilter = days != null ? `AND b.start_at >= (NOW() - INTERVAL ${days} DAY)` : '';
  // Period filter is inlined directly in SQL strings (days comes from a
  // hardcoded whitelist). No bound parameters needed for the period itself.
  const periodParams = [];

  // KPIs.
  const kpiRow = await queryOne(
    `SELECT
        COUNT(*)                                     AS new_bookings,
        COUNT(DISTINCT b.customer_user_id)           AS unique_customers,
        COALESCE(AVG(b.price_nok), 0)                AS avg_value,
        SUM(b.status = 'no_show')                    AS no_show_count
       FROM bookings b
      WHERE 1 = 1 ${periodFilter}`,
    periodParams
  );

  // First-time customers in period: customers whose FIRST EVER booking falls
  // inside the window. (If period=all this naturally equals unique_customers.)
  let firstTime = { n: 0 };
  if (days != null) {
    firstTime = await queryOne(
      `SELECT COUNT(*) AS n FROM (
         SELECT customer_user_id, MIN(created_at) AS first_at
           FROM bookings
          GROUP BY customer_user_id
       ) t WHERE t.first_at >= (NOW() - INTERVAL ${days} DAY)`
    );
  } else {
    firstTime = { n: kpiRow.unique_customers };
  }

  const newBookings = Number(kpiRow.new_bookings) || 0;
  const noShowRate = newBookings > 0 ? (Number(kpiRow.no_show_count) || 0) / newBookings : 0;

  // By city (proxy for fylke).
  const byCounty = await query(
    `SELECT COALESCE(NULLIF(s.city, ''), 'Ukjent') AS county, COUNT(*) AS count
       FROM bookings b JOIN salons s ON s.id = b.salon_id
      WHERE 1 = 1 ${periodFilter}
      GROUP BY county ORDER BY count DESC LIMIT 12`,
    periodParams
  );
  const byCountyTotal = byCounty.reduce((sum, r) => sum + Number(r.count), 0);
  const byCountyOut = byCounty.map((r) => ({
    county: r.county,
    count: Number(r.count),
    share: byCountyTotal > 0 ? Number(r.count) / byCountyTotal : 0,
  }));

  // Popular services.
  const popular = await query(
    `SELECT sv.name, COUNT(*) AS count, ROUND(AVG(b.price_nok)) AS avg_price
       FROM bookings b JOIN services sv ON sv.id = b.service_id
      WHERE 1 = 1 ${periodFilter}
      GROUP BY sv.id, sv.name
      ORDER BY count DESC LIMIT 10`,
    periodParams
  );
  const popularOut = popular.map((r) => ({
    name: r.name,
    count: Number(r.count),
    avg_price: r.avg_price != null ? Number(r.avg_price) : null,
  }));

  // By weekday (1=Mon..7=Sun, MySQL DAYOFWEEK is 1=Sun..7=Sat).
  const byWeekdayRows = await query(
    `SELECT ((DAYOFWEEK(b.start_at) + 5) % 7) + 1 AS iso_dow, COUNT(*) AS count
       FROM bookings b
      WHERE 1 = 1 ${periodFilter}
      GROUP BY iso_dow`,
    periodParams
  );
  const labels = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'];
  const byWeekday = labels.map((label, i) => {
    const r = byWeekdayRows.find((x) => Number(x.iso_dow) === i + 1);
    return { weekday: label, count: r ? Number(r.count) : 0 };
  });

  // Age distribution from customer's birth_year.
  const ageRows = await query(
    `SELECT u.birth_year, COUNT(*) AS count
       FROM bookings b JOIN users u ON u.id = b.customer_user_id
      WHERE 1 = 1 ${periodFilter}
      GROUP BY u.birth_year`,
    periodParams
  );
  const ageDistribution = bucketAges(ageRows.map((r) => ({ birth_year: r.birth_year, count: Number(r.count) })));

  res.json({
    period: req.query.period || '30d',
    kpi: {
      new_bookings: newBookings,
      unique_customers: Number(kpiRow.unique_customers) || 0,
      first_time_customers: Number(firstTime.n) || 0,
      avg_value: Math.round(Number(kpiRow.avg_value) || 0),
      no_show_rate: noShowRate,
    },
    by_county: byCountyOut,
    popular_services: popularOut,
    by_weekday: byWeekday,
    age_distribution: ageDistribution,
    notes: { county_proxy: 'salons.city' },
  });
}));

router.get('/analytics/users', asyncRoute(async (req, res) => {
  const { days } = parsePeriod((req.query.period || '30d').toString());
  const periodFilter = days != null ? `AND u.created_at >= (NOW() - INTERVAL ${days} DAY)` : '';
  // Period filter is inlined directly in SQL strings (days comes from a
  // hardcoded whitelist). No bound parameters needed for the period itself.
  const periodParams = [];

  const totalRow = await queryOne(`SELECT COUNT(*) AS n FROM users`);
  const newRow = await queryOne(
    `SELECT COUNT(*) AS n FROM users u WHERE 1 = 1 ${periodFilter}`,
    periodParams
  );
  const active30 = await queryOne(
    `SELECT COUNT(DISTINCT customer_user_id) AS n
       FROM bookings WHERE start_at >= (NOW() - INTERVAL 30 DAY)`
  );

  // Return rate = users with 2+ bookings / users with 1+ booking.
  const returnRow = await queryOne(
    `SELECT
       SUM(CASE WHEN c >= 2 THEN 1 ELSE 0 END) AS returners,
       SUM(CASE WHEN c >= 1 THEN 1 ELSE 0 END) AS bookers
     FROM (
       SELECT customer_user_id, COUNT(*) AS c FROM bookings GROUP BY customer_user_id
     ) t`
  );
  const returners = Number(returnRow?.returners) || 0;
  const bookers = Number(returnRow?.bookers) || 0;

  const avgBookingsRow = await queryOne(
    `SELECT
       (SELECT COUNT(*) FROM bookings) /
       NULLIF((SELECT COUNT(*) FROM users), 0) AS v`
  );

  // Age distribution.
  const ageRows = await query(
    `SELECT u.birth_year, COUNT(*) AS count FROM users u
      WHERE 1 = 1 ${periodFilter}
      GROUP BY u.birth_year`,
    periodParams
  );
  const ageDistribution = bucketAges(ageRows.map((r) => ({ birth_year: r.birth_year, count: Number(r.count) })));

  // By city (proxy).
  const byCounty = await query(
    `SELECT COALESCE(NULLIF(u.city, ''), 'Ukjent') AS county, COUNT(*) AS count
       FROM users u
      WHERE 1 = 1 ${periodFilter}
      GROUP BY county ORDER BY count DESC LIMIT 12`,
    periodParams
  );
  const total = byCounty.reduce((s, r) => s + Number(r.count), 0);
  const byCountyOut = byCounty.map((r) => ({
    county: r.county,
    count: Number(r.count),
    share: total > 0 ? Number(r.count) / total : 0,
  }));

  // Registration channel = first auth_identity provider per user.
  const channelRows = await query(
    `SELECT COALESCE(ai.provider, 'unknown') AS provider, COUNT(*) AS count
       FROM users u
       LEFT JOIN (
         SELECT user_id, MIN(id) AS first_id FROM auth_identities GROUP BY user_id
       ) f ON f.user_id = u.id
       LEFT JOIN auth_identities ai ON ai.id = f.first_id
      WHERE 1 = 1 ${periodFilter}
      GROUP BY provider ORDER BY count DESC`,
    periodParams
  );

  // Detailed user list (period-scoped).
  const detailedRows = await query(
    `SELECT u.id, u.created_at, u.name, u.birth_year, u.phone, u.email,
            u.address_line, u.city, u.postal_code, u.suspended_at,
            (SELECT COUNT(*) FROM bookings b WHERE b.customer_user_id = u.id) AS bookings,
            (SELECT MAX(b.start_at) FROM bookings b WHERE b.customer_user_id = u.id) AS last_booking
       FROM users u
      WHERE 1 = 1 ${periodFilter}
      ORDER BY u.created_at DESC LIMIT 200`,
    periodParams
  );
  const currentYear = new Date().getFullYear();
  const detailed = detailedRows.map((u) => ({
    id: u.id,
    created_at: u.created_at,
    name: u.name,
    age: u.birth_year ? currentYear - u.birth_year : null,
    phone: u.phone,
    email: u.email,
    address: [u.address_line, u.postal_code, u.city].filter(Boolean).join(', '),
    bookings: Number(u.bookings) || 0,
    last_booking: u.last_booking,
    status: u.suspended_at ? 'suspended' : 'active',
  }));

  res.json({
    period: req.query.period || '30d',
    kpi: {
      new_users: Number(newRow.n) || 0,
      total: Number(totalRow.n) || 0,
      active_30d: Number(active30.n) || 0,
      return_rate: bookers > 0 ? returners / bookers : 0,
      avg_bookings_per_user: Number(avgBookingsRow?.v) || 0,
    },
    age_distribution: ageDistribution,
    by_county: byCountyOut,
    registration_channel: channelRows.map((r) => ({ provider: r.provider, count: Number(r.count) })),
    detailed,
    notes: { county_proxy: 'users.city' },
  });
}));

router.get('/analytics/summary', asyncRoute(async (req, res) => {
  const { days } = parsePeriod((req.query.period || '30d').toString());
  const periodFilter = days != null ? `AND b.start_at >= (NOW() - INTERVAL ${days} DAY)` : '';
  // Period filter is inlined directly in SQL strings (days comes from a
  // hardcoded whitelist). No bound parameters needed for the period itself.
  const periodParams = [];

  // Notifications sent in period (status='sent', split by channel). Når
  // days=null (Alt) faller filteret bort så vi får totalsummer over alle tider.
  const notifFilter = days != null ? `AND created_at >= (NOW() - INTERVAL ${days} DAY)` : '';
  const notifRow = await queryOne(
    `SELECT
        SUM(channel = 'email' AND status = 'sent') AS emails_sent,
        SUM(channel = 'sms'   AND status = 'sent') AS sms_sent
       FROM notification_log
      WHERE 1 = 1 ${notifFilter}`
  );

  const totalRevenueRow = await queryOne(
    `SELECT COALESCE(SUM(b.price_nok), 0) AS revenue, COUNT(*) AS bookings
       FROM bookings b WHERE b.status IN ('confirmed','completed') ${periodFilter}`,
    periodParams
  );

  const activeSalonsRow = await queryOne(`SELECT COUNT(*) AS n FROM salons WHERE status = 'active'`);
  const totalSalonsRow = await queryOne(`SELECT COUNT(*) AS n FROM salons WHERE status != 'deleted'`);

  // Avg bookings per active salon (period scoped).
  const perSalonRow = await queryOne(
    `SELECT
        (SELECT COUNT(*) FROM bookings b WHERE 1 = 1 ${periodFilter}) /
        NULLIF((SELECT COUNT(*) FROM salons WHERE status = 'active'), 0) AS v`,
    periodParams
  );

  // Top salons in period.
  const topSalons = await query(
    `SELECT s.id, s.name, s.slug, s.city,
            COUNT(b.id) AS bookings,
            COALESCE(SUM(b.price_nok), 0) AS revenue
       FROM salons s LEFT JOIN bookings b ON b.salon_id = s.id ${days != null ? `AND b.start_at >= (NOW() - INTERVAL ${days} DAY)` : ''}
      WHERE s.status != 'deleted'
      GROUP BY s.id, s.name, s.slug, s.city
      ORDER BY bookings DESC, revenue DESC
      LIMIT 10`,
    periodParams
  );

  // Bookings per week (last 12 weeks) — independent of `period`.
  const perWeek = await query(
    `SELECT YEARWEEK(b.start_at, 3) AS yw, COUNT(*) AS count
       FROM bookings b
      WHERE b.start_at >= (NOW() - INTERVAL 12 WEEK)
      GROUP BY yw ORDER BY yw ASC`
  );

  // Revenue per month (last 6 months).
  const perMonth = await query(
    `SELECT DATE_FORMAT(b.start_at, '%Y-%m') AS ym,
            COALESCE(SUM(b.price_nok), 0) AS revenue,
            COUNT(*) AS bookings
       FROM bookings b
      WHERE b.start_at >= (NOW() - INTERVAL 6 MONTH)
        AND b.status IN ('confirmed','completed')
      GROUP BY ym ORDER BY ym ASC`
  );

  // User geography (proxy).
  const userGeo = await query(
    `SELECT COALESCE(NULLIF(u.city, ''), 'Ukjent') AS county, COUNT(*) AS count
       FROM users u
      GROUP BY county ORDER BY count DESC LIMIT 10`
  );

  res.json({
    period: req.query.period || '30d',
    kpi: {
      total_revenue: Number(totalRevenueRow.revenue) || 0,
      total_bookings: Number(totalRevenueRow.bookings) || 0,
      active_salons: Number(activeSalonsRow.n) || 0,
      total_salons: Number(totalSalonsRow.n) || 0,
      avg_bookings_per_salon: Number(perSalonRow?.v) || 0,
      emails_sent: Number(notifRow.emails_sent) || 0,
      sms_sent: Number(notifRow.sms_sent) || 0,
    },
    top_salons: topSalons.map((s) => ({
      id: s.id, name: s.name, slug: s.slug, city: s.city,
      bookings: Number(s.bookings) || 0,
      revenue: Number(s.revenue) || 0,
    })),
    bookings_per_week: perWeek.map((r) => ({ yearweek: String(r.yw), count: Number(r.count) })),
    revenue_per_month: perMonth.map((r) => ({
      month: r.ym, revenue: Number(r.revenue) || 0, bookings: Number(r.bookings) || 0,
    })),
    user_geography: userGeo.map((r) => ({ county: r.county, count: Number(r.count) })),
    notes: { county_proxy: 'users.city / salons.city' },
  });
}));

// ----------------------------------------------------------------------------
// App settings (simple key/value)
// ----------------------------------------------------------------------------
//
// Stored in `app_settings` (created on first read if missing). Values are
// JSON-encoded so we keep types intact (booleans for toggles, strings for
// support email, numbers for trial length). Real feature-flag enforcement
// is Fase 4 — for now we just persist the values round-trip.

const SETTINGS_DEFAULTS = {
  platform_name:           { type: 'string',  value: 'nailed' },
  support_email:           { type: 'string',  value: 'hei@nailed.no' },
  trial_length:            { type: 'string',  value: '6 måneder' },
  monthly_price:           { type: 'string',  value: '99 kr' },
  feature_vipps_login:     { type: 'boolean', value: true },
  feature_push:            { type: 'boolean', value: true },
  feature_sms_reminders:   { type: 'boolean', value: true },
  feature_reviews:         { type: 'boolean', value: true },
  feature_waitlist:        { type: 'boolean', value: false },
  feature_giftcards:       { type: 'boolean', value: false },
};

// Use pool.query (text protocol) for DDL — pool.execute (prepared) can be
// finicky with CREATE statements depending on the driver version.
let _settingsTableReady = false;
async function ensureSettingsTable() {
  if (_settingsTableReady) return;
  await pool.query(
    'CREATE TABLE IF NOT EXISTS app_settings (' +
    '  `key`      VARCHAR(64) NOT NULL PRIMARY KEY,' +
    '  value      JSON NOT NULL,' +
    '  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' +
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
  _settingsTableReady = true;
}

router.get('/settings', asyncRoute(async (_req, res) => {
  await ensureSettingsTable();
  const [rows] = await pool.query('SELECT `key`, value FROM app_settings');
  const stored = {};
  for (const r of rows) {
    // mysql2 returns JSON columns as parsed values when typeCast accepts them.
    // If a string sneaks in (older MySQL or column re-type), parse defensively.
    let v = r.value;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* keep raw */ } }
    stored[r.key] = v;
  }
  const out = {};
  for (const [k, def] of Object.entries(SETTINGS_DEFAULTS)) {
    out[k] = (k in stored) ? stored[k] : def.value;
  }
  res.json({ settings: out, defaults: Object.fromEntries(
    Object.entries(SETTINGS_DEFAULTS).map(([k, d]) => [k, { type: d.type, default: d.value }])
  ) });
}));

router.put('/settings', asyncRoute(async (req, res) => {
  await ensureSettingsTable();
  const body = req.body || {};
  if (!body || typeof body !== 'object') throw new HttpError(400, 'bad_body', 'Body må være et objekt.');
  const incoming = body.settings || body;
  const writes = [];
  for (const [k, def] of Object.entries(SETTINGS_DEFAULTS)) {
    if (!(k in incoming)) continue;
    let v = incoming[k];
    if (def.type === 'boolean') v = Boolean(v);
    else if (def.type === 'string') v = String(v ?? '').slice(0, 500);
    else if (def.type === 'number') v = Number(v) || 0;
    writes.push([k, JSON.stringify(v)]);
  }
  if (writes.length === 0) {
    throw new HttpError(400, 'no_keys', 'Ingen kjente innstillinger oppgitt.');
  }
  for (const [k, v] of writes) {
    await pool.query(
      'INSERT INTO app_settings (`key`, value) VALUES (?, ?) ' +
      'ON DUPLICATE KEY UPDATE value = VALUES(value)',
      [k, v]
    );
  }
  await audit(req.user.id, 'settings.update', 'app_settings', null, { keys: writes.map((w) => w[0]) });
  res.json({ ok: true, updated: writes.length });
}));

// ----------------------------------------------------------------------------
async function audit(actorId, action, entityType, entityId, meta) {
  try {
    await query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, meta_json)
       VALUES (?, ?, ?, ?, ?)`,
      [actorId, action, entityType, entityId, meta ? JSON.stringify(meta) : null]
    );
  } catch (err) {
    console.error('[audit] failed', err);
  }
}

module.exports = router;
