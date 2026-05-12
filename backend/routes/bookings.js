const express = require('express');
const { z } = require('zod');
const { query, queryOne, tx } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute, HttpError } = require('../lib/util');
const config = require('../config');
const notify = require('../lib/notify');
const { ensureThread } = require('./chat');

const router = express.Router();

// Audit-log helper — fire-and-forget; never block the response on failure.
// (Same shape as the helper in routes/admin.js, duplicated locally so that file
// doesn't have to export it.)
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

// validateSlot — shared booking-time validation for create + reschedule.
//
// Throws HttpError on any rule violation; otherwise returns { endAt } where
// endAt is the computed end timestamp (Date) for the slot.
//
// The salon/service args must already have been loaded by the caller; this
// function does not re-fetch them. The optional `excludeBookingId` lets the
// reschedule endpoint avoid colliding with the booking row being moved.
//
// Per-stylist scoping (teamMemberId):
//   - When set, conflict check only looks at bookings with the same
//     team_member_id OR legacy salon-wide rows where team_member_id IS NULL
//     (the latter still consume the whole salon's calendar).
//   - When null, this is a salon-wide booking and conflicts with ANY live
//     booking at the salon (current behavior).
async function validateSlot({ salon, service, startAt, excludeBookingId, teamMemberId, conn }) {
  if (Number.isNaN(startAt.getTime())) {
    throw new HttpError(400, 'bad_start_at', 'Ugyldig start-tidspunkt.');
  }
  if (startAt.getTime() < Date.now()) {
    throw new HttpError(400, 'past_start', 'Start må være i framtiden.');
  }

  // Closure check — reject if the start date is on a closed day.
  const startDateStr = (() => {
    const y = startAt.getFullYear();
    const m = String(startAt.getMonth() + 1).padStart(2, '0');
    const d = String(startAt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  })();
  const closure = await queryOne(
    `SELECT id FROM salon_closures WHERE salon_id = ? AND closed_date = ?`,
    [salon.id, startDateStr]
  );
  if (closure) {
    throw new HttpError(409, 'salon_closed', 'Salongen er stengt denne dagen.');
  }

  // Per-weekday opening-hours enforcement; see POST /bookings for full context.
  const osloParts = (() => {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Oslo',
      weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      hour12: false,
    });
    const parts = {};
    fmt.formatToParts(startAt).forEach(p => { parts[p.type] = p.value; });
    const wdMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    return {
      weekday: wdMap[parts.weekday] || 0,
      hh: parts.hour === '24' ? 0 : parseInt(parts.hour, 10),
      mm: parseInt(parts.minute, 10),
    };
  })();
  const startMinutes = osloParts.hh * 60 + osloParts.mm;
  const endMinutes = startMinutes + service.duration_min;

  const hoursRow = await queryOne(
    `SELECT is_closed, open_at, close_at
       FROM salon_hours WHERE salon_id = ? AND weekday = ?`,
    [salon.id, osloParts.weekday]
  );
  if (hoursRow) {
    if (hoursRow.is_closed) {
      throw new HttpError(409, 'salon_closed_weekday', 'Salongen er stengt denne dagen.');
    }
    const toMin = (t) => {
      if (!t) return null;
      const m = String(t).match(/^(\d{2}):(\d{2})/);
      return m ? (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) : null;
    };
    const openMin = toMin(hoursRow.open_at);
    const closeMin = toMin(hoursRow.close_at);
    if (openMin != null && closeMin != null) {
      if (startMinutes < openMin || endMinutes > closeMin) {
        throw new HttpError(409, 'outside_hours', 'Tidspunktet er utenfor salongens åpningstider.');
      }
    }
  }

  // Lead time + booking window.
  const nowMs = Date.now();
  const startMs = startAt.getTime();
  const minLeadHours = Number(salon.min_booking_lead_hours) || 0;
  const windowDays = Number(salon.booking_window_days) || 30;
  const bufferMin = Number(salon.booking_buffer_min) || 0;
  if ((startMs - nowMs) < minLeadHours * 3_600_000) {
    throw new HttpError(409, 'booking_too_soon',
      `Du må bestille minst ${minLeadHours} timer før timen.`);
  }
  if ((startMs - nowMs) > windowDays * 86_400_000) {
    throw new HttpError(409, 'booking_too_far',
      `Du kan bare bestille opptil ${windowDays} dager fram i tid.`);
  }

  const endAt = new Date(startAt.getTime() + service.duration_min * 60_000);

  // Lunch break overlap.
  if (salon.lunch_break_start && salon.lunch_break_end) {
    const ls = String(salon.lunch_break_start).slice(0, 8).split(':');
    const le = String(salon.lunch_break_end).slice(0, 8).split(':');
    const lunchStart = new Date(startAt); lunchStart.setHours(+ls[0], +ls[1], +(ls[2] || 0), 0);
    const lunchEnd = new Date(startAt);   lunchEnd.setHours(+le[0], +le[1], +(le[2] || 0), 0);
    if (startAt < lunchEnd && endAt > lunchStart) {
      throw new HttpError(409, 'lunch_break', 'Tidspunktet kolliderer med salongens lunsjpause.');
    }
  }

  // Overlap check — must be performed under the same transaction/lock as the
  // INSERT/UPDATE that follows. The caller passes its `conn` so the SELECT ...
  // FOR UPDATE locks the same rows that the write touches.
  const overlapStart = new Date(startAt.getTime() - bufferMin * 60_000);
  const overlapEnd = new Date(endAt.getTime() + bufferMin * 60_000);

  // Per-stylist scoping: if teamMemberId is set, only conflict with bookings
  // for that stylist OR legacy salon-wide rows (team_member_id IS NULL).
  // If teamMemberId is null, this booking is salon-wide → conflict with any
  // live booking at the salon (preserves pre-stylist behavior).
  const teamClause = teamMemberId != null
    ? 'AND (team_member_id = ? OR team_member_id IS NULL)'
    : '';
  const sql = `SELECT id FROM bookings
    WHERE salon_id = ?
      AND status IN ('pending','confirmed')
      AND start_at < ?
      AND end_at   > ?
      ${teamClause}
      ${excludeBookingId ? 'AND id <> ?' : ''}
    LIMIT 1
    FOR UPDATE`;
  const params = [salon.id, overlapEnd, overlapStart];
  if (teamMemberId != null) params.push(teamMemberId);
  if (excludeBookingId) params.push(excludeBookingId);
  const [overlap] = await conn.execute(sql, params);
  if (overlap.length > 0) {
    throw new HttpError(409, 'slot_taken', 'Tidspunktet er allerede tatt. Velg et annet.');
  }

  return { endAt };
}

// resolveAnyoneStylist — assign a specific stylist when the caller passed
// teamMemberId == null ("Hvem som helst"). Returns the chosen stylist id, or
// null if the salon has no team_members at all (single-stylist salons, where
// NULL is the legacy salon-wide row).
//
// Why this exists: validateSlot's overlap check uses
//   (team_member_id = ? OR team_member_id IS NULL)
// when a stylist is set — so a NULL row would block every other stylist
// forever. We pick a random stylist whose calendar is clear for every
// occurrence (`starts`), and throw HttpError(409, 'no_stylist_available')
// when none is free.
//
// Caller must be inside a transaction; `conn` is used so the SELECT ... FOR
// UPDATE locks the same rows the subsequent INSERT will touch.
async function resolveAnyoneStylist({ conn, salonId, serviceId, starts, durationMin, bufferMin }) {
  const [linkRows] = await conn.execute(
    `SELECT team_member_id FROM service_team_members WHERE service_id = ?`,
    [serviceId]
  );
  let candidateIds;
  if (linkRows.length > 0) {
    candidateIds = linkRows.map(r => Number(r.team_member_id));
  } else {
    const [memberRows] = await conn.execute(
      `SELECT id FROM team_members WHERE salon_id = ? AND active = 1`,
      [salonId]
    );
    candidateIds = memberRows.map(r => Number(r.id));
  }
  if (candidateIds.length === 0) return null;
  // Fisher-Yates shuffle so two simultaneous "anyone" bookings don't always
  // race to the same first stylist.
  for (let i = candidateIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidateIds[i], candidateIds[j]] = [candidateIds[j], candidateIds[i]];
  }
  const bufferMs = (Number(bufferMin) || 0) * 60_000;
  const durMs = durationMin * 60_000;
  for (const cid of candidateIds) {
    let free = true;
    for (const s of starts) {
      const overlapStart = new Date(s.getTime() - bufferMs);
      const overlapEnd   = new Date(s.getTime() + durMs + bufferMs);
      const [conflicts] = await conn.execute(
        `SELECT id FROM bookings
          WHERE salon_id = ?
            AND status IN ('pending','confirmed')
            AND start_at < ?
            AND end_at   > ?
            AND (team_member_id = ? OR team_member_id IS NULL)
          LIMIT 1
          FOR UPDATE`,
        [salonId, overlapEnd, overlapStart, cid]
      );
      if (conflicts.length > 0) { free = false; break; }
    }
    if (free) return cid;
  }
  throw new HttpError(409, 'no_stylist_available',
    'Ingen behandler er ledig på dette tidspunktet. Velg en annen tid.');
}

router.use(requireAuth);

// GET /bookings/mine — bookings as a customer
router.get('/mine', asyncRoute(async (req, res) => {
  const filter = (req.query.filter || 'upcoming').toString();
  let where = 'b.customer_user_id = ?';
  const params = [req.user.id];
  if (filter === 'upcoming') where += ` AND b.start_at >= NOW() AND b.status IN ('pending','confirmed')`;
  if (filter === 'past') where += ` AND (b.start_at < NOW() OR b.status IN ('completed','cancelled','no_show'))`;

  const rows = await query(
    `SELECT b.id, b.start_at, b.end_at, b.status, b.price_nok,
            b.team_member_id,
            b.series_id, b.series_position, b.series_total, b.series_interval_weeks,
            s.id AS salon_id, s.slug AS salon_slug, s.name AS salon_name, s.city AS salon_city,
            sv.name AS service_name,
            tm.name AS team_member_name,
            (r.id IS NOT NULL) AS has_review
       FROM bookings b
       JOIN salons s ON s.id = b.salon_id
       JOIN services sv ON sv.id = b.service_id
       LEFT JOIN team_members tm ON tm.id = b.team_member_id
       LEFT JOIN reviews r ON r.booking_id = b.id AND r.hidden_at IS NULL
      WHERE ${where}
      ORDER BY b.start_at ${filter === 'past' ? 'DESC' : 'ASC'}
      LIMIT 200`,
    params
  );
  // Cast TINYINT-style boolean → real boolean so the client can do `b.has_review`.
  res.json({
    bookings: rows.map(r => ({ ...r, has_review: !!r.has_review })),
  });
}));

// GET /bookings/incoming — bookings at salons I own.
//
// Includes `customer_user_id` and `has_customer_note` so the owner panel can
// render the private-note notepad icon next to each customer without an
// extra fetch. The note body itself is intentionally NOT included here —
// the owner clicks the icon and the panel loads the body lazily from
// /salons/:id/customers/:userId/note.
router.get('/incoming', asyncRoute(async (req, res) => {
  const rows = await query(
    `SELECT b.id, b.start_at, b.end_at, b.status, b.price_nok, b.customer_note,
            b.team_member_id, b.customer_user_id,
            b.guest_name, b.guest_phone,
            s.id AS salon_id, s.name AS salon_name,
            sv.name AS service_name, sv.duration_min,
            tm.name AS team_member_name,
            u.name  AS customer_name,
            u.email AS customer_email,
            u.phone AS customer_phone,
            (CASE WHEN b.customer_user_id IS NULL THEN 0 ELSE
              (SELECT 1 FROM customer_notes cn
                WHERE cn.salon_id = b.salon_id
                  AND cn.customer_user_id = b.customer_user_id
                LIMIT 1)
             END) AS has_customer_note
       FROM bookings b
       JOIN salons s ON s.id = b.salon_id
       JOIN services sv ON sv.id = b.service_id
       LEFT JOIN users u ON u.id = b.customer_user_id
       LEFT JOIN team_members tm ON tm.id = b.team_member_id
      WHERE s.owner_user_id = ?
      ORDER BY b.start_at DESC
      LIMIT 200`,
    [req.user.id]
  );
  res.json({
    bookings: rows.map(r => ({
      ...r,
      has_customer_note: !!r.has_customer_note,
      // Convenience for the panel: who to address as "the customer". For a
      // walk-in/guest there is no users row, so we surface guest_* instead.
      display_name:  r.customer_name  || r.guest_name  || null,
      display_phone: r.customer_phone || r.guest_phone || null,
      is_guest:      r.customer_user_id == null,
    })),
  });
}));

// POST /bookings — customer creates a booking
//
// Optionally creates a recurring series: when `recurring` is supplied, every
// occurrence is validated up-front (same lead/window/closure/hours/lunch/overlap
// rules as a single booking). If ANY occurrence fails, the whole series is
// rejected with a 409 carrying which one (zero-based index) failed and why.
// Successful series are inserted in one transaction; series_id on every row
// equals the parent's id (i.e. the inserted id of the first row).
router.post('/', asyncRoute(async (req, res) => {
  const schema = z.object({
    salon_id: z.number().int().positive(),
    service_id: z.number().int().positive(),
    start_at: z.string().datetime(),
    customer_note: z.string().trim().max(1000).optional().nullable(),
    // Optional stylist preference. null = "Hvem som helst" (salon-wide booking).
    team_member_id: z.number().int().positive().nullable().optional(),
    // Optional recurring spec. Allowed intervals: 1/2/3/4/6/8 weeks; count
    // 2..12 (caps server-side roundtrips and bounds the validation loop).
    recurring: z.object({
      interval_weeks: z.number().int().refine(
        (n) => [1, 2, 3, 4, 6, 8].includes(n),
        { message: 'interval_weeks must be 1, 2, 3, 4, 6 or 8' }
      ),
      occurrences: z.number().int().min(2).max(12),
    }).optional(),
  });
  const data = schema.parse(req.body);

  const service = await queryOne(
    `SELECT id, salon_id, duration_min, price_nok, active
       FROM services WHERE id = ? AND salon_id = ?`,
    [data.service_id, data.salon_id]
  );
  if (!service || !service.active) throw new HttpError(404, 'service_unavailable', 'Tjenesten finnes ikke eller er ikke aktiv.');

  const salon = await queryOne(
    `SELECT id, status, accepts_new_bookings,
            cancellation_lead_hours, booking_window_days,
            min_booking_lead_hours, booking_buffer_min,
            lunch_break_start, lunch_break_end
       FROM salons WHERE id = ?`,
    [data.salon_id]
  );
  if (!salon || salon.status !== 'active') throw new HttpError(404, 'salon_unavailable', 'Salongen er ikke aktiv.');
  if (!salon.accepts_new_bookings) {
    throw new HttpError(409, 'bookings_paused', 'Salongen tar ikke imot nye bookinger akkurat nå.');
  }

  // Validate stylist when one was picked. The rule mirrors the public salon
  // page: a service with explicit links is only offered by those team members;
  // a service with no links is offered by "anyone", which we widen to "any
  // active team member of this salon".
  const teamMemberId = data.team_member_id ?? null;
  if (teamMemberId != null) {
    const linkRows = await query(
      `SELECT team_member_id FROM service_team_members WHERE service_id = ?`,
      [data.service_id]
    );
    if (linkRows.length > 0) {
      const allowed = new Set(linkRows.map(r => Number(r.team_member_id)));
      if (!allowed.has(Number(teamMemberId))) {
        throw new HttpError(400, 'invalid_team_member', 'Behandleren tilbyr ikke denne tjenesten.');
      }
    } else {
      // "Anyone" service — verify the picked stylist is active at the salon.
      const member = await queryOne(
        `SELECT id FROM team_members WHERE id = ? AND salon_id = ? AND active = 1`,
        [teamMemberId, data.salon_id]
      );
      if (!member) {
        throw new HttpError(400, 'invalid_team_member', 'Behandleren finnes ikke i denne salongen.');
      }
    }
  }

  const startAt = new Date(data.start_at);

  // Compute the start timestamps for the whole series (single booking → just
  // one). Offsets are ms-based so the wall-clock hour stays identical across
  // DST transitions; the alternative (rebuild the local time each occurrence)
  // would silently re-pick a slot during the spring-forward/fall-back week.
  const recurring = data.recurring || null;
  const totalOccurrences = recurring ? recurring.occurrences : 1;
  const intervalWeeks = recurring ? recurring.interval_weeks : null;
  const starts = [];
  for (let i = 0; i < totalOccurrences; i++) {
    const offsetMs = recurring ? i * intervalWeeks * 7 * 86_400_000 : 0;
    starts.push(new Date(startAt.getTime() + offsetMs));
  }

  // Run all rule checks + overlap inside a transaction so the SELECT FOR UPDATE
  // inside validateSlot locks the same rows that the INSERT will touch. For a
  // series we validate every occurrence before any insert; if one fails we
  // surface its index + ISO start so the frontend can point at the bad date.
  const result = await tx(async (conn) => {
    // When the customer picked "Hvem som helst" (teamMemberId == null), assign
    // a specific stylist now so the row never goes in with team_member_id NULL.
    // See resolveAnyoneStylist() for the full rationale.
    let resolvedTeamMemberId = teamMemberId;
    if (resolvedTeamMemberId == null) {
      const picked = await resolveAnyoneStylist({
        conn,
        salonId: data.salon_id,
        serviceId: data.service_id,
        starts,
        durationMin: service.duration_min,
        bufferMin: salon.booking_buffer_min,
      });
      if (picked != null) resolvedTeamMemberId = picked;
    }

    const validated = [];
    for (let i = 0; i < starts.length; i++) {
      try {
        const { endAt } = await validateSlot({
          salon: { ...salon, id: data.salon_id },
          service,
          startAt: starts[i],
          teamMemberId: resolvedTeamMemberId,
          conn,
        });
        validated.push({ start: starts[i], end: endAt });
      } catch (err) {
        if (recurring && err instanceof HttpError) {
          // Re-throw with occurrence context so the client can tell the user
          // exactly which date in the series caused the failure.
          throw new HttpError(err.status, err.code, err.message, {
            ...(err.details || {}),
            occurrence_index: i,
            occurrence_start_at: starts[i].toISOString(),
          });
        }
        throw err;
      }
    }

    if (!recurring) {
      const [insertResult] = await conn.execute(
        `INSERT INTO bookings
           (customer_user_id, salon_id, service_id, start_at, end_at, price_nok, status, customer_note, team_member_id)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        [req.user.id, data.salon_id, data.service_id, validated[0].start, validated[0].end,
         service.price_nok, data.customer_note || null, resolvedTeamMemberId]
      );
      return { id: insertResult.insertId };
    }

    // Series: insert parent first (position 1) so we know its id, then set
    // series_id = parentId on the parent and on each child (positions 2..N).
    const [parentInsert] = await conn.execute(
      `INSERT INTO bookings
         (customer_user_id, salon_id, service_id, start_at, end_at, price_nok, status,
          customer_note, team_member_id,
          series_position, series_total, series_interval_weeks)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, 1, ?, ?)`,
      [req.user.id, data.salon_id, data.service_id, validated[0].start, validated[0].end,
       service.price_nok, data.customer_note || null, resolvedTeamMemberId,
       totalOccurrences, intervalWeeks]
    );
    const parentId = parentInsert.insertId;
    await conn.execute(`UPDATE bookings SET series_id = ? WHERE id = ?`, [parentId, parentId]);

    for (let i = 1; i < validated.length; i++) {
      await conn.execute(
        `INSERT INTO bookings
           (customer_user_id, salon_id, service_id, start_at, end_at, price_nok, status,
            customer_note, team_member_id,
            series_id, series_position, series_total, series_interval_weeks)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
        [req.user.id, data.salon_id, data.service_id, validated[i].start, validated[i].end,
         service.price_nok, data.customer_note || null, resolvedTeamMemberId,
         parentId, i + 1, totalOccurrences, intervalWeeks]
      );
    }
    return { id: parentId, series_id: parentId, series_total: totalOccurrences };
  });
  setImmediate(() => { notify.sendBookingCreated(result.id); });
  // Auto-opprett chat-tråd så kunden kan melde salongen om denne bookingen.
  // Idempotent — ensureThread returnerer eksisterende ID hvis paret allerede har en.
  ensureThread(req.user.id, data.salon_id).catch(function (err) {
    console.warn('[chat] ensureThread failed', err && err.message);
  });
  res.status(201).json(result);
}));

// POST /bookings/manual — salon owner creates a booking on behalf of a walk-in
// or phone customer. The row goes in with customer_user_id = NULL and the
// guest's name/phone captured directly on the booking (guest_name/guest_phone).
// Status is 'confirmed' immediately — the owner is the one creating it, so
// there's no pending-approval step.
router.post('/manual', asyncRoute(async (req, res) => {
  const schema = z.object({
    salon_id: z.number().int().positive(),
    service_id: z.number().int().positive(),
    start_at: z.string().datetime(),
    team_member_id: z.number().int().positive().nullable().optional(),
    guest_name: z.string().trim().min(1).max(255),
    guest_phone: z.string().trim().max(32).optional().nullable(),
    customer_note: z.string().trim().max(1000).optional().nullable(),
  });
  const data = schema.parse(req.body);

  // Owner check — req.user.id must own salons.id = data.salon_id.
  const salon = await queryOne(
    `SELECT id, owner_user_id, status, accepts_new_bookings,
            cancellation_lead_hours, booking_window_days,
            min_booking_lead_hours, booking_buffer_min,
            lunch_break_start, lunch_break_end
       FROM salons WHERE id = ?`,
    [data.salon_id]
  );
  if (!salon) throw new HttpError(404, 'salon_unavailable', 'Salongen finnes ikke.');
  if (salon.owner_user_id !== req.user.id) {
    throw new HttpError(403, 'forbidden', 'Du eier ikke denne salongen.');
  }
  if (salon.status !== 'active') {
    throw new HttpError(409, 'salon_unavailable', 'Salongen er ikke aktiv.');
  }

  const service = await queryOne(
    `SELECT id, salon_id, duration_min, price_nok, active
       FROM services WHERE id = ? AND salon_id = ?`,
    [data.service_id, data.salon_id]
  );
  if (!service || !service.active) {
    throw new HttpError(404, 'service_unavailable', 'Tjenesten finnes ikke eller er ikke aktiv.');
  }

  // Validate stylist when picked — same rule as POST /bookings.
  const teamMemberId = data.team_member_id ?? null;
  if (teamMemberId != null) {
    const linkRows = await query(
      `SELECT team_member_id FROM service_team_members WHERE service_id = ?`,
      [data.service_id]
    );
    if (linkRows.length > 0) {
      const allowed = new Set(linkRows.map(r => Number(r.team_member_id)));
      if (!allowed.has(Number(teamMemberId))) {
        throw new HttpError(400, 'invalid_team_member', 'Behandleren tilbyr ikke denne tjenesten.');
      }
    } else {
      const member = await queryOne(
        `SELECT id FROM team_members WHERE id = ? AND salon_id = ? AND active = 1`,
        [teamMemberId, data.salon_id]
      );
      if (!member) {
        throw new HttpError(400, 'invalid_team_member', 'Behandleren finnes ikke i denne salongen.');
      }
    }
  }

  const startAt = new Date(data.start_at);

  const result = await tx(async (conn) => {
    // "Hvem som helst" → pick a free stylist now so the row doesn't go in with
    // team_member_id NULL and block other stylists.
    let resolvedTeamMemberId = teamMemberId;
    if (resolvedTeamMemberId == null) {
      const picked = await resolveAnyoneStylist({
        conn,
        salonId: data.salon_id,
        serviceId: data.service_id,
        starts: [startAt],
        durationMin: service.duration_min,
        bufferMin: salon.booking_buffer_min,
      });
      if (picked != null) resolvedTeamMemberId = picked;
    }

    const { endAt } = await validateSlot({
      salon: { ...salon, id: data.salon_id },
      service,
      startAt,
      teamMemberId: resolvedTeamMemberId,
      conn,
    });

    const [insertResult] = await conn.execute(
      `INSERT INTO bookings
         (customer_user_id, salon_id, service_id, start_at, end_at, price_nok, status,
          customer_note, team_member_id, guest_name, guest_phone)
       VALUES (NULL, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?)`,
      [data.salon_id, data.service_id, startAt, endAt,
       service.price_nok, data.customer_note || null, resolvedTeamMemberId,
       data.guest_name, data.guest_phone || null]
    );
    return { id: insertResult.insertId };
  });

  audit(req.user.id, 'booking.manual', 'booking', result.id, {
    salon_id: data.salon_id,
    guest_name: data.guest_name,
  });

  setImmediate(() => { notify.sendBookingCreated(result.id); });
  res.status(201).json(result);
}));

// GET /bookings/:id — single booking, accessible to the customer or salon owner
router.get('/:id', asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  const booking = await queryOne(
    `SELECT b.id, b.start_at, b.end_at, b.status, b.price_nok, b.customer_note,
            b.cancelled_at, b.cancelled_by_role, b.completed_at, b.created_at,
            b.customer_user_id, b.team_member_id,
            b.series_id, b.series_position, b.series_total, b.series_interval_weeks,
            s.id AS salon_id, s.slug AS salon_slug, s.name AS salon_name,
            s.city AS salon_city, s.address_line AS salon_address,
            s.postal_code AS salon_postal, s.owner_user_id,
            s.booking_confirmation_text AS confirmation_message,
            sv.id AS service_id, sv.name AS service_name, sv.duration_min,
            tm.name AS team_member_name,
            cu.name AS customer_name
       FROM bookings b
       JOIN salons s ON s.id = b.salon_id
       JOIN services sv ON sv.id = b.service_id
       JOIN users cu ON cu.id = b.customer_user_id
       LEFT JOIN team_members tm ON tm.id = b.team_member_id
      WHERE b.id = ?`,
    [id]
  );
  if (!booking) throw new HttpError(404, 'not_found', 'Booking finnes ikke.');
  const isCustomer = booking.customer_user_id === req.user.id;
  const isOwner = booking.owner_user_id === req.user.id;
  const isAdmin = req.user.role === 'admin';
  if (!isCustomer && !isOwner && !isAdmin) {
    throw new HttpError(403, 'forbidden', 'Du har ikke tilgang til denne bookingen.');
  }
  delete booking.customer_user_id;
  delete booking.owner_user_id;
  res.json({ booking });
}));

// PATCH /bookings/:id — change status (confirm/complete/cancel/no_show)
//
// Allowed transitions:
//   pending   → confirmed | cancelled
//   confirmed → completed | cancelled | no_show
//   completed | cancelled | no_show — terminal
const ALLOWED_TRANSITIONS = {
  pending:   new Set(['confirmed', 'cancelled']),
  confirmed: new Set(['completed', 'cancelled', 'no_show']),
};
router.patch('/:id', asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  const schema = z.object({
    status: z.enum(['confirmed', 'completed', 'cancelled', 'no_show']),
  });
  const { status } = schema.parse(req.body);

  const booking = await queryOne(
    `SELECT b.id, b.customer_user_id, b.status, b.start_at, b.end_at,
            b.salon_id,
            s.owner_user_id, s.cancellation_lead_hours
       FROM bookings b JOIN salons s ON s.id = b.salon_id
      WHERE b.id = ?`,
    [id]
  );
  if (!booking) throw new HttpError(404, 'not_found', 'Booking finnes ikke.');

  const isCustomer = booking.customer_user_id === req.user.id;
  const isOwner = booking.owner_user_id === req.user.id;
  const isAdmin = req.user.role === 'admin';

  // Customer: may cancel only.
  // Salon owner: may confirm, complete, cancel, or mark no_show.
  // Admin: anything.
  if (status === 'cancelled') {
    if (!isCustomer && !isOwner && !isAdmin) throw new HttpError(403, 'forbidden', 'Ikke tilgang.');
  } else {
    if (!isOwner && !isAdmin) throw new HttpError(403, 'forbidden', 'Bare salongen kan endre denne statusen.');
  }

  // Customer-initiated cancellations must respect the salon's cancellation
  // deadline. Owners and admins bypass this — they can cancel at any time
  // (e.g. emergencies, double-bookings), and the audit trail records who did.
  if (status === 'cancelled' && isCustomer && !isOwner && !isAdmin) {
    const cancelHours = Number(booking.cancellation_lead_hours) || 0;
    const startMs = new Date(booking.start_at).getTime();
    if ((startMs - Date.now()) < cancelHours * 3_600_000) {
      throw new HttpError(409, 'cancel_too_late',
        `Avbestillingsfristen er passert (krever minst ${cancelHours} timer varsel).`);
    }
  }

  const allowedFromCurrent = ALLOWED_TRANSITIONS[booking.status];
  if (!allowedFromCurrent || !allowedFromCurrent.has(status)) {
    throw new HttpError(409, 'invalid_transition',
      `Kan ikke endre booking fra "${booking.status}" til "${status}".`);
  }

  const cancelledByRole = status === 'cancelled'
    ? (isAdmin ? 'admin' : (isOwner ? 'salon' : 'customer'))
    : null;

  const completedAt = status === 'completed' ? new Date() : null;
  const cancelledAt = status === 'cancelled' ? new Date() : null;

  // Conditional UPDATE: only if status is still what we just read. If a
  // concurrent request beat us to it, affectedRows is 0 and we 409.
  const result = await query(
    `UPDATE bookings
        SET status = ?,
            cancelled_at  = COALESCE(?, cancelled_at),
            cancelled_by_role = COALESCE(?, cancelled_by_role),
            completed_at  = COALESCE(?, completed_at)
      WHERE id = ? AND status = ?`,
    [status, cancelledAt, cancelledByRole, completedAt, id, booking.status]
  );
  if (!result.affectedRows) {
    throw new HttpError(409, 'conflict', 'Booking ble endret av en annen prosess. Last på nytt.');
  }

  // Waitlist hand-off: if the slot just freed up (cancelled / no_show), flip
  // the earliest matching waitlist entry to 'ready'. "Matching" = same salon
  // and a desired_start that falls inside the now-vacated [start_at, end_at)
  // window. We only promote ONE entry per slot (FIFO by created_at) so two
  // customers don't both race to claim the same opening.
  // Fire notifications after the row write commits. setImmediate so we don't
  // block the HTTP response; the notifier swallows its own errors.
  if (status === 'confirmed') {
    setImmediate(() => { notify.sendBookingConfirmed(id); });
  } else if (status === 'cancelled') {
    setImmediate(() => { notify.sendBookingCancelled(id, cancelledByRole); });
  }

  if (status === 'cancelled' || status === 'no_show') {
    try {
      const candidate = await queryOne(
        `SELECT id FROM waitlist_entries
          WHERE salon_id = ?
            AND status = 'waiting'
            AND desired_start >= ?
            AND desired_start <  ?
          ORDER BY created_at ASC
          LIMIT 1`,
        [booking.salon_id, booking.start_at, booking.end_at]
      );
      if (candidate) {
        await query(
          `UPDATE waitlist_entries
              SET status = 'ready', notified_at = NOW()
            WHERE id = ? AND status = 'waiting'`,
          [candidate.id]
        );
      }
    } catch (err) {
      // Don't fail the cancel just because the waitlist hand-off failed.
      console.error('[waitlist] notify-on-free failed', err);
    }
  }

  res.json({ ok: true });
}));

// GET /bookings/:id/ics — calendar export (RFC 5545 VEVENT).
//
// Same access rules as GET /bookings/:id: customer, owner, or admin. The route
// is auth-gated, so clients have to fetch with a Bearer token and trigger a
// Blob download client-side (see confirmation.html + kunde-panel.html).
router.get('/:id/ics', asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  const booking = await queryOne(
    `SELECT b.id, b.start_at, b.end_at, b.status, b.customer_user_id,
            s.id AS salon_id, s.name AS salon_name, s.address_line, s.postal_code,
            s.city AS salon_city, s.owner_user_id,
            s.booking_confirmation_text AS confirmation_message,
            sv.name AS service_name,
            owner.email AS owner_email
       FROM bookings b
       JOIN salons s ON s.id = b.salon_id
       JOIN services sv ON sv.id = b.service_id
       JOIN users owner ON owner.id = s.owner_user_id
      WHERE b.id = ?`,
    [id]
  );
  if (!booking) throw new HttpError(404, 'not_found', 'Booking finnes ikke.');
  const isCustomer = booking.customer_user_id === req.user.id;
  const isOwner = booking.owner_user_id === req.user.id;
  const isAdmin = req.user.role === 'admin';
  if (!isCustomer && !isOwner && !isAdmin) {
    throw new HttpError(403, 'forbidden', 'Du har ikke tilgang til denne bookingen.');
  }

  // RFC 5545 UTC timestamp: YYYYMMDDTHHMMSSZ.
  function toIcsUtc(d) {
    const dt = d instanceof Date ? d : new Date(d);
    const pad = n => String(n).padStart(2, '0');
    return dt.getUTCFullYear()
      + pad(dt.getUTCMonth() + 1)
      + pad(dt.getUTCDate())
      + 'T' + pad(dt.getUTCHours())
      + pad(dt.getUTCMinutes())
      + pad(dt.getUTCSeconds()) + 'Z';
  }
  // RFC 5545 TEXT escaping: backslash, semicolon, comma, and newline.
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }
  // Soft 75-octet line fold per RFC 5545 §3.1. char-length approximation is
  // fine for the mostly-ASCII Norwegian content this emits.
  function fold(line) {
    if (line.length <= 75) return line;
    const parts = [];
    let i = 0;
    while (i < line.length) {
      parts.push((i === 0 ? '' : ' ') + line.slice(i, i + 75));
      i += 75;
    }
    return parts.join('\r\n');
  }

  const summary = `${booking.service_name} — ${booking.salon_name}`;
  const addrLine = [
    booking.address_line,
    [booking.postal_code, booking.salon_city].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ');
  const link = `${(config.publicBaseUrl || '').replace(/\/$/, '')}/confirmation.html?id=${booking.id}`;
  const descParts = [link];
  const msg = (booking.confirmation_message || '').toString().trim();
  if (msg) descParts.push('', msg);
  const description = descParts.join('\n');
  const status = booking.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//nailed//Booking//NO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:booking-${booking.id}@nailed.no`,
    `DTSTAMP:${toIcsUtc(new Date())}`,
    `DTSTART:${toIcsUtc(booking.start_at)}`,
    `DTEND:${toIcsUtc(booking.end_at)}`,
    `SUMMARY:${esc(summary)}`,
    `LOCATION:${esc(addrLine || booking.salon_name)}`,
    `DESCRIPTION:${esc(description)}`,
    `STATUS:${status}`,
    `ORGANIZER;CN=${esc(booking.salon_name)}:mailto:${booking.owner_email}`,
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ].map(fold).join('\r\n') + '\r\n';

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="nailed-booking-${booking.id}.ics"`);
  res.send(lines);
}));

// PATCH /bookings/:id/reschedule — customer or owner moves a booking to a new
// start time. Reuses validateSlot() (same lead/window/closure/hours/lunch
// /overlap checks as POST /bookings), excluding the booking's own row from
// the overlap check.
router.patch('/:id/reschedule', asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  const schema = z.object({
    start_at: z.string().datetime(),
  });
  const { start_at: startAtIso } = schema.parse(req.body);

  const booking = await queryOne(
    `SELECT b.id, b.customer_user_id, b.salon_id, b.service_id, b.status,
            b.team_member_id,
            b.start_at AS old_start_at, b.end_at AS old_end_at,
            s.owner_user_id
       FROM bookings b JOIN salons s ON s.id = b.salon_id
      WHERE b.id = ?`,
    [id]
  );
  if (!booking) throw new HttpError(404, 'not_found', 'Booking finnes ikke.');

  const isCustomer = booking.customer_user_id === req.user.id;
  const isAdmin = req.user.role === 'admin';
  // Salongeier kan IKKE flytte timer — kun kunden eller admin. Salongen kan
  // avbestille i stedet, så kunden velger ny tid selv.
  if (!isCustomer && !isAdmin) {
    throw new HttpError(403, 'forbidden', 'Bare kunden kan flytte denne bookingen.');
  }
  if (booking.status !== 'pending' && booking.status !== 'confirmed') {
    throw new HttpError(409, 'invalid_state',
      'Kan bare flytte bookinger som ikke er fullført, kansellert eller no-show.');
  }

  const service = await queryOne(
    `SELECT id, salon_id, duration_min, active
       FROM services WHERE id = ?`,
    [booking.service_id]
  );
  if (!service) throw new HttpError(409, 'service_unavailable', 'Tjenesten er ikke tilgjengelig.');

  const salon = await queryOne(
    `SELECT id, status, accepts_new_bookings,
            cancellation_lead_hours, booking_window_days,
            min_booking_lead_hours, booking_buffer_min,
            lunch_break_start, lunch_break_end
       FROM salons WHERE id = ?`,
    [booking.salon_id]
  );
  if (!salon || salon.status !== 'active') {
    throw new HttpError(409, 'salon_unavailable', 'Salongen er ikke aktiv.');
  }

  const startAt = new Date(startAtIso);
  const { endAt } = await tx(async (conn) => {
    const result = await validateSlot({
      salon,
      service,
      startAt,
      excludeBookingId: id,
      // Preserve the existing stylist (or salon-wide) scoping on reschedule.
      teamMemberId: booking.team_member_id != null ? Number(booking.team_member_id) : null,
      conn,
    });
    // Conditional UPDATE — only if the booking is still in a reschedulable
    // state. If something else (cancel, complete) raced us, affectedRows is 0.
    const [update] = await conn.execute(
      `UPDATE bookings SET start_at = ?, end_at = ?
        WHERE id = ? AND status IN ('pending','confirmed')`,
      [startAt, result.endAt, id]
    );
    if (!update.affectedRows) {
      throw new HttpError(409, 'conflict', 'Booking ble endret av en annen prosess. Last på nytt.');
    }
    return { endAt: result.endAt };
  });

  audit(req.user.id, 'booking.reschedule', 'booking', id, {
    old_start_at: booking.old_start_at,
    old_end_at: booking.old_end_at,
    new_start_at: startAt.toISOString(),
    new_end_at: endAt.toISOString(),
    actor_role: isAdmin ? 'admin' : (isOwner ? 'salon' : 'customer'),
  });

  res.json({ ok: true, start_at: startAt.toISOString(), end_at: endAt.toISOString() });
}));

// Exported for reuse by other routes that need to validate a slot under the
// same locking semantics (e.g. waitlist claim).
module.exports = router;
module.exports.validateSlot = validateSlot;
