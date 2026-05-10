// Customer reviews — list/create/reply/hide.
//
// Schema lives in backend/schema.sql (table `reviews` plus owner_reply,
// owner_reply_at). One review per booking (UNIQUE on booking_id); only
// the customer for a *completed* booking can create one.

const express = require('express');
const { z } = require('zod');
const { query, queryOne } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncRoute, HttpError } = require('../lib/util');

const router = express.Router();

// Strip a customer's full name down to "Firstname L." for public display.
// Empty/whitespace input → "Anonym".
function maskCustomerName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Anonym';
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  return parts[0] + ' ' + last.charAt(0).toUpperCase() + '.';
}

function shapeReview(r) {
  return {
    id: r.id,
    rating: r.rating,
    body: r.body,
    owner_reply: r.owner_reply,
    owner_reply_at: r.owner_reply_at,
    customer_name: maskCustomerName(r.customer_full_name),
    created_at: r.created_at,
  };
}

// GET /salons/:id/reviews — public list (newest first).
// Query: ?limit=20&offset=0 (max limit 100).
//        ?unanswered=1 → only reviews without owner_reply (for the owner panel
//                       badge count + filtered list).
router.get('/salons/:id/reviews', asyncRoute(async (req, res) => {
  const salonId = parseInt(req.params.id, 10);
  if (!Number.isFinite(salonId)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const offset = parseInt(req.query.offset, 10) || 0;
  const unansweredOnly = req.query.unanswered === '1' || req.query.unanswered === 'true';

  const where = ['r.salon_id = ?', 'r.hidden_at IS NULL'];
  const params = [salonId];
  if (unansweredOnly) {
    where.push('r.owner_reply IS NULL');
  }

  const rows = await query(
    `SELECT r.id, r.rating, r.body, r.owner_reply, r.owner_reply_at, r.created_at,
            u.name AS customer_full_name
       FROM reviews r
       JOIN users u ON u.id = r.customer_user_id
      WHERE ${where.join(' AND ')}
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  // Total count (with the same filter) — useful for the owner-panel badge so
  // we can show "X" unanswered without fetching every row.
  const totalRow = await queryOne(
    `SELECT COUNT(*) AS n FROM reviews r
      WHERE ${where.join(' AND ')}`,
    params
  );

  res.json({
    reviews: rows.map(shapeReview),
    total: Number(totalRow?.n || 0),
    limit,
    offset,
  });
}));

// POST /bookings/:id/review — customer leaves a review on their booking.
// Requirements:
//   - caller is the booking's customer (else 403)
//   - booking.status === 'completed' (else 409 not_completed)
//   - no existing review for this booking (else 409 already_reviewed)
router.post('/bookings/:id/review', requireAuth, asyncRoute(async (req, res) => {
  const bookingId = parseInt(req.params.id, 10);
  if (!Number.isFinite(bookingId)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');

  const schema = z.object({
    rating: z.number().int().min(1).max(5),
    body: z.string().trim().max(800).optional().nullable(),
  });
  const data = schema.parse(req.body);

  const booking = await queryOne(
    `SELECT id, customer_user_id, salon_id, status FROM bookings WHERE id = ?`,
    [bookingId]
  );
  if (!booking) throw new HttpError(404, 'not_found', 'Booking finnes ikke.');
  if (booking.customer_user_id !== req.user.id) {
    throw new HttpError(403, 'forbidden', 'Du kan bare anmelde dine egne bookinger.');
  }
  if (booking.status !== 'completed') {
    throw new HttpError(409, 'not_completed', 'Du kan først anmelde etter at bookingen er fullført.');
  }

  // Pre-check for an existing review so we can return a clean 409 instead of
  // a duplicate-key error. The UNIQUE constraint still catches any race.
  const existing = await queryOne(
    `SELECT id FROM reviews WHERE booking_id = ?`,
    [bookingId]
  );
  if (existing) {
    throw new HttpError(409, 'already_reviewed', 'Du har allerede anmeldt denne bookingen.');
  }

  try {
    const result = await query(
      `INSERT INTO reviews (booking_id, customer_user_id, salon_id, rating, body)
       VALUES (?, ?, ?, ?, ?)`,
      [bookingId, req.user.id, booking.salon_id, data.rating, data.body || null]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      throw new HttpError(409, 'already_reviewed', 'Du har allerede anmeldt denne bookingen.');
    }
    throw err;
  }
}));

// PATCH /reviews/:id/reply — salon owner of the reviewed salon adds a reply.
router.patch('/reviews/:id/reply', requireAuth, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');

  const schema = z.object({
    reply: z.string().trim().min(1, 'Skriv et svar.').max(1000),
  });
  const { reply } = schema.parse(req.body);

  const review = await queryOne(
    `SELECT r.id, r.salon_id, r.hidden_at, s.owner_user_id
       FROM reviews r
       JOIN salons s ON s.id = r.salon_id
      WHERE r.id = ?`,
    [id]
  );
  if (!review) throw new HttpError(404, 'not_found', 'Anmeldelsen finnes ikke.');
  if (review.hidden_at) throw new HttpError(409, 'hidden', 'Anmeldelsen er skjult.');
  if (req.user.role !== 'admin' && review.owner_user_id !== req.user.id) {
    throw new HttpError(403, 'forbidden', 'Du eier ikke denne salongen.');
  }

  await query(
    `UPDATE reviews SET owner_reply = ?, owner_reply_at = NOW() WHERE id = ?`,
    [reply, id]
  );
  res.json({ ok: true });
}));

// DELETE /reviews/:id — admin-only soft-hide (sets hidden_at = NOW()).
// Audited in audit_log so we can trace removals later.
router.delete('/reviews/:id', requireAuth, requireRole('admin'), asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');

  const review = await queryOne(
    `SELECT id, salon_id, hidden_at FROM reviews WHERE id = ?`,
    [id]
  );
  if (!review) throw new HttpError(404, 'not_found', 'Anmeldelsen finnes ikke.');
  if (review.hidden_at) return res.json({ ok: true });

  await query(`UPDATE reviews SET hidden_at = NOW() WHERE id = ?`, [id]);

  // Best-effort audit log; never let this fail the request.
  try {
    await query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, meta_json)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user.id, 'review.hide', 'review', id, JSON.stringify({ salon_id: review.salon_id })]
    );
  } catch (err) {
    console.error('[audit] review.hide failed', err);
  }

  res.json({ ok: true });
}));

module.exports = router;
