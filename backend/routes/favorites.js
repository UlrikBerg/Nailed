const express = require('express');
const { z } = require('zod');
const { query, queryOne } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute, HttpError } = require('../lib/util');
const storage = require('../storage');

const router = express.Router();

router.use(requireAuth);

// GET /favorites — current user's favorite salons
router.get('/', asyncRoute(async (req, res) => {
  const rows = await query(
    `SELECT s.id, s.slug, s.name, s.city, s.cover_image_key, f.created_at
       FROM favorites f
       JOIN salons s ON s.id = f.salon_id
      WHERE f.user_id = ? AND s.status = 'active'
      ORDER BY f.created_at DESC`,
    [req.user.id]
  );
  res.json({
    favorites: rows.map(r => ({
      ...r,
      cover_url: r.cover_image_key ? storage.publicUrl(r.cover_image_key) : null,
    })),
  });
}));

// POST /favorites — { salon_id }
router.post('/', asyncRoute(async (req, res) => {
  const schema = z.object({ salon_id: z.number().int().positive() });
  const { salon_id } = schema.parse(req.body);

  const salon = await queryOne(`SELECT id FROM salons WHERE id = ? AND status = 'active'`, [salon_id]);
  if (!salon) throw new HttpError(404, 'not_found', 'Salongen finnes ikke.');

  await query(
    `INSERT IGNORE INTO favorites (user_id, salon_id) VALUES (?, ?)`,
    [req.user.id, salon_id]
  );
  res.status(201).json({ ok: true });
}));

// DELETE /favorites/:salonId
router.delete('/:salonId', asyncRoute(async (req, res) => {
  const salonId = parseInt(req.params.salonId, 10);
  if (!Number.isFinite(salonId)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  await query(`DELETE FROM favorites WHERE user_id = ? AND salon_id = ?`, [req.user.id, salonId]);
  res.json({ ok: true });
}));

module.exports = router;
