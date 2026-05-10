const express = require('express');
const { z } = require('zod');
const { query, queryOne, tx } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute, HttpError } = require('../lib/util');

const router = express.Router();

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
            s.id AS salon_id, s.slug AS salon_slug, s.name AS salon_name, s.city AS salon_city,
            sv.name AS service_name
       FROM bookings b
       JOIN salons s ON s.id = b.salon_id
       JOIN services sv ON sv.id = b.service_id
      WHERE ${where}
      ORDER BY b.start_at ${filter === 'past' ? 'DESC' : 'ASC'}
      LIMIT 200`,
    params
  );
  res.json({ bookings: rows });
}));

// GET /bookings/incoming — bookings at salons I own
router.get('/incoming', asyncRoute(async (req, res) => {
  const rows = await query(
    `SELECT b.id, b.start_at, b.end_at, b.status, b.price_nok, b.customer_note,
            s.id AS salon_id, s.name AS salon_name,
            sv.name AS service_name, sv.duration_min,
            u.name AS customer_name
       FROM bookings b
       JOIN salons s ON s.id = b.salon_id
       JOIN services sv ON sv.id = b.service_id
       JOIN users u ON u.id = b.customer_user_id
      WHERE s.owner_user_id = ?
      ORDER BY b.start_at DESC
      LIMIT 200`,
    [req.user.id]
  );
  res.json({ bookings: rows });
}));

// POST /bookings — customer creates a booking
router.post('/', asyncRoute(async (req, res) => {
  const schema = z.object({
    salon_id: z.number().int().positive(),
    service_id: z.number().int().positive(),
    start_at: z.string().datetime(),
    customer_note: z.string().trim().max(1000).optional().nullable(),
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

  const startAt = new Date(data.start_at);
  if (Number.isNaN(startAt.getTime())) throw new HttpError(400, 'bad_start_at', 'Ugyldig start-tidspunkt.');
  if (startAt.getTime() < Date.now()) throw new HttpError(400, 'past_start', 'Start må være i framtiden.');

  // Closure check — reject if the start date is on a closed day.
  const startDateStr = (() => {
    const y = startAt.getFullYear();
    const m = String(startAt.getMonth() + 1).padStart(2, '0');
    const d = String(startAt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  })();
  const closure = await queryOne(
    `SELECT id FROM salon_closures WHERE salon_id = ? AND closed_date = ?`,
    [data.salon_id, startDateStr]
  );
  if (closure) {
    throw new HttpError(409, 'salon_closed', 'Salongen er stengt denne dagen.');
  }

  // Booking-rule enforcement: lead time and window. Server-side is the source
  // of truth — the public salon page also hides invalid slots, but we still
  // re-validate here to defeat hand-crafted requests.
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

  // Lunch break — synthesize the day's lunch window and reject any booking
  // that overlaps it. Times are stored as TIME (HH:MM:SS) so we anchor them
  // to the start_at date in the same local timezone the rest of the booking
  // math uses.
  if (salon.lunch_break_start && salon.lunch_break_end) {
    const ls = String(salon.lunch_break_start).slice(0, 8).split(':');
    const le = String(salon.lunch_break_end).slice(0, 8).split(':');
    const lunchStart = new Date(startAt); lunchStart.setHours(+ls[0], +ls[1], +(ls[2] || 0), 0);
    const lunchEnd = new Date(startAt);   lunchEnd.setHours(+le[0], +le[1], +(le[2] || 0), 0);
    if (startAt < lunchEnd && endAt > lunchStart) {
      throw new HttpError(409, 'lunch_break', 'Tidspunktet kolliderer med salongens lunsjpause.');
    }
  }

  // Buffer expands the overlap window on both ends. With a 15 min buffer, two
  // 60-min bookings starting 60 min apart now collide (15 min overlap on each
  // side). Using the buffer-padded window in the SELECT keeps the FOR UPDATE
  // lock honest.
  const overlapStart = new Date(startAt.getTime() - bufferMin * 60_000);
  const overlapEnd = new Date(endAt.getTime() + bufferMin * 60_000);

  // Reject overlap with any other live booking at the same salon.
  // Treats one-stylist salons as the realistic default; multi-stylist scheduling
  // would need to scope this check by team_member instead of salon.
  const insertedId = await tx(async (conn) => {
    const [overlap] = await conn.execute(
      `SELECT id FROM bookings
        WHERE salon_id = ?
          AND status IN ('pending','confirmed')
          AND start_at < ?
          AND end_at   > ?
        LIMIT 1
        FOR UPDATE`,
      [data.salon_id, overlapEnd, overlapStart]
    );
    if (overlap.length > 0) {
      throw new HttpError(409, 'slot_taken', 'Tidspunktet er allerede tatt. Velg et annet.');
    }
    const [insertResult] = await conn.execute(
      `INSERT INTO bookings
         (customer_user_id, salon_id, service_id, start_at, end_at, price_nok, status, customer_note)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [req.user.id, data.salon_id, data.service_id, startAt, endAt, service.price_nok, data.customer_note || null]
    );
    return insertResult.insertId;
  });
  res.status(201).json({ id: insertedId });
}));

// GET /bookings/:id — single booking, accessible to the customer or salon owner
router.get('/:id', asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  const booking = await queryOne(
    `SELECT b.id, b.start_at, b.end_at, b.status, b.price_nok, b.customer_note,
            b.cancelled_at, b.cancelled_by_role, b.completed_at, b.created_at,
            b.customer_user_id,
            s.id AS salon_id, s.slug AS salon_slug, s.name AS salon_name,
            s.city AS salon_city, s.address_line AS salon_address,
            s.postal_code AS salon_postal, s.owner_user_id,
            s.booking_confirmation_text AS confirmation_message,
            sv.id AS service_id, sv.name AS service_name, sv.duration_min,
            cu.name AS customer_name
       FROM bookings b
       JOIN salons s ON s.id = b.salon_id
       JOIN services sv ON sv.id = b.service_id
       JOIN users cu ON cu.id = b.customer_user_id
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
    `SELECT b.id, b.customer_user_id, b.status, b.start_at,
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
  res.json({ ok: true });
}));

module.exports = router;
