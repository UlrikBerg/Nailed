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

  const [services, categories, images, hours, team, amenities, serviceTeamLinks, reviewSummaryRow] = await Promise.all([
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
    images: images.map(i => ({ ...i, url: storage.publicUrl(i.key) })),
    hours,
    team: team.map(m => ({ ...m, image_url: m.image_key ? storage.publicUrl(m.image_key) : null })),
    amenities: amenities.map(a => a.amenity),
    reviews: {
      count: Number(reviewSummaryRow?.count || 0),
      // Round to 1 decimal so the client doesn't have to format it twice.
      avg: reviewSummaryRow?.avg != null ? Math.round(Number(reviewSummaryRow.avg) * 10) / 10 : null,
    },
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

  const [images, hours, team, amenities, categories] = await Promise.all([
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
      `SELECT id, name, role, bio, active, position, image_key
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
  ]);

  res.json({
    salon: withCoverUrl(salon),
    images: images.map(i => ({ ...i, url: storage.publicUrl(i.key) })),
    hours,
    team: team.map(m => ({ ...m, image_url: m.image_key ? storage.publicUrl(m.image_key) : null })),
    amenities: amenities.map(a => a.amenity),
    categories,
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
      `SELECT id, category_id, name, description, duration_min, price_nok, is_popular, active
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
    `INSERT INTO services (salon_id, category_id, name, description, duration_min, price_nok, active, is_popular)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.category_id ?? null,
      data.name,
      data.description ?? null,
      data.duration_min,
      data.price_nok,
      data.active === false ? 0 : 1,
      data.is_popular ? 1 : 0,
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

module.exports = router;
