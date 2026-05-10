// Shared zod helpers.

const { z } = require('zod');
const { normalizeUrl } = require('./util');

// URL field that auto-prefixes "https://" if the user typed a bare hostname
// like "7smarom.no" or "instagram.com/foo". Returns null for empty values
// so callers can store NULL in the DB. Pass max bytes for VARCHAR limits.
function lazyUrl({ max = 512 } = {}) {
  return z.preprocess(
    (v) => {
      if (v === null || v === undefined) return null;
      if (typeof v !== 'string') return v;
      const trimmed = v.trim();
      if (!trimmed) return null;
      return normalizeUrl(trimmed);
    },
    z.string().url().max(max).nullable()
  );
}

module.exports = { lazyUrl };
