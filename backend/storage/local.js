// Local-disk storage backend. Writes to LOCAL_UPLOAD_DIR; served by Express
// from /uploads/* (mounted in app.js).

const fs = require('fs/promises');
const path = require('path');
const config = require('../config');

const uploadDir = path.resolve(__dirname, '..', '..', config.storage.localDir);

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function put({ key, body, contentType }) {
  const target = path.join(uploadDir, key);
  await ensureDir(path.dirname(target));
  await fs.writeFile(target, body);
  return { key, contentType };
}

async function remove({ key }) {
  const target = path.join(uploadDir, key);
  try {
    await fs.unlink(target);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function publicUrl(key) {
  if (!key) return null;
  // Pass-through eksterne URLer (brukes av seed-data / test-salonger).
  if (key.startsWith('http://') || key.startsWith('https://')) return key;
  // Served by Express static under /uploads.
  return `/uploads/${key}`;
}

module.exports = { id: 'local', put, remove, publicUrl, uploadDir };
