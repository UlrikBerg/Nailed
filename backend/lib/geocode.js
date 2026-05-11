// Tiny Nominatim (OpenStreetMap) geocoder.
//
// Free / no API key. We must:
//   * send a descriptive User-Agent (per Nominatim usage policy),
//   * not hammer their servers — we cap concurrency to 1 and cache responses
//     for 24 h in-process so a re-save doesn't make another network call.
//
// We fail soft: any error (timeout, non-2xx, no result) resolves to null so
// callers can persist NULL lat/lng without crashing the request flow.
//
// Usage:
//   const { geocode } = require('./lib/geocode');
//   const coords = await geocode('Kiellands gate 4', '1776', 'Halden');
//   // -> { lat: 59.123, lng: 11.394 } or null

const USER_AGENT = 'nailed/1.0 (contact: ulriktheodor99@gmail.com)';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

const cache = new Map(); // key -> { ts, value }

// Simple FIFO queue so we never run two upstream calls in parallel.
// (Nominatim's policy asks for max 1 req/sec.)
let chain = Promise.resolve();
function queued(fn) {
  const next = chain.then(fn, fn);
  // Swallow rejections on the chain so one failure doesn't poison the queue.
  chain = next.then(() => {}, () => {});
  return next;
}

function buildQuery(parts) {
  return parts
    .map(p => (p == null ? '' : String(p).trim()))
    .filter(Boolean)
    .join(', ');
}

async function fetchNominatim(q) {
  const url = `${NOMINATIM}?` + new URLSearchParams({
    q,
    format: 'jsonv2',
    limit: '1',
    countrycodes: 'no', // bias to Norway — salons are Norwegian.
    addressdetails: '0',
  }).toString();

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
        'Accept-Language': 'no,nb,en',
      },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (!Array.isArray(body) || body.length === 0) return null;
    const top = body[0];
    const lat = Number(top.lat);
    const lng = Number(top.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Geocode an address.
 *
 * Accepts either a single freeform query string OR (address, postal, city).
 * Returns { lat, lng } or null.
 */
async function geocode(...args) {
  let q;
  if (args.length === 1) {
    q = String(args[0] || '').trim();
  } else {
    q = buildQuery(args);
  }
  if (!q) return null;

  const key = q.toLowerCase();
  const cached = cache.get(key);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    return cached.value;
  }

  const value = await queued(() => fetchNominatim(q));
  cache.set(key, { ts: Date.now(), value });
  return value;
}

module.exports = geocode;
module.exports.geocode = geocode;
