const express = require('express');
const { z } = require('zod');
const { query, queryOne, tx } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute, HttpError } = require('../lib/util');
const { lazyUrl } = require('../lib/schema');
const geocode = require('../lib/geocode');
const storage = require('../storage');
const { hasVariants, variantKey, variantUrls } = require('../lib/image-variants');

const router = express.Router();

function withCoverUrl(row) {
  const { cover_image_key, ...rest } = row;
  if (!cover_image_key) {
    return { ...rest, cover_image_key, cover_url: null };
  }
  const base = { cover_url: storage.publicUrl(cover_image_key) };
  if (hasVariants(cover_image_key)) {
    base.cover_url_400  = storage.publicUrl(variantKey(cover_image_key, 400));
    base.cover_url_800  = storage.publicUrl(variantKey(cover_image_key, 800));
    base.cover_url_1600 = storage.publicUrl(variantKey(cover_image_key, 1600));
  }
  return { ...rest, cover_image_key, ...base };
}

// GET /salons — public listing (paginated)
// Optional filters:
//   ?city=<exact city>     — case-sensitive equality (cities are stored canonical)
//   ?q=<text>              — LIKE-match across salon name, bio, AND service names.
//                            Joins services so a search for a treatment surfaces
//                            salons that offer that treatment. DISTINCT to dedupe.
//   ?min_price / ?max_price — filter by salon's cheapest active service (NOK)
//   ?max_duration          — at least one active service with duration_min <= max
//   ?category              — exact match against service_categories.name
//   ?min_rating            — avg review rating >= min (1..5)
//   ?open_now=1            — salon's hours row for current Oslo weekday is open
//   ?has_reviews=1         — only salons with >= 1 review
//
// Each row includes computed: min_price, min_duration, avg_rating, review_count,
// is_open_now (bool) and top_categories (top 3 distinct category names as JSON).
router.get('/', asyncRoute(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 24, 500);
  const offset = parseInt(req.query.offset, 10) || 0;
  const city = (req.query.city || '').toString().trim();
  const q = (req.query.q || '').toString().trim();

  // --- Parse numeric / boolean filters defensively. Empty/invalid → omit. ---
  function intParam(name) {
    const raw = req.query[name];
    if (raw == null || raw === '') return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }
  function floatParam(name) {
    const raw = req.query[name];
    if (raw == null || raw === '') return null;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  }
  const minPrice = intParam('min_price');
  const maxPrice = intParam('max_price');
  const maxDuration = intParam('max_duration');
  const minRating = floatParam('min_rating');
  const category = (req.query.category || '').toString().trim();
  const openNow = String(req.query.open_now || '') === '1';
  const hasReviews = String(req.query.has_reviews || '') === '1';

  // --- Compute Oslo wall-clock for open_now filter & is_open_now column. ---
  // Uses the same Intl.DateTimeFormat trick as bookings.js to be DST-safe.
  const oslo = (() => {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Oslo',
      weekday: 'short',
      hour: '2-digit', minute: '2-digit',
      hour12: false,
    });
    const dfmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Oslo',
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const parts = {};
    fmt.formatToParts(new Date()).forEach(p => { parts[p.type] = p.value; });
    const wdMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    const hh = parts.hour === '24' ? '00' : parts.hour;
    return {
      weekday: wdMap[parts.weekday] || 0,
      hhmm: `${hh}:${parts.minute}:00`,
      dateStr: dfmt.format(new Date()),
    };
  })();

  // --- Build the WHERE / param list. -----------------------------------------
  // Aggregates (min_price, avg_rating, etc.) are filtered via HAVING; everything
  // else lands in WHERE.
  const where = ['s.status = ?'];
  const params = ['active'];
  if (city) { where.push('s.city = ?'); params.push(city); }

  // q matches name OR bio OR any active service's name on this salon. We add
  // the join unconditionally below (it's needed for min_price/min_duration too)
  // — here we just append the WHERE clauses.
  if (q) {
    const like = `%${q}%`;
    where.push('(s.name LIKE ? OR s.bio LIKE ? OR sv_q.name LIKE ?)');
    params.push(like, like, like);
  }

  // Category filter: salon must have at least one service in a category with
  // the given name. We EXISTS-join to keep DISTINCT-by-salon clean.
  if (category) {
    where.push(`EXISTS (
      SELECT 1 FROM services sv2
        JOIN service_categories sc2 ON sc2.id = sv2.category_id
       WHERE sv2.salon_id = s.id AND sv2.active = 1 AND sc2.name = ?
    )`);
    params.push(category);
  }

  // open_now: weekday row exists, is_closed=0, and HH:MM is within open..close.
  // Match bookings.js semantics: missing rows mean "no per-weekday restriction"
  // — but that also means we can't claim the salon is open now, so we EXCLUDE
  // salons with no row for today when open_now=1.
  if (openNow) {
    where.push(`EXISTS (
      SELECT 1 FROM salon_hours sh2
       WHERE sh2.salon_id = s.id
         AND sh2.weekday = ?
         AND sh2.is_closed = 0
         AND sh2.open_at IS NOT NULL AND sh2.close_at IS NOT NULL
         AND ? BETWEEN sh2.open_at AND sh2.close_at
    )`);
    params.push(oslo.weekday, oslo.hhmm);
  }

  // duration filter: salon has at least one active service with duration<=max.
  if (maxDuration != null) {
    where.push(`EXISTS (
      SELECT 1 FROM services sv3
       WHERE sv3.salon_id = s.id AND sv3.active = 1
         AND sv3.duration_min <= ?
    )`);
    params.push(maxDuration);
  }

  // --- Aggregates: min_price, min_duration, avg_rating, review_count. --------
  // Each aggregate is a correlated subquery so DISTINCT/GROUP BY isn't needed
  // for the main row. Filters on aggregates are appended to WHERE (not HAVING)
  // — we want them indexed via the subqueries' own scans.
  // For min_price filter: subquery MIN must satisfy the bounds.
  if (minPrice != null) {
    where.push(`(SELECT MIN(price_nok) FROM services WHERE salon_id = s.id AND active = 1) >= ?`);
    params.push(minPrice);
  }
  if (maxPrice != null) {
    where.push(`(SELECT MIN(price_nok) FROM services WHERE salon_id = s.id AND active = 1) <= ?`);
    params.push(maxPrice);
  }
  if (minRating != null) {
    where.push(`(SELECT AVG(rating) FROM reviews WHERE salon_id = s.id AND hidden_at IS NULL) >= ?`);
    params.push(minRating);
  }
  if (hasReviews) {
    where.push(`EXISTS (SELECT 1 FROM reviews WHERE salon_id = s.id AND hidden_at IS NULL)`);
  }

  // The `sv_q` join is only needed when q is present (to LIKE on service names);
  // otherwise we skip it. DISTINCT on s.id is what dedupes when sv_q matches
  // multiple services per salon.
  const qJoin = q ? 'LEFT JOIN services sv_q ON sv_q.salon_id = s.id AND sv_q.active = 1' : '';

  // selectParams ordering matches the `?` placeholders in the SELECT columns:
  //   is_open_now   → (hhmm, weekday)
  //   reopens_today → (hhmm, dateStr, weekday)
  // They appear BEFORE the WHERE-clause params.
  const selectParams = [oslo.hhmm, oslo.weekday, oslo.hhmm, oslo.dateStr, oslo.weekday];

  // Totalt antall salonger som matcher filteret (uten LIMIT/OFFSET) —
  // brukt av frontend for sidenummerering.
  const totalRow = await queryOne(
    `SELECT COUNT(DISTINCT s.id) AS n
       FROM salons s
       ${qJoin}
      WHERE ${where.join(' AND ')}`,
    [...params]
  );
  const total = Number(totalRow?.n || 0);

  const rows = await query(
    `SELECT DISTINCT
            s.id, s.slug, s.name, s.city, s.bio, s.instagram_url, s.cover_image_key, s.created_at,
            s.lat, s.lng,
            (SELECT MIN(price_nok) FROM services WHERE salon_id = s.id AND active = 1) AS min_price,
            (SELECT MIN(duration_min) FROM services WHERE salon_id = s.id AND active = 1) AS min_duration,
            (SELECT AVG(rating) FROM reviews WHERE salon_id = s.id AND hidden_at IS NULL) AS avg_rating,
            (SELECT COUNT(*) FROM reviews WHERE salon_id = s.id AND hidden_at IS NULL) AS review_count,
            (SELECT CASE WHEN sh.is_closed = 0 AND sh.open_at IS NOT NULL AND sh.close_at IS NOT NULL
                          AND ? BETWEEN sh.open_at AND sh.close_at
                         THEN 1 ELSE 0 END
               FROM salon_hours sh WHERE sh.salon_id = s.id AND sh.weekday = ?) AS is_open_now,
            (SELECT IF(
               sh2.is_closed = 0 AND sh2.open_at IS NOT NULL AND ? < sh2.open_at
               AND NOT EXISTS (SELECT 1 FROM salon_closures sc
                                WHERE sc.salon_id = s.id AND sc.closed_date = ?),
               DATE_FORMAT(sh2.open_at, '%H:%i'), NULL)
               FROM salon_hours sh2 WHERE sh2.salon_id = s.id AND sh2.weekday = ?) AS reopens_today
       FROM salons s
       ${qJoin}
      WHERE ${where.join(' AND ')}
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?`,
    [...selectParams, ...params, limit, offset]
  );

  // --- top_categories: distinct category names for active services, top 3. ---
  // One round-trip after the main query so the SELECT stays readable. Done in
  // a single IN-query and then folded into the rows.
  const ids = rows.map(r => r.id);
  const topCatsBy = new Map();
  const topTeamBy = new Map();
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const catRows = await query(
      `SELECT sv.salon_id, sc.name,
              COUNT(*) AS n
         FROM services sv
         JOIN service_categories sc ON sc.id = sv.category_id
        WHERE sv.salon_id IN (${placeholders})
          AND sv.active = 1
        GROUP BY sv.salon_id, sc.name
        ORDER BY sv.salon_id ASC, n DESC, sc.name ASC`,
      ids
    );
    for (const r of catRows) {
      if (!topCatsBy.has(r.salon_id)) topCatsBy.set(r.salon_id, []);
      const list = topCatsBy.get(r.salon_id);
      if (list.length < 3) list.push(r.name);
    }
    // top_team: aktive team-medlemmer (max 3 navn) pr salong.
    const teamRows = await query(
      `SELECT salon_id, name
         FROM team_members
        WHERE salon_id IN (${placeholders}) AND active = 1
        ORDER BY salon_id ASC, position ASC, id ASC`,
      ids
    );
    for (const r of teamRows) {
      if (!topTeamBy.has(r.salon_id)) topTeamBy.set(r.salon_id, []);
      const list = topTeamBy.get(r.salon_id);
      if (list.length < 3) list.push(r.name);
    }
  }

  // Drop created_at from the wire shape, normalize numbers, attach computed
  // fields. avg_rating gets rounded to 1 decimal; nulls stay nulls.
  const out = rows.map(({ created_at, ...rest }) => {
    const r = withCoverUrl(rest);
    // lat/lng kommer fra MySQL som DECIMAL → strings; cast til number for
    // klient-side avstandsberegning. Null hvis ikke geocodet.
    r.lat = r.lat != null ? Number(r.lat) : null;
    r.lng = r.lng != null ? Number(r.lng) : null;
    r.min_price = r.min_price != null ? Number(r.min_price) : null;
    r.min_duration = r.min_duration != null ? Number(r.min_duration) : null;
    r.avg_rating = r.avg_rating != null
      ? Math.round(Number(r.avg_rating) * 10) / 10
      : null;
    r.review_count = Number(r.review_count || 0);
    r.is_open_now = r.is_open_now === 1 || r.is_open_now === '1';
    // reopens_today is already 'HH:MM' or null from the SQL DATE_FORMAT, but
    // some drivers can return null as the string 'null' if column is computed
    // unusually; normalize defensively.
    if (r.reopens_today != null && typeof r.reopens_today !== 'string') {
      r.reopens_today = String(r.reopens_today);
    }
    r.top_categories = topCatsBy.get(r.id) || [];
    r.top_team = topTeamBy.get(r.id) || [];
    return r;
  });
  res.json({ salons: out, limit, offset, total });
}));

// GET /salons/:slug — public salon detail
router.get('/:slug', asyncRoute(async (req, res) => {
  const salon = await queryOne(
    `SELECT id, slug, name, city, address_line, postal_code, lat, lng, bio,
            instagram_url, tiktok_url, facebook_url, website_url,
            cover_image_key, public_phone_visible, accepts_new_bookings,
            public_email, public_phone,
            cancellation_lead_hours, booking_window_days,
            min_booking_lead_hours, booking_buffer_min,
            notify_email_new_booking, notify_email_cancellation,
            notify_email_daily_summary, notify_sms_new_booking,
            booking_confirmation_text, lunch_break_start, lunch_break_end,
            slot_interval_min, org_number,
            status
       FROM salons WHERE slug = ? LIMIT 1`,
    [req.params.slug]
  );
  if (!salon || salon.status !== 'active') {
    throw new HttpError(404, 'not_found', 'Salongen finnes ikke.');
  }
  // lat/lng come back from MySQL as strings (DECIMAL). Normalize to numbers
  // so the frontend can pass them straight to Leaflet without parsing.
  if (salon.lat != null) salon.lat = Number(salon.lat);
  if (salon.lng != null) salon.lng = Number(salon.lng);

  // Lazy backfill: if we have an address but no coords, kick off a geocode in
  // the background (no await). Next page load will pick up the persisted coords.
  if (salon.lat == null && salon.lng == null && (salon.address_line || salon.postal_code || salon.city)) {
    geocode(salon.address_line, salon.postal_code, salon.city)
      .then(coords => {
        if (!coords) return;
        return query(`UPDATE salons SET lat = ?, lng = ? WHERE id = ? AND lat IS NULL AND lng IS NULL`,
          [coords.lat, coords.lng, salon.id]);
      })
      .catch(() => { /* fail silently — coords stay NULL */ });
  }

  const [services, categories, images, hours, team, amenities, serviceTeamLinks, reviewSummaryRow, latestReviews, closures] = await Promise.all([
    query(
      `SELECT id, category_id, name, description, duration_min, price_nok, is_popular
         FROM services WHERE salon_id = ? AND active = 1 ORDER BY price_nok ASC`,
      [salon.id]
    ),
    query(
      `SELECT id, name, position
         FROM service_categories WHERE salon_id = ? ORDER BY position ASC, id ASC`,
      [salon.id]
    ),
    query(
      `SELECT id, image_key AS \`key\`, position, width, height
         FROM salon_images WHERE salon_id = ? ORDER BY position ASC, id ASC`,
      [salon.id]
    ),
    query(
      `SELECT weekday, is_closed, open_at, close_at
         FROM salon_hours WHERE salon_id = ? ORDER BY weekday ASC`,
      [salon.id]
    ),
    query(
      `SELECT id, name, role, bio, position, image_key
         FROM team_members WHERE salon_id = ? AND active = 1
         ORDER BY position ASC, id ASC`,
      [salon.id]
    ),
    query(
      `SELECT amenity FROM salon_amenities WHERE salon_id = ? ORDER BY amenity ASC`,
      [salon.id]
    ),
    query(
      `SELECT stm.service_id, stm.team_member_id
         FROM service_team_members stm
         JOIN services s ON s.id = stm.service_id
        WHERE s.salon_id = ?`,
      [salon.id]
    ),
    queryOne(
      `SELECT COUNT(*) AS count, AVG(rating) AS avg
         FROM reviews WHERE salon_id = ? AND hidden_at IS NULL`,
      [salon.id]
    ),
    // Latest 3 reviews inline for the public salon page. The full list lives
    // at GET /salons/:id/reviews.
    query(
      `SELECT r.id, r.rating, r.body, r.owner_reply, r.owner_reply_at, r.created_at,
              u.name AS customer_full_name
         FROM reviews r
         JOIN users u ON u.id = r.customer_user_id
        WHERE r.salon_id = ? AND r.hidden_at IS NULL
        ORDER BY r.created_at DESC
        LIMIT 3`,
      [salon.id]
    ),
    query(
      `SELECT closed_date, reason
         FROM salon_closures
        WHERE salon_id = ?
          AND closed_date >= CURDATE()
          AND closed_date < DATE_ADD(CURDATE(), INTERVAL 365 DAY)
        ORDER BY closed_date ASC`,
      [salon.id]
    ),
  ]);

  // Fold team-member ids into each service for client-side rendering.
  const linkMap = new Map();
  for (const l of serviceTeamLinks) {
    if (!linkMap.has(l.service_id)) linkMap.set(l.service_id, []);
    linkMap.get(l.service_id).push(l.team_member_id);
  }
  const servicesWithTeam = services.map(s => ({
    ...s,
    is_popular: !!s.is_popular,
    team_member_ids: linkMap.get(s.id) || [],
  }));

  res.json({
    salon: withCoverUrl(salon),
    services: servicesWithTeam,
    categories,
    images: images.map(i => Object.assign({}, i, variantUrls(i.key, storage.publicUrl))),
    hours,
    team: team.map(m => ({ ...m, image_url: m.image_key ? storage.publicUrl(m.image_key) : null })),
    amenities: amenities.map(a => a.amenity),
    reviews: {
      count: Number(reviewSummaryRow?.count || 0),
      // Round to 1 decimal so the client doesn't have to format it twice.
      avg: reviewSummaryRow?.avg != null ? Math.round(Number(reviewSummaryRow.avg) * 10) / 10 : null,
      // Latest 3 reviews with masked customer name ("Firstname L."). The full
      // list (paginated) is available at GET /salons/:id/reviews.
      latest: latestReviews.map(r => ({
        id: r.id,
        rating: r.rating,
        body: r.body,
        owner_reply: r.owner_reply,
        owner_reply_at: r.owner_reply_at,
        customer_name: (function (name) {
          const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
          if (!parts.length) return 'Anonym';
          if (parts.length === 1) return parts[0];
          const last = parts[parts.length - 1];
          return parts[0] + ' ' + last.charAt(0).toUpperCase() + '.';
        })(r.customer_full_name),
        created_at: r.created_at,
      })),
    },
    closures: closures.map(c => ({
      // Serialize as YYYY-MM-DD (DATE columns come back as a Date object).
      date: c.closed_date instanceof Date
        ? c.closed_date.toISOString().slice(0, 10)
        : String(c.closed_date).slice(0, 10),
      reason: c.reason || null,
    })),
  });
}));

// GET /salons/me/own — salon owned by the logged-in user (first one)
router.get('/me/own', requireAuth, asyncRoute(async (req, res) => {
  const salon = await queryOne(
    `SELECT id, slug, name, city, address_line, postal_code, bio,
            instagram_url, tiktok_url, facebook_url, website_url,
            cover_image_key, public_phone_visible, accepts_new_bookings,
            public_email, public_phone,
            cancellation_lead_hours, booking_window_days,
            min_booking_lead_hours, booking_buffer_min,
            notify_email_new_booking, notify_email_cancellation,
            notify_email_daily_summary, notify_sms_new_booking,
            booking_confirmation_text, lunch_break_start, lunch_break_end,
            onboarding_skipped,
            slot_interval_min, org_number,
            subscription_status, subscription_price_nok,
            trial_ends_at, subscription_started_at, subscription_cancelled_at,
            suspension_reason, suspended_at,
            status
       FROM salons WHERE owner_user_id = ? AND status != 'deleted'
       ORDER BY created_at ASC LIMIT 1`,
    [req.user.id]
  );
  if (!salon) throw new HttpError(404, 'no_salon', 'Du har ingen salong.');

  const [images, hours, team, amenities, categories, closures, servicesCountRow] = await Promise.all([
    query(
      `SELECT id, image_key AS \`key\`, position, width, height
         FROM salon_images WHERE salon_id = ? ORDER BY position ASC, id ASC`,
      [salon.id]
    ),
    query(
      `SELECT weekday, is_closed, open_at, close_at
         FROM salon_hours WHERE salon_id = ? ORDER BY weekday ASC`,
      [salon.id]
    ),
    query(
      `SELECT id, name, role, bio, active, position, image_key,
              email, phone, notify_email_bookings, notify_sms_bookings
         FROM team_members WHERE salon_id = ? ORDER BY position ASC, id ASC`,
      [salon.id]
    ),
    query(
      `SELECT amenity FROM salon_amenities WHERE salon_id = ? ORDER BY amenity ASC`,
      [salon.id]
    ),
    query(
      `SELECT id, name, position
         FROM service_categories WHERE salon_id = ? ORDER BY position ASC, id ASC`,
      [salon.id]
    ),
    query(
      `SELECT id, closed_date, reason
         FROM salon_closures
        WHERE salon_id = ?
          AND closed_date >= CURDATE()
          AND closed_date < DATE_ADD(CURDATE(), INTERVAL 365 DAY)
        ORDER BY closed_date ASC`,
      [salon.id]
    ),
    queryOne(
      `SELECT COUNT(*) AS n FROM services WHERE salon_id = ? AND active = 1`,
      [salon.id]
    ),
  ]);

  // Compute onboarding state. Each flag mirrors one row in the checklist UI.
  // has_booking_rules is always true — the salon row has defaults from schema.
  const onboarding = (function () {
    const hasCoverImage = !!salon.cover_image_key;
    const hasBio        = !!(salon.bio && String(salon.bio).trim().length > 0);
    const hasHours      = hours.some(h => h.is_closed === 0 || h.is_closed === false);
    const hasServices   = !!(servicesCountRow && Number(servicesCountRow.n) >= 1);
    const hasTeam       = team.some(m => m.active === 1 || m.active === true);
    const hasAmenities  = amenities.length >= 1;
    const hasBookingRules = true;
    const flags = [hasCoverImage, hasBio, hasHours, hasServices, hasTeam, hasAmenities];
    const completedCount = flags.filter(Boolean).length;
    return {
      has_cover_image: hasCoverImage,
      has_bio: hasBio,
      has_hours: hasHours,
      has_services: hasServices,
      has_team: hasTeam,
      has_amenities: hasAmenities,
      has_booking_rules: hasBookingRules,
      completed_count: completedCount,
      is_complete: completedCount >= 5,
      skipped: !!salon.onboarding_skipped,
    };
  })();

  // Don't expose the raw column on the salon object — it's surfaced via
  // onboarding.skipped above.
  const { onboarding_skipped: _omit, ...salonOut } = salon;

  res.json({
    salon: withCoverUrl(salonOut),
    images: images.map(i => Object.assign({}, i, variantUrls(i.key, storage.publicUrl))),
    hours,
    team: team.map(m => ({
      ...m,
      image_url: m.image_key ? storage.publicUrl(m.image_key) : null,
      notify_email_bookings: !!m.notify_email_bookings,
      notify_sms_bookings: !!m.notify_sms_bookings,
    })),
    amenities: amenities.map(a => a.amenity),
    categories,
    onboarding,
    closures: closures.map(c => ({
      id: c.id,
      date: c.closed_date instanceof Date
        ? c.closed_date.toISOString().slice(0, 10)
        : String(c.closed_date).slice(0, 10),
      reason: c.reason || null,
    })),
  });
}));

// PATCH /salons/:id — owner edits their salon
router.patch('/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');

  // "HH:MM" or "HH:MM:SS" — used by lunch_break_*.
  const timeStr = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Forventet HH:MM');
  const schema = z.object({
    name: z.string().trim().min(1).max(255).optional(),
    bio: z.string().trim().max(4000).nullable().optional(),
    address_line: z.string().trim().max(255).nullable().optional(),
    postal_code: z.string().trim().max(16).nullable().optional(),
    city: z.string().trim().min(1).max(128).optional(),
    instagram_url: lazyUrl().optional(),
    tiktok_url: lazyUrl().optional(),
    facebook_url: lazyUrl().optional(),
    website_url: lazyUrl().optional(),
    public_phone_visible: z.boolean().optional(),
    accepts_new_bookings: z.boolean().optional(),
    // Salongens egen e-post + telefon (separat fra eier-kontoen).
    // Tom streng → null så feltet ryddes.
    public_email: z.preprocess(
      v => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().trim().email('Ugyldig e-postadresse').max(255).nullable()
    ).optional(),
    public_phone: z.preprocess(
      v => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().trim().max(32).nullable()
    ).optional(),
    cancellation_lead_hours: z.number().int().min(0).max(168).optional(),
    booking_window_days: z.number().int().min(1).max(180).optional(),
    min_booking_lead_hours: z.number().int().min(0).max(168).optional(),
    booking_buffer_min: z.number().int().min(0).max(60).optional(),
    notify_email_new_booking: z.boolean().optional(),
    notify_email_cancellation: z.boolean().optional(),
    notify_email_daily_summary: z.boolean().optional(),
    notify_sms_new_booking: z.boolean().optional(),
    booking_confirmation_text: z.string().trim().max(1000).nullable().optional(),
    lunch_break_start: timeStr.nullable().optional(),
    lunch_break_end: timeStr.nullable().optional(),
    slot_interval_min: z.number().int().refine(v => [15, 30, 60].includes(v), {
      message: 'Slot-intervall må være 15, 30 eller 60 minutter.',
    }).optional(),
    org_number: z.string().trim().max(20).nullable().optional(),
  });
  const patch = schema.parse(req.body);

  // Lunch break: enforce "both set or both null". We allow patching just one of
  // the fields only when the OTHER field's current DB value is consistent with
  // the result; otherwise reject up-front so the panel can't half-save a window.
  const hasStart = Object.prototype.hasOwnProperty.call(patch, 'lunch_break_start');
  const hasEnd   = Object.prototype.hasOwnProperty.call(patch, 'lunch_break_end');
  if (hasStart || hasEnd) {
    const current = await queryOne(
      `SELECT lunch_break_start, lunch_break_end FROM salons WHERE id = ?`, [id]
    );
    const nextStart = hasStart ? patch.lunch_break_start : current?.lunch_break_start ?? null;
    const nextEnd   = hasEnd   ? patch.lunch_break_end   : current?.lunch_break_end   ?? null;
    const startEmpty = nextStart == null || nextStart === '';
    const endEmpty   = nextEnd   == null || nextEnd   === '';
    if (startEmpty !== endEmpty) {
      throw new HttpError(400, 'lunch_break_incomplete',
        'Både start og slutt på lunsjpausen må fylles ut, eller begge være tomme.');
    }
    if (!startEmpty && !endEmpty) {
      // Compare as "HH:MM" — DB TIME comes back as "HH:MM:SS"; normalize.
      const s = String(nextStart).slice(0, 5);
      const e = String(nextEnd).slice(0, 5);
      if (s >= e) {
        throw new HttpError(400, 'lunch_break_invalid',
          'Lunsjpausen må starte før den slutter.');
      }
    }
  }

  const salon = await queryOne(`SELECT owner_user_id, status FROM salons WHERE id = ?`, [id]);
  if (!salon) throw new HttpError(404, 'not_found', 'Salongen finnes ikke.');
  if (req.user.role !== 'admin' && salon.owner_user_id !== req.user.id) {
    throw new HttpError(403, 'forbidden', 'Du eier ikke denne salongen.');
  }

  // If the owner edited address_line / postal_code / city, re-geocode and stash
  // lat/lng alongside the rest of the update. Done synchronously inside the
  // request because the cost is small (Nominatim usually replies < 1s) and we
  // want next page load to render the map immediately. Failures degrade to
  // (null, null) so an upstream outage doesn't block saving the address.
  const addressTouched =
    Object.prototype.hasOwnProperty.call(patch, 'address_line') ||
    Object.prototype.hasOwnProperty.call(patch, 'postal_code') ||
    Object.prototype.hasOwnProperty.call(patch, 'city');
  if (addressTouched) {
    const current = await queryOne(
      `SELECT address_line, postal_code, city FROM salons WHERE id = ?`, [id]
    );
    const nextAddr   = Object.prototype.hasOwnProperty.call(patch, 'address_line') ? patch.address_line : current?.address_line ?? null;
    const nextPostal = Object.prototype.hasOwnProperty.call(patch, 'postal_code')  ? patch.postal_code  : current?.postal_code  ?? null;
    const nextCity   = Object.prototype.hasOwnProperty.call(patch, 'city')         ? patch.city         : current?.city         ?? null;
    const coords = await geocode(nextAddr, nextPostal, nextCity);
    // Always assign so a moved salon doesn't keep stale coords. Null on miss.
    patch.lat = coords ? coords.lat : null;
    patch.lng = coords ? coords.lng : null;
  }

  const fields = Object.keys(patch);
  if (fields.length === 0) return res.json({ ok: true });
  const setClause = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => {
    const v = patch[f];
    if (typeof v === 'boolean') return v ? 1 : 0;
    // Empty string on a nullable column → NULL (esp. for lunch_break_*).
    if (v === '') return null;
    return v;
  });
  values.push(id);
  await query(`UPDATE salons SET ${setClause} WHERE id = ?`, values);
  res.json({ ok: true });
}));

// POST /salons/:id/onboarding/skip — owner dismisses the onboarding checklist
// shown on the Dashboard tab of /salong-panel.html. Idempotent: subsequent
// calls are no-ops. Once set, the card never re-renders even if the underlying
// state changes (e.g. owner deletes their bio later).
router.post('/:id/onboarding/skip', requireAuth, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  const salon = await queryOne(
    `SELECT owner_user_id FROM salons WHERE id = ?`, [id]
  );
  if (!salon) throw new HttpError(404, 'not_found', 'Salongen finnes ikke.');
  if (req.user.role !== 'admin' && salon.owner_user_id !== req.user.id) {
    throw new HttpError(403, 'forbidden', 'Du eier ikke denne salongen.');
  }
  await query(`UPDATE salons SET onboarding_skipped = 1 WHERE id = ?`, [id]);
  res.json({ ok: true });
}));

// --- services on a salon ---

router.get('/:id/services', asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  // Owners / admins see all services (incl. hidden); the public sees only active ones.
  const salon = await queryOne(`SELECT owner_user_id FROM salons WHERE id = ?`, [id]);
  if (!salon) throw new HttpError(404, 'not_found', 'Salongen finnes ikke.');
  const isOwner = req.user && (req.user.role === 'admin' || salon.owner_user_id === req.user.id);
  const activeFilter = isOwner ? '' : 'AND active = 1';
  const [rows, links] = await Promise.all([
    query(
      `SELECT id, category_id, name, description, duration_min, price_nok, is_popular, active,
              fiken_vat_code, fiken_product_id
         FROM services WHERE salon_id = ? ${activeFilter} ORDER BY price_nok ASC`,
      [id]
    ),
    query(
      `SELECT stm.service_id, stm.team_member_id
         FROM service_team_members stm
         JOIN services s ON s.id = stm.service_id
        WHERE s.salon_id = ?`,
      [id]
    ),
  ]);
  const linkMap = new Map();
  for (const l of links) {
    if (!linkMap.has(l.service_id)) linkMap.set(l.service_id, []);
    linkMap.get(l.service_id).push(l.team_member_id);
  }
  res.json({
    services: rows.map(r => ({
      ...r,
      is_popular: !!r.is_popular,
      team_member_ids: linkMap.get(r.id) || [],
    })),
  });
}));

router.post('/:id/services', requireAuth, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');

  const salon = await queryOne(`SELECT owner_user_id FROM salons WHERE id = ?`, [id]);
  if (!salon) throw new HttpError(404, 'not_found', 'Salongen finnes ikke.');
  if (req.user.role !== 'admin' && salon.owner_user_id !== req.user.id) {
    throw new HttpError(403, 'forbidden', 'Du eier ikke denne salongen.');
  }

  const schema = z.object({
    name: z.string().trim().min(1).max(255),
    description: z.string().trim().max(2000).nullable().optional(),
    duration_min: z.number().int().positive().max(600),
    price_nok: z.number().int().nonnegative().max(100000),
    active: z.boolean().optional(),
    category_id: z.number().int().positive().nullable().optional(),
    is_popular: z.boolean().optional(),
    // Fiken-mapping: MVA-kode + ev. produkt-id i Fiken-katalogen.
    fiken_vat_code:   z.string().trim().max(16).nullable().optional(),
    fiken_product_id: z.number().int().nonnegative().nullable().optional(),
  });
  const data = schema.parse(req.body);

  // Validate the category belongs to this salon (when provided).
  if (data.category_id != null) {
    const cat = await queryOne(
      `SELECT id FROM service_categories WHERE id = ? AND salon_id = ?`,
      [data.category_id, id]
    );
    if (!cat) throw new HttpError(400, 'bad_category', 'Ugyldig kategori.');
  }

  // Cap of 3 popular services per salon.
  if (data.is_popular) {
    const popRow = await queryOne(
      `SELECT COUNT(*) AS n FROM services WHERE salon_id = ? AND is_popular = 1`,
      [id]
    );
    if (Number(popRow.n) >= 3) {
      throw new HttpError(409, 'too_many_popular', 'Du kan maks ha 3 populære behandlinger.');
    }
  }

  const result = await query(
    `INSERT INTO services (salon_id, category_id, name, description, duration_min, price_nok,
                           active, is_popular, fiken_vat_code, fiken_product_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.category_id ?? null,
      data.name,
      data.description ?? null,
      data.duration_min,
      data.price_nok,
      data.active === false ? 0 : 1,
      data.is_popular ? 1 : 0,
      data.fiken_vat_code ?? null,
      data.fiken_product_id ?? null,
    ]
  );
  res.status(201).json({ id: result.insertId });
}));

router.patch('/:salonId/services/:serviceId', requireAuth, asyncRoute(async (req, res) => {
  const salonId = parseInt(req.params.salonId, 10);
  const serviceId = parseInt(req.params.serviceId, 10);
  if (!Number.isFinite(salonId) || !Number.isFinite(serviceId)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');

  const service = await queryOne(
    `SELECT s.id, s.salon_id, sa.owner_user_id
       FROM services s JOIN salons sa ON sa.id = s.salon_id
      WHERE s.id = ? AND s.salon_id = ?`,
    [serviceId, salonId]
  );
  if (!service) throw new HttpError(404, 'not_found', 'Tjenesten finnes ikke.');
  if (req.user.role !== 'admin' && service.owner_user_id !== req.user.id) {
    throw new HttpError(403, 'forbidden', 'Du eier ikke denne salongen.');
  }

  const schema = z.object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    duration_min: z.number().int().positive().max(600).optional(),
    price_nok: z.number().int().nonnegative().max(100000).optional(),
    active: z.boolean().optional(),
    category_id: z.number().int().positive().nullable().optional(),
    is_popular: z.boolean().optional(),
    // Fiken-mapping: MVA-kode + ev. produkt-id i Fiken-katalogen.
    fiken_vat_code:   z.string().trim().max(16).nullable().optional(),
    fiken_product_id: z.number().int().nonnegative().nullable().optional(),
  });
  const patch = schema.parse(req.body);

  // If category_id is being set, validate it belongs to this salon.
  if (patch.category_id != null) {
    const cat = await queryOne(
      `SELECT id FROM service_categories WHERE id = ? AND salon_id = ?`,
      [patch.category_id, salonId]
    );
    if (!cat) throw new HttpError(400, 'bad_category', 'Ugyldig kategori.');
  }

  // Enforce the 3-popular cap when toggling on (and the service isn't already popular).
  if (patch.is_popular === true) {
    const current = await queryOne(
      `SELECT is_popular FROM services WHERE id = ?`,
      [serviceId]
    );
    if (current && !current.is_popular) {
      const popRow = await queryOne(
        `SELECT COUNT(*) AS n FROM services WHERE salon_id = ? AND is_popular = 1`,
        [salonId]
      );
      if (Number(popRow.n) >= 3) {
        throw new HttpError(409, 'too_many_popular', 'Du kan maks ha 3 populære behandlinger.');
      }
    }
  }

  const fields = Object.keys(patch);
  if (fields.length === 0) return res.json({ ok: true });
  const setClause = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => {
    if (f === 'active' || f === 'is_popular') return patch[f] ? 1 : 0;
    return patch[f];
  });
  values.push(serviceId);
  await query(`UPDATE services SET ${setClause} WHERE id = ?`, values);
  res.json({ ok: true });
}));

router.delete('/:salonId/services/:serviceId', requireAuth, asyncRoute(async (req, res) => {
  const salonId = parseInt(req.params.salonId, 10);
  const serviceId = parseInt(req.params.serviceId, 10);
  if (!Number.isFinite(salonId) || !Number.isFinite(serviceId)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');

  const service = await queryOne(
    `SELECT s.id, sa.owner_user_id
       FROM services s JOIN salons sa ON sa.id = s.salon_id
      WHERE s.id = ? AND s.salon_id = ?`,
    [serviceId, salonId]
  );
  if (!service) throw new HttpError(404, 'not_found', 'Tjenesten finnes ikke.');
  if (req.user.role !== 'admin' && service.owner_user_id !== req.user.id) {
    throw new HttpError(403, 'forbidden', 'Du eier ikke denne salongen.');
  }

  // Soft-deactivate to preserve booking history.
  await query(`UPDATE services SET active = 0 WHERE id = ?`, [serviceId]);
  res.json({ ok: true });
}));

// --- service categories on a salon ---
// Used by the owner panel to group services. Public salon detail also returns
// the category list so the frontend can render services grouped by category.

const MAX_CATEGORIES_PER_SALON = 20;

async function loadSalonOrThrow(id) {
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  const salon = await queryOne(`SELECT id, owner_user_id FROM salons WHERE id = ?`, [id]);
  if (!salon) throw new HttpError(404, 'not_found', 'Salongen finnes ikke.');
  return salon;
}

function requireOwner(req, salon) {
  if (req.user.role !== 'admin' && salon.owner_user_id !== req.user.id) {
    throw new HttpError(403, 'forbidden', 'Du eier ikke denne salongen.');
  }
}

router.get('/:id/categories', asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  const rows = await query(
    `SELECT id, name, position FROM service_categories WHERE salon_id = ? ORDER BY position ASC, id ASC`,
    [id]
  );
  res.json({ categories: rows });
}));

router.post('/:id/categories', requireAuth, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const salon = await loadSalonOrThrow(id);
  requireOwner(req, salon);

  const data = z.object({
    name: z.string().trim().min(1).max(255),
  }).parse(req.body || {});

  const countRow = await queryOne(
    `SELECT COUNT(*) AS n FROM service_categories WHERE salon_id = ?`,
    [id]
  );
  if (Number(countRow.n) >= MAX_CATEGORIES_PER_SALON) {
    throw new HttpError(409, 'too_many_categories', `Maks ${MAX_CATEGORIES_PER_SALON} kategorier.`);
  }

  const result = await query(
    `INSERT INTO service_categories (salon_id, name, position) VALUES (?, ?, ?)`,
    [id, data.name, Number(countRow.n)]
  );
  res.status(201).json({ id: result.insertId });
}));

router.patch('/:id/categories/:catId', requireAuth, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const catId = parseInt(req.params.catId, 10);
  if (!Number.isFinite(catId)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  const salon = await loadSalonOrThrow(id);
  requireOwner(req, salon);

  const cat = await queryOne(
    `SELECT id FROM service_categories WHERE id = ? AND salon_id = ?`,
    [catId, id]
  );
  if (!cat) throw new HttpError(404, 'not_found', 'Kategorien finnes ikke.');

  const data = z.object({
    name: z.string().trim().min(1).max(255),
  }).parse(req.body || {});

  await query(`UPDATE service_categories SET name = ? WHERE id = ?`, [data.name, catId]);
  res.json({ ok: true });
}));

router.delete('/:id/categories/:catId', requireAuth, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const catId = parseInt(req.params.catId, 10);
  if (!Number.isFinite(catId)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  const salon = await loadSalonOrThrow(id);
  requireOwner(req, salon);

  const cat = await queryOne(
    `SELECT id FROM service_categories WHERE id = ? AND salon_id = ?`,
    [catId, id]
  );
  if (!cat) throw new HttpError(404, 'not_found', 'Kategorien finnes ikke.');

  // FK ON DELETE SET NULL will detach any services from this category.
  await query(`DELETE FROM service_categories WHERE id = ?`, [catId]);
  res.json({ ok: true });
}));

router.put('/:id/categories/order', requireAuth, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const salon = await loadSalonOrThrow(id);
  requireOwner(req, salon);

  const data = z.object({
    order: z.array(z.number().int().positive()).max(MAX_CATEGORIES_PER_SALON),
  }).parse(req.body || {});

  if (!data.order.length) return res.json({ ok: true });

  // Filter to ids that belong to this salon so we never reorder another salon's rows.
  const placeholders = data.order.map(() => '?').join(',');
  const valid = await query(
    `SELECT id FROM service_categories WHERE salon_id = ? AND id IN (${placeholders})`,
    [id, ...data.order]
  );
  const validSet = new Set(valid.map(r => r.id));

  await tx(async (conn) => {
    let pos = 0;
    for (const catId of data.order) {
      if (!validSet.has(catId)) continue;
      await conn.execute(
        `UPDATE service_categories SET position = ? WHERE id = ?`,
        [pos, catId]
      );
      pos += 1;
    }
  });
  res.json({ ok: true });
}));

// GET /salons/:id/availability — public; returns busy windows for the next 30
// days so clients can hide/disable taken slots. We emit three kinds of busy
// windows: real bookings (pending/confirmed), the daily lunch break, and any
// closures that fall inside the window. The client-side renderer treats all
// three identically — anything that overlaps a slot greys it out.
//
// Optional `?team_member_id=` scopes the booking windows to a single stylist's
// calendar: their bookings + salon-wide bookings (team_member_id IS NULL).
// Lunch break + closures stay salon-wide (they affect everyone).
router.get('/:id/availability', asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');

  const rawTeam = req.query.team_member_id;
  const teamMemberId = (rawTeam != null && rawTeam !== '')
    ? (Number.isFinite(parseInt(rawTeam, 10)) ? parseInt(rawTeam, 10) : null)
    : null;

  // Build the bookings query with optional per-stylist scoping. When
  // teamMemberId is set we still surface salon-wide bookings (the rows that
  // have team_member_id IS NULL — they consume the whole salon's calendar).
  const bookingSql = teamMemberId != null
    ? `SELECT start_at, end_at FROM bookings
        WHERE salon_id = ?
          AND status IN ('pending','confirmed')
          AND end_at >= NOW()
          AND start_at < DATE_ADD(NOW(), INTERVAL 30 DAY)
          AND (team_member_id = ? OR team_member_id IS NULL)
        ORDER BY start_at ASC`
    : `SELECT start_at, end_at FROM bookings
        WHERE salon_id = ?
          AND status IN ('pending','confirmed')
          AND end_at >= NOW()
          AND start_at < DATE_ADD(NOW(), INTERVAL 30 DAY)
        ORDER BY start_at ASC`;
  const bookingParams = teamMemberId != null ? [id, teamMemberId] : [id];

  const [bookingRows, salon, closures] = await Promise.all([
    query(bookingSql, bookingParams),
    queryOne(
      `SELECT lunch_break_start, lunch_break_end FROM salons WHERE id = ?`,
      [id]
    ),
    query(
      `SELECT closed_date FROM salon_closures
        WHERE salon_id = ?
          AND closed_date >= CURDATE()
          AND closed_date < DATE_ADD(CURDATE(), INTERVAL 30 DAY)`,
      [id]
    ),
  ]);

  const busy = bookingRows.map(r => ({ start_at: r.start_at, end_at: r.end_at }));

  // Format helpers — emit local "YYYY-MM-DDTHH:MM:SS" strings. The frontend
  // parses these via `new Date()`, which interprets a string without a "Z" or
  // offset as local time. That matches how real booking start_at values are
  // produced by MySQL ("YYYY-MM-DD HH:MM:SS" → also local in JS).
  function toLocalIso(d, hhmm) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}T${hhmm}`;
  }

  // Lunch break synthetic windows — one per day in the 30-day visible window.
  if (salon && salon.lunch_break_start && salon.lunch_break_end) {
    const start = String(salon.lunch_break_start).slice(0, 8); // HH:MM:SS
    const end = String(salon.lunch_break_end).slice(0, 8);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = 0; i < 30; i++) {
      const d = new Date(today); d.setDate(d.getDate() + i);
      busy.push({
        start_at: toLocalIso(d, start),
        end_at: toLocalIso(d, end),
      });
    }
  }

  // Closures: emit a 00:00:00 → 23:59:59 window covering the whole day.
  for (const c of closures) {
    const d = c.closed_date instanceof Date
      ? c.closed_date
      : new Date(String(c.closed_date));
    busy.push({
      start_at: toLocalIso(d, '00:00:00'),
      end_at: toLocalIso(d, '23:59:59'),
    });
  }

  res.json({ busy });
}));

// ---- Closures (vacation / holiday days) ----------------------------------
// Owner-managed list of dates the salon is closed. Public GET so the salon
// page can grey out those days in the day-picker. POST/DELETE are owner-only.

// GET /salons/:id/closures — public; next 365 days.
router.get('/:id/closures', asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  const rows = await query(
    `SELECT id, closed_date, reason
       FROM salon_closures
      WHERE salon_id = ?
        AND closed_date >= CURDATE()
        AND closed_date < DATE_ADD(CURDATE(), INTERVAL 365 DAY)
      ORDER BY closed_date ASC`,
    [id]
  );
  res.json({
    closures: rows.map(r => ({
      id: r.id,
      date: r.closed_date instanceof Date
        ? r.closed_date.toISOString().slice(0, 10)
        : String(r.closed_date).slice(0, 10),
      reason: r.reason || null,
    })),
  });
}));

// POST /salons/:id/closures — owner adds a closure date.
router.post('/:id/closures', requireAuth, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const salon = await loadSalonOrThrow(id);
  requireOwner(req, salon);

  const data = z.object({
    closed_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Forventet YYYY-MM-DD'),
    reason: z.string().trim().max(255).nullable().optional(),
  }).parse(req.body || {});

  // Reject past dates. Compare as local YYYY-MM-DD strings so the boundary is
  // crisp (no timezone surprises from `new Date(YYYY-MM-DD)` interpreting as
  // UTC midnight).
  const todayStr = (() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  })();
  if (data.closed_date < todayStr) {
    throw new HttpError(400, 'past_date', 'Datoen må være i dag eller senere.');
  }

  try {
    const result = await query(
      `INSERT INTO salon_closures (salon_id, closed_date, reason) VALUES (?, ?, ?)`,
      [id, data.closed_date, data.reason || null]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    // Duplicate (salon_id, closed_date) → already closed.
    if (err && err.code === 'ER_DUP_ENTRY') {
      throw new HttpError(409, 'already_closed', 'Denne datoen er allerede markert som stengt.');
    }
    throw err;
  }
}));

// GET /salons/:id/waitlist — owner-only. Lists waitlist entries for this salon
// so the panel can show who's queued for which slot. We don't expose the
// requester's email here; the owner contacts them via the existing "varsle"
// flow when a slot opens up (the auto-promotion on cancel/no_show handles that).
router.get('/:id/waitlist', requireAuth, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const salon = await loadSalonOrThrow(id);
  requireOwner(req, salon);

  const rows = await query(
    `SELECT w.id, w.desired_start, w.status, w.notified_at, w.created_at,
            w.expires_at,
            u.name AS user_name,
            sv.name AS service_name,
            tm.name AS team_member_name
       FROM waitlist_entries w
       JOIN users u    ON u.id  = w.user_id
       JOIN services sv ON sv.id = w.service_id
       LEFT JOIN team_members tm ON tm.id = w.team_member_id
      WHERE w.salon_id = ?
        AND w.status IN ('waiting','ready')
      ORDER BY w.desired_start ASC, w.created_at ASC
      LIMIT 200`,
    [id]
  );
  res.json({ entries: rows });
}));

// DELETE /salons/:id/closures/:closureId — owner removes a closure.
router.delete('/:id/closures/:closureId', requireAuth, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const closureId = parseInt(req.params.closureId, 10);
  if (!Number.isFinite(closureId)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  const salon = await loadSalonOrThrow(id);
  requireOwner(req, salon);

  const row = await queryOne(
    `SELECT id FROM salon_closures WHERE id = ? AND salon_id = ?`,
    [closureId, id]
  );
  if (!row) throw new HttpError(404, 'not_found', 'Stengt dag finnes ikke.');
  await query(`DELETE FROM salon_closures WHERE id = ?`, [closureId]);
  res.json({ ok: true });
}));

module.exports = router;
