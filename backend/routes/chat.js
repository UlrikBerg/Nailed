// Chat / meldinger mellom kunde og salong. En tråd per (customer × salon).
// Tråden opprettes automatisk når kunden gjør sin første booking mot salongen
// (hook i bookings.js). Begge parter kan sende meldinger så lenge tråden finnes.
//
// Sikkerhet: alle endepunktene krever auth, og hver request verifiserer at
// brukeren er enten kunden i tråden eller eier av salongen i tråden.

const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');
const { z } = require('zod');
const { query, queryOne } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute, HttpError } = require('../lib/util');

const router = express.Router();
router.use(requireAuth);

// Returner { thread, role } hvis brukeren har tilgang, ellers throw.
const storage = require('../storage');

const CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const CHAT_IMAGE_ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const chatImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CHAT_IMAGE_MAX_BYTES, files: 1 },
  fileFilter(req, file, cb) {
    if (!CHAT_IMAGE_ALLOWED.has(file.mimetype)) {
      return cb(new HttpError(415, 'unsupported_media', 'Bare JPEG, PNG, WEBP eller HEIC.'));
    }
    cb(null, true);
  },
});
function randomKeyPart(bytes) {
  return crypto.randomBytes(bytes).toString('base64url');
}

async function loadThreadForUser(threadId, userId) {
  const t = await queryOne(
    `SELECT t.id, t.customer_user_id, t.salon_id, t.created_at, t.last_message_at,
            t.customer_last_read, t.salon_last_read,
            s.owner_user_id, s.name AS salon_name, s.slug AS salon_slug,
            s.cover_image_key,
            c.name AS customer_name, c.email AS customer_email
       FROM chat_threads t
       JOIN salons s ON s.id = t.salon_id
       JOIN users  c ON c.id = t.customer_user_id
      WHERE t.id = ? LIMIT 1`,
    [threadId]
  );
  if (t) {
    t.salon_cover_url = t.cover_image_key ? storage.publicUrl(t.cover_image_key) : null;
  }
  if (!t) throw new HttpError(404, 'not_found', 'Tråden finnes ikke.');
  let role = null;
  if (t.customer_user_id === userId) role = 'customer';
  else if (t.owner_user_id === userId) role = 'salon';
  if (!role) throw new HttpError(403, 'forbidden', 'Ingen tilgang.');
  return { thread: t, role };
}

function shapeThread(t, viewerRole) {
  const unread = viewerRole === 'customer'
    ? (t.last_message_at && (!t.customer_last_read || new Date(t.last_message_at) > new Date(t.customer_last_read)))
    : (t.last_message_at && (!t.salon_last_read || new Date(t.last_message_at) > new Date(t.salon_last_read)));
  return {
    id: t.id,
    salon_id: t.salon_id,
    salon_name: t.salon_name,
    salon_slug: t.salon_slug,
    salon_cover_url: null, // settes nedenfor hvis storage er tilgjengelig
    customer_id: t.customer_user_id,
    customer_name: t.customer_name,
    customer_email: t.customer_email,
    last_message_at: t.last_message_at,
    last_message_preview: t.last_message_preview || null,
    unread: !!unread,
  };
}

// GET /chat/threads — listen brukeren har tilgang til, sortert etter siste melding.
router.get('/threads', asyncRoute(async (req, res) => {
  const userId = req.user.id;
  // Som kunde: alle tråder der jeg er customer_user_id.
  // Som salon_owner/admin: alle tråder mot salonger jeg eier.
  const rows = await query(
    `SELECT t.id, t.customer_user_id, t.salon_id, t.created_at, t.last_message_at,
            t.customer_last_read, t.salon_last_read,
            s.owner_user_id, s.name AS salon_name, s.slug AS salon_slug,
            s.cover_image_key,
            c.name AS customer_name, c.email AS customer_email,
            (SELECT IF(body IS NOT NULL AND body <> '', SUBSTRING(body, 1, 140),
                       IF(image_key IS NOT NULL, '📷 Bilde', NULL))
                FROM chat_messages WHERE thread_id = t.id
                ORDER BY sent_at DESC LIMIT 1) AS last_message_preview
       FROM chat_threads t
       JOIN salons s ON s.id = t.salon_id
       JOIN users  c ON c.id = t.customer_user_id
      WHERE t.customer_user_id = ? OR s.owner_user_id = ?
      ORDER BY COALESCE(t.last_message_at, t.created_at) DESC
      LIMIT 200`,
    [userId, userId]
  );
  const shaped = rows.map(r => {
    const role = r.customer_user_id === userId ? 'customer' : 'salon';
    const salonCover = r.cover_image_key ? storage.publicUrl(r.cover_image_key) : null;
    return {
      ...shapeThread({ ...r, salon_cover_url: salonCover }, role),
      salon_cover_url: salonCover,
      last_message_preview: r.last_message_preview,
      role,
    };
  });
  res.json({ threads: shaped });
}));

// GET /chat/threads/:id/messages — alle meldinger i en tråd.
router.get('/threads/:id/messages', asyncRoute(async (req, res) => {
  const threadId = parseInt(req.params.id, 10);
  if (!Number.isFinite(threadId)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  const { thread, role } = await loadThreadForUser(threadId, req.user.id);

  const msgs = await query(
    `SELECT id, sender_user_id, sender_role, body, image_key, sent_at
       FROM chat_messages
      WHERE thread_id = ? ORDER BY sent_at ASC LIMIT 500`,
    [threadId]
  );

  // Marker som lest for visende rolle. Idempotent.
  const col = role === 'customer' ? 'customer_last_read' : 'salon_last_read';
  await query(
    `UPDATE chat_threads SET ${col} = CURRENT_TIMESTAMP WHERE id = ?`,
    [threadId]
  );

  // Lest-indikator: hver melding bærer `read` = true hvis den andre siden
  // har lest tråden ETTER at meldingen ble sendt.
  const otherLastRead = role === 'customer' ? thread.salon_last_read : thread.customer_last_read;
  res.json({
    thread: {
      id: thread.id,
      salon_id: thread.salon_id,
      salon_name: thread.salon_name,
      salon_slug: thread.salon_slug,
      salon_cover_url: thread.salon_cover_url,
      customer_id: thread.customer_user_id,
      customer_name: thread.customer_name,
      role,
      other_last_read: otherLastRead,
    },
    messages: msgs.map(m => ({
      id: m.id,
      sender_user_id: m.sender_user_id,
      sender_role: m.sender_role,
      body: m.body,
      image_url: m.image_key ? storage.publicUrl(m.image_key) : null,
      sent_at: m.sent_at,
      read: m.sender_role === role && otherLastRead != null
        && new Date(otherLastRead) >= new Date(m.sent_at),
    })),
  });
}));

// POST /chat/threads/:id/messages — send melding.
router.post('/threads/:id/messages', asyncRoute(async (req, res) => {
  const threadId = parseInt(req.params.id, 10);
  if (!Number.isFinite(threadId)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  const { thread, role } = await loadThreadForUser(threadId, req.user.id);

  const schema = z.object({ body: z.string().trim().min(1).max(4000) });
  const { body } = schema.parse(req.body || {});

  const result = await query(
    `INSERT INTO chat_messages (thread_id, sender_user_id, sender_role, body)
     VALUES (?, ?, ?, ?)`,
    [threadId, req.user.id, role, body]
  );

  // Oppdater siste-melding-timestamp + marker som lest for senderen (egne
  // meldinger er per definisjon allerede sett).
  const readCol = role === 'customer' ? 'customer_last_read' : 'salon_last_read';
  await query(
    `UPDATE chat_threads
        SET last_message_at = CURRENT_TIMESTAMP, ${readCol} = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [threadId]
  );

  res.status(201).json({
    id: result.insertId,
    sender_user_id: req.user.id,
    sender_role: role,
    body,
    sent_at: new Date().toISOString(),
  });
}));

// POST /chat/messages/:id/report — rapporter en melding for moderering.
// Begge parter (kunde og salon) i tråden kan rapportere; admin håndterer.
router.post('/messages/:id/report', asyncRoute(async (req, res) => {
  const messageId = parseInt(req.params.id, 10);
  if (!Number.isFinite(messageId)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');

  const msg = await queryOne(
    `SELECT m.id, m.thread_id, m.sender_user_id, m.sender_role,
            t.customer_user_id, t.salon_id,
            (SELECT owner_user_id FROM salons WHERE id = t.salon_id) AS salon_owner_user_id
       FROM chat_messages m
       JOIN chat_threads t ON t.id = m.thread_id
      WHERE m.id = ? LIMIT 1`,
    [messageId]
  );
  if (!msg) throw new HttpError(404, 'not_found', 'Meldingen finnes ikke.');

  // Verifiser at brukeren er part i tråden (eller admin).
  let reporterRole;
  if (req.user.id === msg.customer_user_id) reporterRole = 'customer';
  else if (req.user.id === msg.salon_owner_user_id) reporterRole = 'salon';
  else if (req.user.role === 'admin') reporterRole = 'salon';
  else throw new HttpError(403, 'forbidden', 'Du er ikke part i denne samtalen.');

  // Egne meldinger kan ikke rapporteres.
  if (msg.sender_user_id === req.user.id) {
    throw new HttpError(400, 'cant_report_self', 'Du kan ikke rapportere din egen melding.');
  }

  const schema = z.object({ reason: z.string().trim().max(2000).nullable().optional() });
  const { reason } = schema.parse(req.body || {});

  // Dedup: ett pending-rapport per (melding, rapportør)
  const existing = await queryOne(
    `SELECT id FROM chat_message_reports
      WHERE message_id = ? AND reporter_user_id = ? AND status = 'pending' LIMIT 1`,
    [messageId, req.user.id]
  );
  if (existing) {
    return res.status(200).json({ id: existing.id, deduped: true });
  }

  const result = await query(
    `INSERT INTO chat_message_reports
       (message_id, thread_id, reporter_user_id, reporter_role, reason)
     VALUES (?, ?, ?, ?, ?)`,
    [messageId, msg.thread_id, req.user.id, reporterRole, reason || null]
  );
  res.status(201).json({ id: result.insertId });
}));

// POST /chat/threads/:id/messages/image — send bilde-melding.
// Body via multipart/form-data, felt-navn «file». Bildet komprimeres til
// webp (q=82, max 1600 px) og lagres på storage. body settes til '' siden
// kolonna er TEXT NULL (frontend rendrer kun image_url når satt).
router.post('/threads/:id/messages/image', chatImageUpload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'no_file', 'Ingen fil mottatt.');
  const threadId = parseInt(req.params.id, 10);
  if (!Number.isFinite(threadId)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  const { role } = await loadThreadForUser(threadId, req.user.id);

  let processed;
  try {
    const rotated = await sharp(req.file.buffer).rotate().toBuffer();
    processed = await sharp(rotated)
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (err) {
    throw new HttpError(400, 'bad_image', 'Kunne ikke lese bildet.');
  }

  const key = `chat/${threadId}/${Date.now()}-${randomKeyPart(8)}.webp`;
  await storage.put({ key, body: processed, contentType: 'image/webp' });

  const result = await query(
    `INSERT INTO chat_messages (thread_id, sender_user_id, sender_role, body, image_key)
     VALUES (?, ?, ?, NULL, ?)`,
    [threadId, req.user.id, role, key]
  );
  const readCol = role === 'customer' ? 'customer_last_read' : 'salon_last_read';
  await query(
    `UPDATE chat_threads
        SET last_message_at = CURRENT_TIMESTAMP, ${readCol} = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [threadId]
  );
  res.status(201).json({
    id: result.insertId,
    sender_user_id: req.user.id,
    sender_role: role,
    body: null,
    image_url: storage.publicUrl(key),
    sent_at: new Date().toISOString(),
  });
}));

// POST /chat/threads/:id/read — marker tråden som lest.
router.post('/threads/:id/read', asyncRoute(async (req, res) => {
  const threadId = parseInt(req.params.id, 10);
  if (!Number.isFinite(threadId)) throw new HttpError(400, 'bad_id', 'Ugyldig id.');
  const { role } = await loadThreadForUser(threadId, req.user.id);
  const col = role === 'customer' ? 'customer_last_read' : 'salon_last_read';
  await query(`UPDATE chat_threads SET ${col} = CURRENT_TIMESTAMP WHERE id = ?`, [threadId]);
  res.json({ ok: true });
}));

// Helper: opprett eller hent thread for (kunde × salong). Brukes fra bookings.js.
async function ensureThread(customerUserId, salonId) {
  const existing = await queryOne(
    `SELECT id FROM chat_threads WHERE customer_user_id = ? AND salon_id = ? LIMIT 1`,
    [customerUserId, salonId]
  );
  if (existing) return existing.id;
  const result = await query(
    `INSERT INTO chat_threads (customer_user_id, salon_id) VALUES (?, ?)`,
    [customerUserId, salonId]
  );
  return result.insertId;
}

module.exports = router;
module.exports.ensureThread = ensureThread;
