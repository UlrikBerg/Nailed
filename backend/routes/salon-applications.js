const express = require('express');
const { z } = require('zod');
const { query, queryOne } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute, HttpError } = require('../lib/util');
const { lazyUrl } = require('../lib/schema');

const router = express.Router();

router.use(requireAuth);

// GET /salon-applications/mine — what is the current user's application status?
router.get('/mine', asyncRoute(async (req, res) => {
  const row = await queryOne(
    `SELECT id, salon_name, city, status, reviewer_notes, created_at, decided_at
       FROM salon_applications
      WHERE applicant_user_id = ?
      ORDER BY created_at DESC LIMIT 1`,
    [req.user.id]
  );
  res.json({ application: row || null });
}));

// POST /salon-applications — submit a new application
router.post('/', asyncRoute(async (req, res) => {
  const schema = z.object({
    salon_name: z.string().trim().min(2).max(255),
    city: z.string().trim().min(1).max(128),
    address_line: z.string().trim().max(255).optional().nullable(),
    postal_code: z.string().trim().max(16).optional().nullable(),
    instagram_url: lazyUrl().optional(),
    tiktok_url: lazyUrl().optional(),
    facebook_url: lazyUrl().optional(),
    website_url: lazyUrl().optional(),
    application_text: z.string().trim().min(100).max(2000),
  });
  const data = schema.parse(req.body);

  // At least one social proof URL is required to reduce spam.
  if (!data.instagram_url && !data.tiktok_url && !data.facebook_url && !data.website_url) {
    throw new HttpError(400, 'social_required',
      'Du må oppgi minst én lenke til Instagram, TikTok, Facebook eller egen nettside.');
  }

  // Already pending or approved?
  const existing = await queryOne(
    `SELECT id, status FROM salon_applications
      WHERE applicant_user_id = ? AND status IN ('pending','approved')
      ORDER BY created_at DESC LIMIT 1`,
    [req.user.id]
  );
  if (existing) {
    if (existing.status === 'pending') throw new HttpError(409, 'already_pending', 'Du har allerede en søknad som venter på godkjenning.');
    if (existing.status === 'approved') throw new HttpError(409, 'already_approved', 'Du er allerede registrert som salongeier.');
  }

  const result = await query(
    `INSERT INTO salon_applications
       (applicant_user_id, salon_name, city, address_line, postal_code,
        instagram_url, tiktok_url, facebook_url, website_url, application_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user.id, data.salon_name, data.city,
      data.address_line || null, data.postal_code || null,
      data.instagram_url || null, data.tiktok_url || null,
      data.facebook_url || null, data.website_url || null,
      data.application_text,
    ]
  );
  res.status(201).json({ id: result.insertId });
}));

// POST /salon-applications/:id/withdraw — applicant withdraws their pending application
router.post('/:id/withdraw', asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  // Ownership + status both checked inside the UPDATE so an admin
  // approve/reject racing against the user's withdraw can't be undone.
  const result = await query(
    `UPDATE salon_applications
        SET status = 'withdrawn', decided_at = CURRENT_TIMESTAMP
      WHERE id = ? AND applicant_user_id = ? AND status = 'pending'`,
    [id, req.user.id]
  );
  if (!result.affectedRows) {
    // Distinguish 404 from 403/409 with a follow-up read.
    const app = await queryOne(
      `SELECT applicant_user_id, status FROM salon_applications WHERE id = ?`,
      [id]
    );
    if (!app) throw new HttpError(404, 'not_found', 'Søknaden finnes ikke.');
    if (app.applicant_user_id !== req.user.id) throw new HttpError(403, 'forbidden', 'Ikke din søknad.');
    throw new HttpError(409, 'not_pending', 'Søknaden kan ikke trekkes nå.');
  }
  res.json({ ok: true });
}));

module.exports = router;
