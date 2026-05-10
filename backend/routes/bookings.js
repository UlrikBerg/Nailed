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
            sv.name AS service_name,
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

  const salon = await queryOne(`SELECT id, status FROM salons WHERE id = ?`, [data.salon_id]);
  if (!salon || salon.status !== 'active') throw new HttpError(404, 'salon_unavailable', 'Salongen er ikke aktiv.');

  const startAt = new Date(data.start_at);
  if (Number.isNaN(startAt.getTime())) throw new HttpError(400, 'bad_start_at', 'Ugyldig start-tidspunkt.');
  if (startAt.getTime() < Date.now()) throw new HttpError(400, 'past_start', 'Start må være i framtiden.');
  const endAt = new Date(startAt.getTime() + service.duration_min * 60_000);

  const result = await query(
    `INSERT INTO bookings
       (customer_user_id, salon_id, service_id, start_at, end_at, price_nok, status, customer_note)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [req.user.id, data.salon_id, data.service_id, startAt, endAt, service.price_nok, data.customer_note || null]
  );
  res.status(201).json({ id: result.insertId });
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
router.patch('/:id', asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  const schema = z.object({
    status: z.enum(['confirmed', 'completed', 'cancelled', 'no_show']),
  });
  const { status } = schema.parse(req.body);

  const booking = await queryOne(
    `SELECT b.id, b.customer_user_id, b.status, s.owner_user_id
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

  const cancelledByRole = status === 'cancelled'
    ? (isAdmin ? 'admin' : (isOwner ? 'salon' : 'customer'))
    : null;

  const completedAt = status === 'completed' ? new Date() : null;
  const cancelledAt = status === 'cancelled' ? new Date() : null;

  await query(
    `UPDATE bookings
        SET status = ?,
            cancelled_at  = COALESCE(?, cancelled_at),
            cancelled_by_role = COALESCE(?, cancelled_by_role),
            completed_at  = COALESCE(?, completed_at)
      WHERE id = ?`,
    [status, cancelledAt, cancelledByRole, completedAt, id]
  );
  res.json({ ok: true });
}));

module.exports = router;
