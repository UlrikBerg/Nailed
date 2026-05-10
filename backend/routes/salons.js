const express = require('express');
const { z } = require('zod');
const { query, queryOne, tx } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute, HttpError } = require('../lib/util');
const { lazyUrl } = require('../lib/schema');
const storage = require('../storage');

const router = express.Router();

function withCoverUrl(row) {
  const { cover_image_key, ...rest } = row;
  return {
    ...rest,
    cover_image_key,
    cover_url: cover_image_key ? storage.publicUrl(cover_image_key) : null,
  };
}

// GET /salons — public listing (paginated)
router.get('/', asyncRoute(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 24, 100);
  const offset = parseInt(req.query.offset, 10) || 0;
  const city = (req.query.city || '').toString().trim();

  const where = ['status = ?'];
  const params = ['active'];
  if (city) { where.push('city = ?'); params.push(city); }

  const rows = await query(
    `SELECT id, slug, name, city, bio, instagram_url, cover_image_key
       FROM salons WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ salons: rows.map(withCoverUrl), limit, offset });
}));

// GET /salons/:slug — public salon detail
router.get('/:slug', asyncRoute(async (req, res) => {
  const salon = await queryOne(
    `SELECT id, slug, name, city, address_line, postal_code, bio,
            instagram_url, tiktok_url, facebook_url, website_url,
            cover_image_key, public_phone_visible, accepts_new_bookings, status
       FROM salons WHERE slug = ? LIMIT 1`,
    [req.params.slug]
  );
  if (!salon || salon.status !== 'active') {
    throw new HttpError(404, 'not_found', 'Salongen finnes ikke.');
  }

  const [services, images, hours, team, amenities, serviceTeamLinks] = await Promise.all([
    query(
      `SELECT id, name, description, duration_min, price_nok
         FROM services WHERE salon_id = ? AND active = 1 ORDER BY price_nok ASC`,
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
      `SELECT id, name, role, bio, position
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
  ]);

  // Fold team-member ids into each service for client-side rendering.
  const linkMap = new Map();
  for (const l of serviceTeamLinks) {
    if (!linkMap.has(l.service_id)) linkMap.set(l.service_id, []);
    linkMap.get(l.service_id).push(l.team_member_id);
  }
  const servicesWithTeam = services.map(s => ({
    ...s,
    team_member_ids: linkMap.get(s.id) || [],
  }));

  res.json({
    salon: withCoverUrl(salon),
    services: servicesWithTeam,
    images: images.map(i => ({ ...i, url: storage.publicUrl(i.key) })),
    hours,
    team,
    amenities: amenities.map(a => a.amenity),
  });
}));

// GET /salons/me/own — salon owned by the logged-in user (first one)
router.get('/me/own', requireAuth, asyncRoute(async (req, res) => {
  const salon = await queryOne(
    `SELECT id, slug, name, city, address_line, postal_code, bio,
            instagram_url, tiktok_url, facebook_url, website_url,
            cover_image_key, public_phone_visible, accepts_new_bookings, status
       FROM salons WHERE owner_user_id = ? AND status != 'deleted'
       ORDER BY created_at ASC LIMIT 1`,
    [req.user.id]
  );
  if (!salon) throw new HttpError(404, 'no_salon', 'Du har ingen salong.');

  const [images, hours, team, amenities] = await Promise.all([
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
      `SELECT id, name, role, bio, active, position
         FROM team_members WHERE salon_id = ? ORDER BY position ASC, id ASC`,
      [salon.id]
    ),
    query(
      `SELECT amenity FROM salon_amenities WHERE salon_id = ? ORDER BY amenity ASC`,
      [salon.id]
    ),
  ]);

  res.json({
    salon: withCoverUrl(salon),
    images: images.map(i => ({ ...i, url: storage.publicUrl(i.key) })),
    hours,
    team,
    amenities: amenities.map(a => a.amenity),
  });
}));

// PATCH /salons/:id — owner edits their salon
router.patch('/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');

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
  });
  const patch = schema.parse(req.body);

  const salon = await queryOne(`SELECT owner_user_id, status FROM salons WHERE id = ?`, [id]);
  if (!salon) throw new HttpError(404, 'not_found', 'Salongen finnes ikke.');
  if (req.user.role !== 'admin' && salon.owner_user_id !== req.user.id) {
    throw new HttpError(403, 'forbidden', 'Du eier ikke denne salongen.');
  }

  const fields = Object.keys(patch);
  if (fields.length === 0) return res.json({ ok: true });
  const setClause = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => {
    const v = patch[f];
    return typeof v === 'boolean' ? (v ? 1 : 0) : v;
  });
  values.push(id);
  await query(`UPDATE salons SET ${setClause} WHERE id = ?`, values);
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
      `SELECT id, name, description, duration_min, price_nok, active
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
    services: rows.map(r => ({ ...r, team_member_ids: linkMap.get(r.id) || [] })),
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
  });
  const data = schema.parse(req.body);
  const result = await query(
    `INSERT INTO services (salon_id, name, description, duration_min, price_nok, active)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, data.name, data.description ?? null, data.duration_min, data.price_nok, data.active === false ? 0 : 1]
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
  });
  const patch = schema.parse(req.body);
  const fields = Object.keys(patch);
  if (fields.length === 0) return res.json({ ok: true });
  const setClause = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => f === 'active' ? (patch[f] ? 1 : 0) : patch[f]);
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

module.exports = router;
