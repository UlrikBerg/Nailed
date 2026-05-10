// Team members + service ↔ team linking + opening hours + amenities.
// Mounted at /api/v1/salons; routes use :id (salon id).

const express = require('express');
const { z } = require('zod');
const { query, queryOne, tx } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute, HttpError } = require('../lib/util');

const router = express.Router({ mergeParams: true });

// Whitelist of amenity codes the frontend understands.
const AMENITIES = new Set([
  'bio_gel', 'wifi', 'coffee', 'water', 'accessible', 'parking',
  'vegan_products', 'card_payment', 'vipps_payment', 'child_friendly',
  'late_hours', 'weekend_hours', 'free_cancellation_24h',
]);

async function loadOwnedSalon(req) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  const salon = await queryOne(`SELECT id, owner_user_id FROM salons WHERE id = ?`, [id]);
  if (!salon) throw new HttpError(404, 'not_found', 'Salongen finnes ikke.');
  if (req.user.role !== 'admin' && salon.owner_user_id !== req.user.id) {
    throw new HttpError(403, 'forbidden', 'Du eier ikke denne salongen.');
  }
  return salon;
}

// ---------------------------------------------------------------------------
// HOURS — public listing folds into GET /salons/:slug. Owner edits via PUT.
// ---------------------------------------------------------------------------

router.put('/:id/hours', requireAuth, asyncRoute(async (req, res) => {
  const salon = await loadOwnedSalon(req);

  const dayRow = z.object({
    weekday: z.number().int().min(1).max(7),
    is_closed: z.boolean().optional(),
    open_at: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
    close_at: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
  });
  const data = z.object({ hours: z.array(dayRow).max(7) }).parse(req.body || {});

  await tx(async (conn) => {
    for (const row of data.hours) {
      const isClosed = row.is_closed ? 1 : 0;
      const openAt = isClosed ? null : (row.open_at || null);
      const closeAt = isClosed ? null : (row.close_at || null);
      if (!isClosed && (!openAt || !closeAt)) {
        throw new HttpError(400, 'bad_hours',
          `Dag ${row.weekday}: må enten være stengt, eller ha både åpnings- og stengetid.`);
      }
      await conn.execute(
        `INSERT INTO salon_hours (salon_id, weekday, is_closed, open_at, close_at)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE is_closed = VALUES(is_closed),
                                 open_at  = VALUES(open_at),
                                 close_at = VALUES(close_at)`,
        [salon.id, row.weekday, isClosed, openAt, closeAt]
      );
    }
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// AMENITIES — replace the full set
// ---------------------------------------------------------------------------

router.put('/:id/amenities', requireAuth, asyncRoute(async (req, res) => {
  const salon = await loadOwnedSalon(req);
  const data = z.object({
    amenities: z.array(z.string().max(40)).max(50),
  }).parse(req.body || {});

  const valid = data.amenities.filter(a => AMENITIES.has(a));
  await tx(async (conn) => {
    await conn.execute(`DELETE FROM salon_amenities WHERE salon_id = ?`, [salon.id]);
    for (const a of valid) {
      await conn.execute(
        `INSERT INTO salon_amenities (salon_id, amenity) VALUES (?, ?)`,
        [salon.id, a]
      );
    }
  });
  res.json({ ok: true, amenities: valid });
}));

// ---------------------------------------------------------------------------
// TEAM — list / create / update / delete
// ---------------------------------------------------------------------------

router.get('/:id/team', asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  // Owners / admins see all team members; the public only sees active ones.
  const salon = await queryOne(`SELECT owner_user_id FROM salons WHERE id = ?`, [id]);
  if (!salon) throw new HttpError(404, 'not_found', 'Salongen finnes ikke.');
  const isOwner = req.user && (req.user.role === 'admin' || salon.owner_user_id === req.user.id);
  const activeFilter = isOwner ? '' : 'AND active = 1';
  const rows = await query(
    `SELECT id, name, role, bio, active, position, created_at
       FROM team_members WHERE salon_id = ? ${activeFilter}
       ORDER BY position ASC, id ASC`,
    [id]
  );
  res.json({ team: rows });
}));

router.post('/:id/team', requireAuth, asyncRoute(async (req, res) => {
  const salon = await loadOwnedSalon(req);
  const data = z.object({
    name: z.string().trim().min(1).max(255),
    role: z.string().trim().max(255).nullable().optional(),
    bio: z.string().trim().max(2000).nullable().optional(),
  }).parse(req.body || {});

  const countRow = await queryOne(
    `SELECT COUNT(*) AS n FROM team_members WHERE salon_id = ?`,
    [salon.id]
  );
  if (countRow.n >= 50) throw new HttpError(409, 'too_many', 'Maks 50 team-medlemmer.');

  const result = await query(
    `INSERT INTO team_members (salon_id, name, role, bio, position)
     VALUES (?, ?, ?, ?, ?)`,
    [salon.id, data.name, data.role || null, data.bio || null, countRow.n]
  );
  res.status(201).json({ id: result.insertId });
}));

router.patch('/:id/team/:memberId', requireAuth, asyncRoute(async (req, res) => {
  const salon = await loadOwnedSalon(req);
  const memberId = parseInt(req.params.memberId, 10);
  if (!Number.isFinite(memberId)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');

  const member = await queryOne(
    `SELECT id FROM team_members WHERE id = ? AND salon_id = ?`,
    [memberId, salon.id]
  );
  if (!member) throw new HttpError(404, 'not_found', 'Medlem finnes ikke.');

  const patch = z.object({
    name: z.string().trim().min(1).max(255).optional(),
    role: z.string().trim().max(255).nullable().optional(),
    bio: z.string().trim().max(2000).nullable().optional(),
    active: z.boolean().optional(),
  }).parse(req.body || {});

  const fields = Object.keys(patch);
  if (!fields.length) return res.json({ ok: true });
  const setClause = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => f === 'active' ? (patch[f] ? 1 : 0) : patch[f]);
  values.push(memberId);
  await query(`UPDATE team_members SET ${setClause} WHERE id = ?`, values);
  res.json({ ok: true });
}));

router.delete('/:id/team/:memberId', requireAuth, asyncRoute(async (req, res) => {
  const salon = await loadOwnedSalon(req);
  const memberId = parseInt(req.params.memberId, 10);
  if (!Number.isFinite(memberId)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  await query(
    `DELETE FROM team_members WHERE id = ? AND salon_id = ?`,
    [memberId, salon.id]
  );
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// SERVICE ↔ TEAM linking
// ---------------------------------------------------------------------------

router.put('/:id/services/:serviceId/team', requireAuth, asyncRoute(async (req, res) => {
  const salon = await loadOwnedSalon(req);
  const serviceId = parseInt(req.params.serviceId, 10);
  if (!Number.isFinite(serviceId)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');

  const svc = await queryOne(
    `SELECT id FROM services WHERE id = ? AND salon_id = ?`,
    [serviceId, salon.id]
  );
  if (!svc) throw new HttpError(404, 'not_found', 'Tjenesten finnes ikke.');

  const data = z.object({
    team_member_ids: z.array(z.number().int().positive()).max(50),
  }).parse(req.body || {});

  if (data.team_member_ids.length) {
    const placeholders = data.team_member_ids.map(() => '?').join(',');
    const valid = await query(
      `SELECT id FROM team_members WHERE salon_id = ? AND id IN (${placeholders})`,
      [salon.id, ...data.team_member_ids]
    );
    const validIds = valid.map(r => r.id);
    await tx(async (conn) => {
      await conn.execute(`DELETE FROM service_team_members WHERE service_id = ?`, [serviceId]);
      for (const memberId of validIds) {
        await conn.execute(
          `INSERT INTO service_team_members (service_id, team_member_id) VALUES (?, ?)`,
          [serviceId, memberId]
        );
      }
    });
    return res.json({ ok: true, linked: validIds });
  }
  await query(`DELETE FROM service_team_members WHERE service_id = ?`, [serviceId]);
  res.json({ ok: true, linked: [] });
}));

module.exports = router;
