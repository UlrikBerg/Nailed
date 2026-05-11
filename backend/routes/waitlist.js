const express = require('express');
const { z } = require('zod');
const { query, queryOne, tx } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute, HttpError } = require('../lib/util');
const { validateSlot } = require('./bookings');

const router = express.Router();

router.use(requireAuth);

// Helper — load the (salon, service) pair the same way POST /bookings does so
// the waitlist endpoints can reuse the booking-creation pre-checks. Throws
// HttpError on any rule violation.
async function loadSalonAndService(salonId, serviceId) {
  const service = await queryOne(
    `SELECT id, salon_id, duration_min, price_nok, active
       FROM services WHERE id = ? AND salon_id = ?`,
    [serviceId, salonId]
  );
  if (!service || !service.active) {
    throw new HttpError(404, 'service_unavailable', 'Tjenesten finnes ikke eller er ikke aktiv.');
  }
  const salon = await queryOne(
    `SELECT id, status, accepts_new_bookings,
            cancellation_lead_hours, booking_window_days,
            min_booking_lead_hours, booking_buffer_min,
            lunch_break_start, lunch_break_end
       FROM salons WHERE id = ?`,
    [salonId]
  );
  if (!salon || salon.status !== 'active') {
    throw new HttpError(404, 'salon_unavailable', 'Salongen er ikke aktiv.');
  }
  return { salon, service };
}

// POST /waitlist — subscribe to a currently-taken slot.
//
// Body: { salon_id, service_id, team_member_id?, desired_start }
//
// Rejected with 409 `slot_open` if the slot is actually available (the user
// should just book it directly rather than queueing on a free slot). We detect
// this by running the same overlap check POST /bookings uses inside a tx, and
// treating "no overlap" as "slot is open".
//
// Also rejected with 409 `already_waitlisted` if the user is already in the
// queue for the same (salon, service, start, stylist) tuple.
router.post('/', asyncRoute(async (req, res) => {
  const schema = z.object({
    salon_id: z.number().int().positive(),
    service_id: z.number().int().positive(),
    team_member_id: z.number().int().positive().nullable().optional(),
    desired_start: z.string().datetime(),
  });
  const data = schema.parse(req.body);

  const { salon, service } = await loadSalonAndService(data.salon_id, data.service_id);
  const teamMemberId = data.team_member_id ?? null;
  const desiredStart = new Date(data.desired_start);
  if (Number.isNaN(desiredStart.getTime())) {
    throw new HttpError(400, 'bad_start', 'Ugyldig start-tidspunkt.');
  }
  if (desiredStart.getTime() <= Date.now()) {
    throw new HttpError(400, 'past_start', 'Du kan bare sette deg på venteliste for framtidige tider.');
  }

  // Validate the requested stylist if one was provided — same rule POST
  // /bookings uses (explicit links restrict to those members; no links = anyone).
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

  // Run the open/taken probe + duplicate check + INSERT inside a single
  // transaction so we can't race two waitlist subscribers onto the same row
  // and so the overlap check sees a consistent view of the bookings table.
  const inserted = await tx(async (conn) => {
    // Open/taken probe: same predicate as validateSlot's overlap query, minus
    // the throw. If there's NO overlap, the slot is open and the user should
    // book directly — reject with 409 slot_open.
    const bufferMin = Number(salon.booking_buffer_min) || 0;
    const endAt = new Date(desiredStart.getTime() + service.duration_min * 60_000);
    const overlapStart = new Date(desiredStart.getTime() - bufferMin * 60_000);
    const overlapEnd = new Date(endAt.getTime() + bufferMin * 60_000);

    const teamClause = teamMemberId != null
      ? 'AND (team_member_id = ? OR team_member_id IS NULL)'
      : '';
    const params = [data.salon_id, overlapEnd, overlapStart];
    if (teamMemberId != null) params.push(teamMemberId);
    const [overlapRows] = await conn.execute(
      `SELECT id, customer_user_id FROM bookings
        WHERE salon_id = ?
          AND status IN ('pending','confirmed')
          AND start_at < ?
          AND end_at   > ?
          ${teamClause}
        LIMIT 5
        FOR UPDATE`,
      params
    );

    if (overlapRows.length === 0) {
      throw new HttpError(409, 'slot_open',
        'Denne tiden er ledig — book den direkte i stedet.');
    }

    // If the user is the one already holding the slot, no point waitlisting it.
    if (overlapRows.some(r => Number(r.customer_user_id) === Number(req.user.id))) {
      throw new HttpError(409, 'already_booked',
        'Du har allerede en booking i dette tidsrommet.');
    }

    // De-dup: same user, same (salon, service, start, stylist), still waiting/ready.
    const teamDedupClause = teamMemberId != null
      ? 'AND team_member_id = ?'
      : 'AND team_member_id IS NULL';
    const dedupParams = [req.user.id, data.salon_id, data.service_id, desiredStart];
    if (teamMemberId != null) dedupParams.push(teamMemberId);
    const [dupRows] = await conn.execute(
      `SELECT id FROM waitlist_entries
        WHERE user_id = ?
          AND salon_id = ?
          AND service_id = ?
          AND desired_start = ?
          ${teamDedupClause}
          AND status IN ('waiting','ready')
        LIMIT 1`,
      dedupParams
    );
    if (dupRows.length > 0) {
      throw new HttpError(409, 'already_waitlisted',
        'Du står allerede på venteliste for denne tiden.');
    }

    // Default expiry: 14 days after the desired_start. We never auto-expire
    // here (that's a future cron); it's stored so the UI can show a hint.
    const expiresAt = new Date(desiredStart.getTime() + 14 * 86_400_000);

    const [result] = await conn.execute(
      `INSERT INTO waitlist_entries
         (user_id, salon_id, service_id, team_member_id, desired_start, status, expires_at)
       VALUES (?, ?, ?, ?, ?, 'waiting', ?)`,
      [req.user.id, data.salon_id, data.service_id, teamMemberId, desiredStart, expiresAt]
    );
    return result.insertId;
  });

  res.status(201).json({ id: inserted });
}));

// GET /waitlist/mine — current user's waitlist entries, with display-friendly joins.
router.get('/mine', asyncRoute(async (req, res) => {
  const rows = await query(
    `SELECT w.id, w.desired_start, w.status, w.notified_at, w.created_at, w.expires_at,
            w.claimed_booking_id,
            s.id AS salon_id, s.slug AS salon_slug, s.name AS salon_name, s.city AS salon_city,
            sv.id AS service_id, sv.name AS service_name, sv.duration_min, sv.price_nok,
            tm.id AS team_member_id, tm.name AS team_member_name
       FROM waitlist_entries w
       JOIN salons s   ON s.id  = w.salon_id
       JOIN services sv ON sv.id = w.service_id
       LEFT JOIN team_members tm ON tm.id = w.team_member_id
      WHERE w.user_id = ?
      ORDER BY (w.status = 'ready') DESC, w.desired_start ASC
      LIMIT 200`,
    [req.user.id]
  );
  res.json({ entries: rows });
}));

// DELETE /waitlist/:id — user cancels their own entry.
router.delete('/:id', asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  const entry = await queryOne(
    `SELECT id, user_id FROM waitlist_entries WHERE id = ?`,
    [id]
  );
  if (!entry) throw new HttpError(404, 'not_found', 'Ventelisten finnes ikke.');
  if (Number(entry.user_id) !== Number(req.user.id)) {
    throw new HttpError(403, 'forbidden', 'Ikke tilgang.');
  }
  await query(`DELETE FROM waitlist_entries WHERE id = ?`, [id]);
  res.json({ ok: true });
}));

// POST /waitlist/:id/claim — book the slot when the entry is 'ready'.
//
// Reuses validateSlot under a transaction (same locking semantics as POST
// /bookings) so we never double-book. On success, the entry flips to 'claimed'
// and stores the new booking id.
router.post('/:id/claim', asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');

  const entry = await queryOne(
    `SELECT id, user_id, salon_id, service_id, team_member_id, desired_start, status
       FROM waitlist_entries WHERE id = ?`,
    [id]
  );
  if (!entry) throw new HttpError(404, 'not_found', 'Ventelisten finnes ikke.');
  if (Number(entry.user_id) !== Number(req.user.id)) {
    throw new HttpError(403, 'forbidden', 'Ikke tilgang.');
  }
  if (entry.status !== 'ready') {
    throw new HttpError(409, 'not_ready',
      'Du kan bare booke ventelisten når en tid har blitt ledig.');
  }

  const { salon, service } = await loadSalonAndService(entry.salon_id, entry.service_id);
  if (!salon.accepts_new_bookings) {
    throw new HttpError(409, 'bookings_paused',
      'Salongen tar ikke imot nye bookinger akkurat nå.');
  }

  const startAt = new Date(entry.desired_start);
  const teamMemberId = entry.team_member_id != null ? Number(entry.team_member_id) : null;

  const newBookingId = await tx(async (conn) => {
    const { endAt } = await validateSlot({
      salon: { ...salon, id: entry.salon_id },
      service,
      startAt,
      teamMemberId,
      conn,
    });
    const [insertResult] = await conn.execute(
      `INSERT INTO bookings
         (customer_user_id, salon_id, service_id, start_at, end_at, price_nok, status, team_member_id)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [req.user.id, entry.salon_id, entry.service_id, startAt, endAt, service.price_nok, teamMemberId]
    );
    const insertedId = insertResult.insertId;
    // Conditional flip — only if still 'ready'. If another race already claimed
    // it (shouldn't happen since one user owns the entry, but defensive), 409.
    const [updateResult] = await conn.execute(
      `UPDATE waitlist_entries
          SET status = 'claimed', claimed_booking_id = ?
        WHERE id = ? AND status = 'ready'`,
      [insertedId, entry.id]
    );
    if (!updateResult.affectedRows) {
      throw new HttpError(409, 'conflict',
        'Ventelisten ble endret av en annen prosess. Last på nytt.');
    }
    return insertedId;
  });

  res.status(201).json({ id: newBookingId });
}));

module.exports = router;
