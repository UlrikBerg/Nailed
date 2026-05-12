// Chat / meldinger mellom kunde og salong. En tråd per (customer × salon).
// Tråden opprettes automatisk når kunden gjør sin første booking mot salongen
// (hook i bookings.js). Begge parter kan sende meldinger så lenge tråden finnes.
//
// Sikkerhet: alle endepunktene krever auth, og hver request verifiserer at
// brukeren er enten kunden i tråden eller eier av salongen i tråden.

const express = require('express');
const { z } = require('zod');
const { query, queryOne } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute, HttpError } = require('../lib/util');

const router = express.Router();
router.use(requireAuth);

// Returner { thread, role } hvis brukeren har tilgang, ellers throw.
const storage = require('../storage');

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
            (SELECT SUBSTRING(body, 1, 140) FROM chat_messages
              WHERE thread_id = t.id ORDER BY sent_at DESC LIMIT 1) AS last_message_preview
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
    `SELECT id, sender_user_id, sender_role, body, sent_at
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
