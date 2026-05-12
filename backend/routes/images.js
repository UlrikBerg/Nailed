// Salon image upload, gallery management, and cover selection.
//
// Pipeline:
//   POST /salons/:id/images   (multipart, field name "file")
//     -> validate mime + size
//     -> sharp: rotate-by-EXIF, resize to max 2400px, convert to webp q=82
//     -> storage.put(key, buffer)  (key = salons/<salonId>/<random>.webp)
//     -> insert salon_images row
//     -> return image record + public URL

const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { z } = require('zod');
const { query, queryOne, tx } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute, HttpError, randomBase64Url } = require('../lib/util');
const storage = require('../storage');

const router = express.Router({ mergeParams: true });

// 25 MB rå-upload — sharp komprimerer ned til webp q=82 (typisk 100-500 KB)
// før vi laster opp til R2, så lagrings-/båndbredde-kostnaden er liten selv
// for store rå-bilder fra moderne iPhones.
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_IMAGES_PER_SALON = 50;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter(req, file, cb) {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new HttpError(415, 'unsupported_media', 'Bare JPEG, PNG, WEBP eller HEIC.'));
    }
    cb(null, true);
  },
});

async function loadOwnedSalon(req, { allowSuspended = false } = {}) {
  const salonId = parseInt(req.params.id, 10);
  if (!Number.isFinite(salonId)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  const salon = await queryOne(`SELECT id, owner_user_id, status FROM salons WHERE id = ?`, [salonId]);
  if (!salon) throw new HttpError(404, 'not_found', 'Salongen finnes ikke.');
  if (req.user.role !== 'admin' && salon.owner_user_id !== req.user.id) {
    throw new HttpError(403, 'forbidden', 'Du eier ikke denne salongen.');
  }
  // Suspended salons are read-only for owners — admin overrides.
  if (!allowSuspended && req.user.role !== 'admin' && salon.status !== 'active') {
    throw new HttpError(409, 'salon_not_active', 'Salongen er ikke aktiv. Kontakt nailed.');
  }
  return salon;
}

// POST /salons/:id/images — upload one image
router.post('/:id/images', requireAuth, upload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'no_file', 'Ingen fil mottatt.');
  const salon = await loadOwnedSalon(req);

  const countRow = await queryOne(`SELECT COUNT(*) AS n FROM salon_images WHERE salon_id = ?`, [salon.id]);
  if (countRow.n >= MAX_IMAGES_PER_SALON) {
    throw new HttpError(409, 'too_many_images', `Maks ${MAX_IMAGES_PER_SALON} bilder per salong.`);
  }

  // Process image: auto-rotate, cap dimensions, convert to webp.
  let processed;
  let metadata;
  try {
    const pipeline = sharp(req.file.buffer)
      .rotate()
      .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 });
    processed = await pipeline.toBuffer();
    metadata = await sharp(processed).metadata();
  } catch (err) {
    throw new HttpError(400, 'bad_image', 'Kunne ikke lese bildet.');
  }

  const key = `salons/${salon.id}/${randomBase64Url(10)}.webp`;
  await storage.put({ key, body: processed, contentType: 'image/webp' });

  // Append to gallery: position = count.
  const result = await query(
    `INSERT INTO salon_images (salon_id, image_key, position, width, height, bytes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [salon.id, key, countRow.n, metadata.width || null, metadata.height || null, processed.length]
  );

  // If the salon has no cover yet, set this as cover.
  await query(
    `UPDATE salons SET cover_image_key = COALESCE(cover_image_key, ?) WHERE id = ?`,
    [key, salon.id]
  );

  res.status(201).json({
    id: result.insertId,
    key,
    url: storage.publicUrl(key),
    width: metadata.width,
    height: metadata.height,
    bytes: processed.length,
  });
}));

// GET /salons/:id/images — list (public; mirror of public salon detail)
router.get('/:id/images', asyncRoute(async (req, res) => {
  const salonId = parseInt(req.params.id, 10);
  if (!Number.isFinite(salonId)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  const rows = await query(
    `SELECT id, image_key AS \`key\`, position, width, height
       FROM salon_images WHERE salon_id = ? ORDER BY position ASC, id ASC`,
    [salonId]
  );
  res.json({
    images: rows.map(r => ({ ...r, url: storage.publicUrl(r.key) })),
  });
}));

// DELETE /salons/:id/images/:imageId — remove one
router.delete('/:id/images/:imageId', requireAuth, asyncRoute(async (req, res) => {
  const salon = await loadOwnedSalon(req);
  const imageId = parseInt(req.params.imageId, 10);
  if (!Number.isFinite(imageId)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');

  const img = await queryOne(`SELECT id, image_key FROM salon_images WHERE id = ? AND salon_id = ?`, [imageId, salon.id]);
  if (!img) throw new HttpError(404, 'not_found', 'Bildet finnes ikke.');

  await query(`DELETE FROM salon_images WHERE id = ?`, [img.id]);

  // If this was the cover, clear it (or pick the next remaining image).
  const next = await queryOne(`SELECT image_key FROM salon_images WHERE salon_id = ? ORDER BY position ASC, id ASC LIMIT 1`, [salon.id]);
  await query(`UPDATE salons SET cover_image_key = ? WHERE id = ? AND cover_image_key = ?`, [next ? next.image_key : null, salon.id, img.image_key]);

  // Best-effort blob removal.
  try { await storage.remove({ key: img.image_key }); } catch (err) { console.error('[storage.remove]', err); }
  res.json({ ok: true });
}));

// PATCH /salons/:id/cover — pick which image is the cover
router.patch('/:id/cover', requireAuth, asyncRoute(async (req, res) => {
  const salon = await loadOwnedSalon(req);
  const schema = z.object({ image_id: z.number().int().positive().nullable() });
  const { image_id } = schema.parse(req.body || {});

  if (image_id === null) {
    await query(`UPDATE salons SET cover_image_key = NULL WHERE id = ?`, [salon.id]);
    return res.json({ ok: true });
  }
  const img = await queryOne(`SELECT image_key FROM salon_images WHERE id = ? AND salon_id = ?`, [image_id, salon.id]);
  if (!img) throw new HttpError(404, 'not_found', 'Bildet finnes ikke.');
  await query(`UPDATE salons SET cover_image_key = ? WHERE id = ?`, [img.image_key, salon.id]);
  res.json({ ok: true });
}));

// PATCH /salons/:id/images/reorder — body: { order: [imageId, ...] }
router.patch('/:id/images/reorder', requireAuth, asyncRoute(async (req, res) => {
  const salon = await loadOwnedSalon(req);
  const schema = z.object({ order: z.array(z.number().int().positive()).max(MAX_IMAGES_PER_SALON) });
  const { order } = schema.parse(req.body || {});

  // Single transaction so a mid-loop failure rolls back instead of leaving
  // images with mixed old/new positions.
  await tx(async (conn) => {
    for (let i = 0; i < order.length; i++) {
      await conn.execute(
        `UPDATE salon_images SET position = ? WHERE id = ? AND salon_id = ?`,
        [i, order[i], salon.id]
      );
    }
  });
  res.json({ ok: true });
}));

module.exports = router;
