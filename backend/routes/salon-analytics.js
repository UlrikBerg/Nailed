// Salon-owner analytics + private customer notes.
//
// All endpoints are scoped to ONE salon (`/api/v1/salons/:id/...`) and require
// the caller to either own the salon or be an admin. Customers never see any
// of these endpoints — in particular, customer_notes are never echoed on
// customer-visible surfaces (see backend/routes/bookings.js + me.js).
//
// Analytics figures are computed live from `bookings` and `reviews`. The whole
// owner panel only fetches them on demand (when the Analyse tab opens), so a
// real-time recompute on each tab open is fine at our current scale.

const express = require('express');
const { z } = require('zod');
const { query, queryOne } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute, HttpError } = require('../lib/util');

const router = express.Router({ mergeParams: true });

// Require the caller to own the salon (or be admin). Returns the salon row.
async function loadOwnedSalon(req) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  const salon = await queryOne(`SELECT id, owner_user_id FROM salons WHERE id = ?`, [id]);
  if (!salon) throw new HttpError(404, 'not_found', 'Salongen finnes ikke.');
  if (req.user.role !== 'admin' && salon.owner_user_id !== req.user.id) {
    throw new HttpError(403, 'forbidden', 'Du eier ikke denne salongen.');
  }
  return salon;
}

// UTC-instant for the start of the Oslo-local day that contains `date`.
function osloStartOfDay(date) {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Oslo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
  // UTC midnight of that Oslo date
  const utcMid = new Date(`${ymd}T00:00:00Z`);
  // What hour does that UTC instant land on in Oslo? 1 → CET (+1), 2 → CEST (+2)
  const osloHour = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Oslo', hour: '2-digit', hour12: false,
  }).format(utcMid);
  const offsetHours = parseInt(osloHour, 10);
  return new Date(utcMid.getTime() - offsetHours * 3600000);
}

// Map a period string to a {since, until} window for analytics queries.
// since is inclusive (b.start_at >= since), until is exclusive (b.start_at < until).
// null = unbounded.
function periodToRange(period) {
  const now = new Date();
  const oneDay = 86400000;
  switch (String(period || '').toLowerCase()) {
    case 'today': {
      return { since: osloStartOfDay(now), until: null };
    }
    case 'yesterday': {
      const todayStart = osloStartOfDay(now);
      const yStart = new Date(todayStart.getTime() - oneDay);
      return { since: yStart, until: todayStart };
    }
    case '7d':  return { since: new Date(now.getTime() - 7  * oneDay), until: null };
    case '30d': return { since: new Date(now.getTime() - 30 * oneDay), until: null };
    case '90d': return { since: new Date(now.getTime() - 90 * oneDay), until: null };
    case '6m': {
      const d = new Date(now); d.setMonth(d.getMonth() - 6);
      return { since: d, until: null };
    }
    case '12m': {
      const d = new Date(now); d.setFullYear(d.getFullYear() - 1);
      return { since: d, until: null };
    }
    case 'all': return { since: null, until: null };
    default:    return { since: new Date(now.getTime() - 30 * oneDay), until: null };
  }
}

// Format a Date as Oslo "weekday 1..7" + hour 0..23 using Intl, matching the
// approach used in bookings.js (DST-safe).
function osloPartsOf(d) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Oslo',
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
  });
  const parts = {};
  fmt.formatToParts(d).forEach(p => { parts[p.type] = p.value; });
  const wdMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    weekday: wdMap[parts.weekday] || 0,
    hour: parts.hour === '24' ? 0 : parseInt(parts.hour, 10),
  };
}

// =============================================================================
// GET /salons/:id/analytics?period=today|yesterday|7d|30d|90d|6m|12m|all
// =============================================================================
//
// Returns a snapshot scoped to this salon only. Shape:
//   {
//     kpi: { bookings_count, completed_count, cancelled_count, no_show_count,
//            revenue_nok, unique_customers, returning_customers, avg_value,
//            no_show_rate },
//     top_services: [{ id, name, count, revenue_nok, avg_price }, …] up to 10
//     top_stylists: [{ id, name, count, revenue_nok, no_show_rate, share }, …]
//     bookings_by_weekday: { '1': n, '2': n, … '7': n }   (ISO 1=Mon … 7=Sun)
//     bookings_by_hour:    { '0': n, '1': n, … '23': n }
//     revenue_trend:       [{ week_start, revenue }] last 12 weeks
//     returning_rate_trend:[{ month_start, returning_rate }] last 6 months
//     recent_reviews:      [{ id, rating, body, customer_name, created_at }] x5
//   }
//
// "Revenue" counts the price_nok of every booking with status='completed' in
// the window. Cancelled/no-show bookings count toward bookings_count and the
// no-show rate, but not revenue.
router.get('/:id/analytics', requireAuth, asyncRoute(async (req, res) => {
  const salon = await loadOwnedSalon(req);
  const period = (req.query.period || '30d').toString();
  const range = periodToRange(period);
  const since = range.since;
  const until = range.until;

  // The window filter is applied via b.start_at. We use the same condition for
  // every aggregate så en "30d"/"today"/"yesterday"-visning er konsistent.
  const winParts = [];
  const winParams = [];
  if (since) { winParts.push('AND b.start_at >= ?'); winParams.push(since); }
  if (until) { winParts.push('AND b.start_at < ?');  winParams.push(until); }
  const winSql = winParts.join(' ');

  // --- KPI tiles ------------------------------------------------------------
  const kpiRow = await queryOne(
    `SELECT
        COUNT(*)                                          AS bookings_count,
        SUM(CASE WHEN b.status='completed' THEN 1 ELSE 0 END) AS completed_count,
        SUM(CASE WHEN b.status='cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
        SUM(CASE WHEN b.status='no_show'   THEN 1 ELSE 0 END) AS no_show_count,
        COALESCE(SUM(CASE WHEN b.status='completed' THEN b.price_nok END), 0) AS revenue_nok,
        COUNT(DISTINCT b.customer_user_id)                AS unique_customers,
        COALESCE(AVG(CASE WHEN b.status='completed' THEN b.price_nok END), 0) AS avg_value
       FROM bookings b
      WHERE b.salon_id = ? ${winSql}`,
    [salon.id, ...winParams]
  );

  // Returning customers: customers in this window who had a PRIOR booking at
  // this salon before the window started. (If the window is "all", returning =
  // anyone with >= 2 bookings ever, which is a clean fallback.)
  let returningCustomers = 0;
  if (since) {
    const retRow = await queryOne(
      `SELECT COUNT(DISTINCT b.customer_user_id) AS n
         FROM bookings b
        WHERE b.salon_id = ? ${winSql}
          AND EXISTS (
            SELECT 1 FROM bookings b2
             WHERE b2.salon_id = b.salon_id
               AND b2.customer_user_id = b.customer_user_id
               AND b2.start_at < ?
          )`,
      [salon.id, ...winParams, since]
    );
    returningCustomers = Number(retRow?.n || 0);
  } else {
    const retRow = await queryOne(
      `SELECT COUNT(*) AS n FROM (
         SELECT customer_user_id, COUNT(*) AS c
           FROM bookings WHERE salon_id = ?
          GROUP BY customer_user_id
         HAVING c >= 2
       ) t`,
      [salon.id]
    );
    returningCustomers = Number(retRow?.n || 0);
  }

  const bookingsCount = Number(kpiRow?.bookings_count || 0);
  const noShowCount   = Number(kpiRow?.no_show_count   || 0);
  const noShowRate    = bookingsCount > 0 ? noShowCount / bookingsCount : 0;

  const kpi = {
    bookings_count:      bookingsCount,
    completed_count:     Number(kpiRow?.completed_count   || 0),
    cancelled_count:     Number(kpiRow?.cancelled_count   || 0),
    no_show_count:       noShowCount,
    revenue_nok:         Number(kpiRow?.revenue_nok       || 0),
    unique_customers:    Number(kpiRow?.unique_customers  || 0),
    returning_customers: returningCustomers,
    avg_value:           Math.round(Number(kpiRow?.avg_value || 0)),
    no_show_rate:        Math.round(noShowRate * 1000) / 1000,
  };

  // --- Top services --------------------------------------------------------
  const topServices = await query(
    `SELECT sv.id, sv.name,
            COUNT(*)                                                AS count,
            COALESCE(SUM(CASE WHEN b.status='completed' THEN b.price_nok END), 0) AS revenue_nok,
            COALESCE(AVG(b.price_nok), 0)                           AS avg_price
       FROM bookings b
       JOIN services sv ON sv.id = b.service_id
      WHERE b.salon_id = ? ${winSql}
      GROUP BY sv.id, sv.name
      ORDER BY count DESC, revenue_nok DESC
      LIMIT 10`,
    [salon.id, ...winParams]
  );

  // --- Top stylists --------------------------------------------------------
  // Only meaningful once bookings.team_member_id is populated by the multi-
  // stylist agent. If it's not yet attached to any rows, this comes back empty
  // and the frontend should hide the section.
  let topStylists = [];
  try {
    const stylistRows = await query(
      `SELECT tm.id, tm.name,
              COUNT(*)                                                AS count,
              COALESCE(SUM(CASE WHEN b.status='completed' THEN b.price_nok END), 0) AS revenue_nok,
              SUM(CASE WHEN b.status='no_show' THEN 1 ELSE 0 END)     AS no_shows
         FROM bookings b
         JOIN team_members tm ON tm.id = b.team_member_id
        WHERE b.salon_id = ? ${winSql}
          AND b.team_member_id IS NOT NULL
        GROUP BY tm.id, tm.name
        ORDER BY count DESC, revenue_nok DESC
        LIMIT 20`,
      [salon.id, ...winParams]
    );
    const stylistTotal = stylistRows.reduce((acc, r) => acc + Number(r.count || 0), 0);
    topStylists = stylistRows.map(r => {
      const n = Number(r.count || 0);
      const noShows = Number(r.no_shows || 0);
      return {
        id: r.id,
        name: r.name,
        count: n,
        revenue_nok: Number(r.revenue_nok || 0),
        no_show_rate: n > 0 ? Math.round((noShows / n) * 1000) / 1000 : 0,
        share: stylistTotal > 0 ? Math.round((n / stylistTotal) * 1000) / 1000 : 0,
      };
    });
  } catch (err) {
    // bookings.team_member_id absent on very old schemas — return empty list.
    if (err && err.code === 'ER_BAD_FIELD_ERROR') topStylists = [];
    else throw err;
  }

  // --- Weekday + hour buckets ----------------------------------------------
  // We pull just start_at and bucket in JS so the Oslo-timezone mapping is
  // identical to the rest of the codebase (Intl.DateTimeFormat).
  const startRows = await query(
    `SELECT b.start_at FROM bookings b
      WHERE b.salon_id = ? ${winSql}`,
    [salon.id, ...winParams]
  );
  const bookingsByWeekday = { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0 };
  const bookingsByHour = {};
  for (let h = 0; h < 24; h++) bookingsByHour[h] = 0;
  for (const r of startRows) {
    const d = r.start_at instanceof Date ? r.start_at : new Date(r.start_at);
    const { weekday, hour } = osloPartsOf(d);
    if (weekday >= 1 && weekday <= 7) bookingsByWeekday[weekday]++;
    if (hour >= 0 && hour < 24) bookingsByHour[hour]++;
  }

  // --- Weekly revenue trend (last 12 ISO weeks) ----------------------------
  // Bucket by Monday-of-the-week in local time. We compute the 12 buckets up
  // front so the response always has 12 points even when some weeks are zero.
  const revenueTrend = (() => {
    const buckets = [];
    const now = new Date();
    const day = now.getDay() || 7; // 0 → 7 so Sunday becomes the 7th day
    const monday = new Date(now);
    monday.setDate(monday.getDate() - (day - 1));
    monday.setHours(0, 0, 0, 0);
    for (let i = 11; i >= 0; i--) {
      const b = new Date(monday);
      b.setDate(b.getDate() - i * 7);
      buckets.push({ week_start: b, revenue: 0 });
    }
    return buckets;
  })();

  if (revenueTrend.length) {
    const earliest = revenueTrend[0].week_start;
    const completedRows = await query(
      `SELECT b.start_at, b.price_nok FROM bookings b
        WHERE b.salon_id = ? AND b.status = 'completed' AND b.start_at >= ?`,
      [salon.id, earliest]
    );
    for (const r of completedRows) {
      const d = r.start_at instanceof Date ? r.start_at : new Date(r.start_at);
      // Find the latest bucket whose week_start <= d.
      for (let i = revenueTrend.length - 1; i >= 0; i--) {
        if (d >= revenueTrend[i].week_start) {
          revenueTrend[i].revenue += Number(r.price_nok || 0);
          break;
        }
      }
    }
  }

  // --- Returning-customer monthly trend (last 6 months) --------------------
  // For each of the last 6 calendar months: among customers who had a booking
  // in that month, what fraction had ALSO booked here before that month started?
  const returningRateTrend = (() => {
    const out = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      out.push({ month_start: start, end, returning_rate: 0, total: 0 });
    }
    return out;
  })();

  for (const bucket of returningRateTrend) {
    const totalRow = await queryOne(
      `SELECT COUNT(DISTINCT customer_user_id) AS n
         FROM bookings WHERE salon_id = ? AND start_at >= ? AND start_at < ?`,
      [salon.id, bucket.month_start, bucket.end]
    );
    const retRow = await queryOne(
      `SELECT COUNT(DISTINCT b.customer_user_id) AS n
         FROM bookings b
        WHERE b.salon_id = ? AND b.start_at >= ? AND b.start_at < ?
          AND EXISTS (
            SELECT 1 FROM bookings b2
             WHERE b2.salon_id = b.salon_id
               AND b2.customer_user_id = b.customer_user_id
               AND b2.start_at < ?
          )`,
      [salon.id, bucket.month_start, bucket.end, bucket.month_start]
    );
    const total = Number(totalRow?.n || 0);
    const ret = Number(retRow?.n || 0);
    bucket.total = total;
    bucket.returning_rate = total > 0 ? Math.round((ret / total) * 1000) / 1000 : 0;
  }

  // --- Recent reviews ------------------------------------------------------
  const recentReviewRows = await query(
    `SELECT r.id, r.rating, r.body, r.created_at,
            u.name AS customer_full_name
       FROM reviews r
       JOIN users u ON u.id = r.customer_user_id
      WHERE r.salon_id = ? AND r.hidden_at IS NULL
      ORDER BY r.created_at DESC
      LIMIT 5`,
    [salon.id]
  );
  function maskName(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'Anonym';
    if (parts.length === 1) return parts[0];
    const last = parts[parts.length - 1];
    return parts[0] + ' ' + last.charAt(0).toUpperCase() + '.';
  }
  const recentReviews = recentReviewRows.map(r => ({
    id: r.id,
    rating: r.rating,
    body: r.body,
    customer_name: maskName(r.customer_full_name),
    created_at: r.created_at,
  }));

  res.json({
    period,
    since: since ? since.toISOString() : null,
    until: until ? until.toISOString() : null,
    kpi,
    top_services: topServices.map(r => ({
      id: r.id,
      name: r.name,
      count: Number(r.count || 0),
      revenue_nok: Number(r.revenue_nok || 0),
      avg_price: Math.round(Number(r.avg_price || 0)),
    })),
    top_stylists: topStylists,
    bookings_by_weekday: bookingsByWeekday,
    bookings_by_hour: bookingsByHour,
    revenue_trend: revenueTrend.map(b => ({
      week_start: b.week_start.toISOString().slice(0, 10),
      revenue: b.revenue,
    })),
    returning_rate_trend: returningRateTrend.map(b => ({
      month_start: b.month_start.toISOString().slice(0, 10),
      returning_rate: b.returning_rate,
      total: b.total,
    })),
    recent_reviews: recentReviews,
  });
}));

// =============================================================================
// GET /salons/:id/customers
// =============================================================================
//
// List of distinct customers who have ever booked this salon, with aggregates
// used by the panel's Kunder tab: booking_count, last_booking_at,
// lifetime_value (sum of completed bookings' price_nok) and has_note.
router.get('/:id/customers', requireAuth, asyncRoute(async (req, res) => {
  const salon = await loadOwnedSalon(req);
  const rows = await query(
    `SELECT u.id AS user_id,
            u.name, u.email, u.phone,
            COUNT(*)                                              AS booking_count,
            MAX(b.start_at)                                       AS last_booking_at,
            COALESCE(SUM(CASE WHEN b.status='completed' THEN b.price_nok END), 0) AS lifetime_value,
            (SELECT 1 FROM customer_notes cn
              WHERE cn.salon_id = ? AND cn.customer_user_id = u.id LIMIT 1) AS has_note
       FROM bookings b
       JOIN users u ON u.id = b.customer_user_id
      WHERE b.salon_id = ?
      GROUP BY u.id, u.name, u.email, u.phone
      ORDER BY last_booking_at DESC
      LIMIT 500`,
    [salon.id, salon.id]
  );

  res.json({
    customers: rows.map(r => ({
      user_id:         r.user_id,
      name:            r.name,
      email:           r.email,
      phone:           r.phone,
      booking_count:   Number(r.booking_count || 0),
      last_booking_at: r.last_booking_at,
      lifetime_value:  Number(r.lifetime_value || 0),
      has_note:        !!r.has_note,
    })),
  });
}));

// =============================================================================
// GET /salons/:id/customers/:userId/note  (owner-only)
// =============================================================================
router.get('/:id/customers/:userId/note', requireAuth, asyncRoute(async (req, res) => {
  const salon = await loadOwnedSalon(req);
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isFinite(userId)) throw new HttpError(400, 'bad_id', 'Ugyldig kunde-id.');
  const note = await queryOne(
    `SELECT body, updated_at FROM customer_notes
      WHERE salon_id = ? AND customer_user_id = ?`,
    [salon.id, userId]
  );
  if (!note) throw new HttpError(404, 'not_found', 'Ingen notat lagret.');
  res.json({ body: note.body, updated_at: note.updated_at });
}));

// =============================================================================
// PUT /salons/:id/customers/:userId/note  (owner-only)
// =============================================================================
// Upsert. An empty/whitespace body deletes the note (so the owner can clear it
// without a separate DELETE call from the panel).
router.put('/:id/customers/:userId/note', requireAuth, asyncRoute(async (req, res) => {
  const salon = await loadOwnedSalon(req);
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isFinite(userId)) throw new HttpError(400, 'bad_id', 'Ugyldig kunde-id.');

  const data = z.object({
    body: z.string().max(2000),
  }).parse(req.body || {});
  const trimmed = data.body.trim();

  // Ensure the user is a real account; we don't want to write notes for a
  // user_id that doesn't exist (no FK violation, but stale data).
  const u = await queryOne(`SELECT id FROM users WHERE id = ?`, [userId]);
  if (!u) throw new HttpError(404, 'user_not_found', 'Brukeren finnes ikke.');

  if (trimmed === '') {
    await query(
      `DELETE FROM customer_notes WHERE salon_id = ? AND customer_user_id = ?`,
      [salon.id, userId]
    );
    return res.json({ ok: true, deleted: true });
  }

  await query(
    `INSERT INTO customer_notes (salon_id, customer_user_id, body)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE body = VALUES(body)`,
    [salon.id, userId, trimmed]
  );
  res.json({ ok: true });
}));

module.exports = router;
