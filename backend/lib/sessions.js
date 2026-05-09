// Refresh-token (session) management.
// We store sha256(token) so a DB leak doesn't expose live tokens.

const { query, queryOne } = require('../db');
const { randomBase64Url, sha256Hex, nowPlusDays } = require('./util');
const config = require('../config');

async function createSession({ userId, userAgent, ip }) {
  const token = randomBase64Url(48);
  const tokenHash = sha256Hex(token);
  const expiresAt = nowPlusDays(config.jwt.refreshTtlDays);

  await query(
    `INSERT INTO sessions (user_id, token_hash, user_agent, ip, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, tokenHash, userAgent || null, ip || null, expiresAt]
  );

  return { token, expiresAt };
}

async function findValidSession(token) {
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  const session = await queryOne(
    `SELECT id, user_id, expires_at, revoked_at
       FROM sessions WHERE token_hash = ? LIMIT 1`,
    [tokenHash]
  );
  if (!session) return null;
  if (session.revoked_at) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;

  await query(
    `UPDATE sessions SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [session.id]
  );
  return session;
}

async function revokeSession(token) {
  if (!token) return;
  const tokenHash = sha256Hex(token);
  await query(
    `UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP
      WHERE token_hash = ? AND revoked_at IS NULL`,
    [tokenHash]
  );
}

async function revokeAllSessionsForUser(userId) {
  await query(
    `UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND revoked_at IS NULL`,
    [userId]
  );
}

module.exports = {
  createSession,
  findValidSession,
  revokeSession,
  revokeAllSessionsForUser,
};
