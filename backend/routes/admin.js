const express = require('express');
const { z } = require('zod');
const { query, queryOne, tx } = require('../db');
const { requireRole } = require('../middleware/auth');
const { asyncRoute, HttpError, slugify, randomBase64Url } = require('../lib/util');

const router = express.Router();

// All admin routes require role=admin.
router.use(requireRole('admin'));

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

  await tx(async (conn) => {
    await conn.execute(
      `UPDATE salon_applications
          SET status = 'approved', reviewer_user_id = ?, reviewer_notes = ?, decided_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [req.user.id, notes || null, id]
    );

    const baseSlug = slugify(app.salon_name) || `salong-${id}`;
    let slug = baseSlug;
    for (let i = 0; i < 20; i++) {
      const [taken] = await conn.execute(`SELECT id FROM salons WHERE slug = ? LIMIT 1`, [slug]);
      if (!taken[0]) break;
      slug = `${baseSlug}-${randomBase64Url(3).replace(/[^a-z0-9]/gi, '').slice(0, 4).toLowerCase()}`;
    }

    await conn.execute(
      `INSERT INTO salons
         (owner_user_id, slug, name, city, address_line, postal_code,
          instagram_url, tiktok_url, facebook_url, website_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        app.applicant_user_id, slug, app.salon_name, app.city,
        app.address_line, app.postal_code,
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
// Bookings (read-only listing for admin)
// ----------------------------------------------------------------------------

router.get('/bookings', asyncRoute(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;
  const status = (req.query.status || '').toString();

  const where = ['1 = 1'];
  const params = [];
  if (status) { where.push('b.status = ?'); params.push(status); }

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
