const express = require('express');
const { z } = require('zod');
const { query, queryOne } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute, HttpError } = require('../lib/util');

const router = express.Router();

router.use(requireAuth);

// GET /me — current user profile
router.get('/', asyncRoute(async (req, res) => {
  const user = await queryOne(
    `SELECT id, email, name, phone, birth_year, address_line, postal_code, city, role,
            notify_email_bookings, notify_email_reminders, notify_sms_reminders, notify_marketing,
            created_at
       FROM users WHERE id = ?`,
    [req.user.id]
  );
  // If user is a salon owner, attach their salon ids.
  let salonIds = [];
  if (user.role === 'salon_owner' || user.role === 'admin') {
    const rows = await query(
      `SELECT id FROM salons WHERE owner_user_id = ? AND status != 'deleted'`,
      [req.user.id]
    );
    salonIds = rows.map(r => r.id);
  }
  res.json({ user: { ...user, salon_ids: salonIds } });
}));

// PATCH /me — update editable fields
router.patch('/', asyncRoute(async (req, res) => {
  const schema = z.object({
    name: z.string().trim().min(1).max(255).optional(),
    phone: z.string().trim().max(32).nullable().optional(),
    address_line: z.string().trim().max(255).nullable().optional(),
    postal_code: z.string().trim().max(16).nullable().optional(),
    city: z.string().trim().max(128).nullable().optional(),
    notify_email_bookings: z.boolean().optional(),
    notify_email_reminders: z.boolean().optional(),
    notify_sms_reminders: z.boolean().optional(),
    notify_marketing: z.boolean().optional(),
  });
  const patch = schema.parse(req.body);

  const fields = Object.keys(patch);
  if (fields.length === 0) return res.json({ ok: true });

  const setClause = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => {
    const v = patch[f];
    return typeof v === 'boolean' ? (v ? 1 : 0) : v;
  });
  values.push(req.user.id);

  await query(`UPDATE users SET ${setClause} WHERE id = ?`, values);
  res.json({ ok: true });
}));

// GET /me/export — full data export (GDPR Art. 20 — right to data portability)
// Returns every personal record we hold for the user as a single JSON object.
router.get('/export', asyncRoute(async (req, res) => {
  const userId = req.user.id;
  const [user, identities, sessions, bookings, favorites, applications, reviews] = await Promise.all([
    queryOne(
      `SELECT id, email, name, phone, birth_year, address_line, postal_code, city, role,
              notify_email_bookings, notify_email_reminders, notify_sms_reminders, notify_marketing,
              suspended_at, created_at, updated_at
         FROM users WHERE id = ?`,
      [userId]
    ),
    query(
      `SELECT provider, subject, email_at_link, created_at FROM auth_identities WHERE user_id = ?`,
      [userId]
    ),
    query(
      `SELECT id, user_agent, ip, created_at, last_used_at, expires_at, revoked_at
         FROM sessions WHERE user_id = ?`,
      [userId]
    ),
    query(
      `SELECT b.id, b.start_at, b.end_at, b.price_nok, b.status, b.customer_note,
              b.cancelled_at, b.completed_at, b.created_at,
              s.name AS salon_name, s.city AS salon_city,
              sv.name AS service_name
         FROM bookings b
         JOIN salons s ON s.id = b.salon_id
         JOIN services sv ON sv.id = b.service_id
        WHERE b.customer_user_id = ? ORDER BY b.start_at DESC`,
      [userId]
    ),
    query(
      `SELECT s.id, s.slug, s.name, f.created_at
         FROM favorites f JOIN salons s ON s.id = f.salon_id
        WHERE f.user_id = ?`,
      [userId]
    ),
    query(
      `SELECT id, salon_name, city, status, application_text, created_at, decided_at
         FROM salon_applications WHERE applicant_user_id = ?
        ORDER BY created_at DESC`,
      [userId]
    ),
    query(
      `SELECT id, booking_id, salon_id, rating, body, created_at
         FROM reviews WHERE customer_user_id = ?`,
      [userId]
    ),
  ]);

  const filename = `nailed-export-user-${userId}-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify({
    exported_at: new Date().toISOString(),
    user,
    auth_identities: identities,
    sessions,
    bookings,
    favorites,
    salon_applications: applications,
    reviews,
  }, null, 2));
}));

// DELETE /me — soft-delete via suspension + email scrub.
// Full GDPR erasure runs as a separate admin job in Fase 3 (audit-log preserved).
router.delete('/', asyncRoute(async (req, res) => {
  // Active bookings block deletion.
  const upcoming = await queryOne(
    `SELECT COUNT(*) AS n FROM bookings
      WHERE customer_user_id = ?
        AND status IN ('pending','confirmed')
        AND start_at > NOW()`,
    [req.user.id]
  );
  if (upcoming.n > 0) {
    throw new HttpError(409, 'has_active_bookings',
      'Du har aktive bookinger. Avbestill dem først, eller kontakt support.');
  }

  // Scrub personal fields, suspend account, revoke sessions, drop linkable
  // records. Booking history is preserved (anonymized via the user record)
  // for accounting (bokføringsloven §13: 5 years).
  await query(
    `UPDATE users
        SET suspended_at = CURRENT_TIMESTAMP,
            email = CONCAT('deleted-', id, '@nailed.invalid'),
            phone = NULL,
            address_line = NULL,
            postal_code = NULL,
            city = NULL,
            birth_year = NULL,
            name = 'Slettet bruker',
            notify_email_bookings = 0,
            notify_email_reminders = 0,
            notify_sms_reminders = 0,
            notify_marketing = 0
      WHERE id = ?`,
    [req.user.id]
  );
  await query(`UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL`, [req.user.id]);
  await query(`DELETE FROM favorites WHERE user_id = ?`, [req.user.id]);
  await query(`DELETE FROM auth_identities WHERE user_id = ?`, [req.user.id]);
  await query(
    `UPDATE salon_applications
        SET status = 'withdrawn', decided_at = CURRENT_TIMESTAMP
      WHERE applicant_user_id = ? AND status = 'pending'`,
    [req.user.id]
  );
  res.json({ ok: true });
}));

// GET /me/sessions — list active sessions
router.get('/sessions', asyncRoute(async (req, res) => {
  const rows = await query(
    `SELECT id, user_agent, ip, created_at, last_used_at, expires_at
       FROM sessions
      WHERE user_id = ? AND revoked_at IS NULL
      ORDER BY last_used_at DESC`,
    [req.user.id]
  );
  res.json({ sessions: rows });
}));

// DELETE /me/sessions/:id — revoke a specific session
router.delete('/sessions/:id', asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  await query(
    `UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    [id, req.user.id]
  );
  res.json({ ok: true });
}));

module.exports = router;
